import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canTransitionStatus, normalizeBookingStatus } from "@/lib/bookingTypes";
import { 
  createNotification, 
  getNotificationContent, 
  createStaffAssignmentNotification,
  createCustomerConfirmationNotification 
} from "@/lib/notifications";

// Helper to get activity type from status
function getActivityType(status: string): string {
  const s = status.toLowerCase().replace(/[_\s-]/g, "");
  if (s === "awaitingstaffapproval") return "booking_sent_to_staff";
  if (s === "staffrejected") return "booking_staff_rejected";
  if (s === "confirmed") return "booking_confirmed";
  if (s === "completed") return "booking_completed";
  if (s === "cancelled" || s === "canceled") return "booking_cancelled";
  if (s === "pending") return "booking_created";
  return "booking_updated";
}

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      if (process.env.NODE_ENV !== "production") {
        // Allow client-side fallback in development
        return NextResponse.json({ ok: true, devNoop: true });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let callerUid: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      callerUid = decoded.uid;
    } catch (verifyError: any) {
      console.error("Token verification failed:", verifyError);
      
      // Detailed error info for debugging Vercel issues
      const errorDetails = {
        code: verifyError?.code,
        message: verifyError?.message,
        stack: process.env.NODE_ENV !== "production" ? verifyError?.stack : undefined,
      };

      if (process.env.NODE_ENV !== "production") {
        console.log("Falling back to devNoop due to verification failure in dev");
        return NextResponse.json({ ok: true, devNoop: true });
      }
      
      return NextResponse.json({ 
        error: "Unauthorized: Token verification failed", 
        details: errorDetails,
        hint: "Check server logs for Firebase Admin initialization status." 
      }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { 
      status?: string; 
      staffId?: string;
      staffName?: string;
      services?: any[];
      rejectionReason?: string; // For staff rejecting a booking
      isReassignment?: boolean; // Flag for admin reassigning after rejection
    };
    
    // Handle the "Confirmed" status from old admin panel - map to new workflow
    let requestedStatusRaw = body?.status || "";
    
    // Check if this is an admin trying to "confirm" from Pending
    // In the new workflow, this should go to AwaitingStaffApproval
    // We'll detect this case and handle it properly
    
    const requestedStatus = normalizeBookingStatus(requestedStatusRaw);

    const db = adminDb();
    
    // Get user role to determine permissions
    const userDoc = await db.doc(`users/${callerUid}`).get();
    const userData = userDoc.data();
    const userRole = (userData?.role || "").toString();
    const ownerUid = userRole === "salon_owner" ? callerUid : (userData?.ownerUid || callerUid);
    
    // Try to find booking in "bookings" collection first
    let ref = db.doc(`bookings/${id}`);
    let snap = await ref.get();
    let isBookingRequest = false;
    
    // If not found, try "bookingRequests" collection
    if (!snap.exists) {
      ref = db.doc(`bookingRequests/${id}`);
      snap = await ref.get();
      isBookingRequest = true;
    }
    
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data() as any;
    if (!data || data.ownerUid !== ownerUid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentStatus = normalizeBookingStatus(data.status || "Pending");
    
    // Handle the transition from Pending -> "Confirmed" in admin panel
    // In new workflow, this actually means Pending -> AwaitingStaffApproval
    let actualNextStatus = requestedStatus;
    let isAdminConfirmingPending = false;
    
    if (currentStatus === "Pending" && requestedStatus === "Confirmed") {
      // Admin is trying to confirm a pending booking
      // In the new workflow, this should go to AwaitingStaffApproval
      actualNextStatus = "AwaitingStaffApproval" as any;
      isAdminConfirmingPending = true;
    }
    
    // For staff accepting from AwaitingStaffApproval -> Confirmed
    const isStaffAccepting = currentStatus === "AwaitingStaffApproval" && requestedStatus === "Confirmed";
    
    // For staff rejecting from AwaitingStaffApproval -> StaffRejected
    const isStaffRejecting = currentStatus === "AwaitingStaffApproval" && requestedStatus === "StaffRejected";
    
    // For admin reassigning after rejection: StaffRejected -> AwaitingStaffApproval
    const isAdminReassigning = currentStatus === "StaffRejected" && requestedStatus === "AwaitingStaffApproval";

    if (!canTransitionStatus(currentStatus, actualNextStatus)) {
      return NextResponse.json({ error: `Invalid transition ${currentStatus} -> ${actualNextStatus}` }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {
      status: actualNextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add services update if provided (for multi-service staff assignment)
    if (body.services && Array.isArray(body.services) && body.services.length > 0) {
      updateData.services = body.services;
      
      // If we have services, we don't need top-level staff info
      if (!isBookingRequest) {
        updateData.staffId = FieldValue.delete();
        updateData.staffName = FieldValue.delete();
      }
    } else if (body.staffId) {
      // Only set top-level staff if no services array update (legacy support)
      updateData.staffId = body.staffId;
      updateData.staffName = body.staffName || "Staff";
    }

    // Store rejection reason if staff is rejecting
    if (isStaffRejecting && body.rejectionReason) {
      updateData.rejectionReason = body.rejectionReason;
      updateData.rejectedByStaffUid = callerUid;
      updateData.rejectedByStaffName = userData?.name || userData?.displayName || "Staff";
    }

    // Clear rejection info if being reassigned
    if (isAdminReassigning) {
      updateData.rejectionReason = FieldValue.delete();
      updateData.rejectedByStaffUid = FieldValue.delete();
      updateData.rejectedByStaffName = FieldValue.delete();
    }

    // If admin is sending to staff for approval (from booking request or pending), move to bookings if needed
    if (isBookingRequest && (isAdminConfirmingPending || actualNextStatus === "AwaitingStaffApproval")) {
      // Create in bookings collection
      const bookingData = {
        ...data,
        ...updateData,
        createdAt: data.createdAt || FieldValue.serverTimestamp(),
      };
      
      // Explicitly remove top-level staff fields for new booking document if services exist
      if (body.services && Array.isArray(body.services) && body.services.length > 0) {
        delete bookingData.staffId;
        delete bookingData.staffName;
      }
      
      await db.collection("bookings").add(bookingData);
      
      // Delete from bookingRequests
      await ref.delete();
    } else {
      // Just update the booking
      await ref.update(updateData);
    }

    // Create booking activity log entry
    try {
      const activityData = {
        ownerUid: ownerUid,
        bookingId: id,
        bookingCode: data.bookingCode || null,
        activityType: getActivityType(actualNextStatus),
        clientName: data.client || data.clientName || "Unknown",
        serviceName: data.serviceName || null,
        branchName: data.branchName || null,
        staffName: body.staffName || data.staffName || null,
        price: data.price || null,
        date: data.date || null,
        time: data.time || null,
        previousStatus: currentStatus,
        newStatus: actualNextStatus,
        createdAt: FieldValue.serverTimestamp(),
        ...(isStaffRejecting && body.rejectionReason ? { rejectionReason: body.rejectionReason } : {}),
      };
      await db.collection("bookingActivities").add(activityData);
    } catch (activityError) {
      console.error("Failed to create booking activity:", activityError);
    }

    // === NEW NOTIFICATION WORKFLOW ===
    try {
      const finalServices = body.services || data.services || null;
      const finalStaffName = body.staffName || data.staffName || null;
      const finalServiceName = data.serviceName || null;
      const finalBookingDate = data.date || null;
      const finalBookingTime = data.time || null;
      const clientName = data.client || data.clientName || "Customer";

      // CASE 1: Admin confirms pending booking -> Send notification to STAFF (not customer)
      if (isAdminConfirmingPending || isAdminReassigning) {
        // Collect all unique staff UIDs that need to be notified
        const staffToNotify: Array<{ uid: string; name: string }> = [];
        
        if (finalServices && Array.isArray(finalServices) && finalServices.length > 0) {
          // Multi-service booking - notify each staff member
          for (const svc of finalServices) {
            if (svc.staffId && svc.staffId !== "null") {
              const existing = staffToNotify.find(s => s.uid === svc.staffId);
              if (!existing) {
                staffToNotify.push({ uid: svc.staffId, name: svc.staffName || "Staff" });
              }
            }
          }
        } else if (body.staffId) {
          // Single staff assignment
          staffToNotify.push({ uid: body.staffId, name: body.staffName || "Staff" });
        } else if (data.staffId) {
          // Use existing staff assignment
          staffToNotify.push({ uid: data.staffId, name: data.staffName || "Staff" });
        }
        
        // Send notification to each assigned staff member
        for (const staff of staffToNotify) {
          await createStaffAssignmentNotification({
            bookingId: id,
            bookingCode: data.bookingCode,
            staffUid: staff.uid,
            staffName: staff.name,
            clientName: clientName,
            clientPhone: data.clientPhone,
            serviceName: finalServiceName,
            services: finalServices?.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName,
              staffId: s.staffId,
            })),
            branchName: data.branchName,
            bookingDate: finalBookingDate,
            bookingTime: finalBookingTime,
            duration: data.duration,
            price: data.price,
            ownerUid: ownerUid,
            isReassignment: isAdminReassigning,
          });
        }
        
        console.log(`Sent staff assignment notifications to ${staffToNotify.length} staff member(s)`);
      }
      
      // CASE 2: Staff accepts booking -> Send confirmation notification to CUSTOMER
      else if (isStaffAccepting) {
        await createCustomerConfirmationNotification({
          bookingId: id,
          bookingCode: data.bookingCode,
          customerUid: data.customerUid,
          customerEmail: data.clientEmail,
          customerPhone: data.clientPhone,
          clientName: clientName,
          staffName: finalStaffName,
          serviceName: finalServiceName,
          services: finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
          })),
          branchName: data.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
          ownerUid: ownerUid,
        });
        
        console.log("Sent customer confirmation notification");
      }
      
      // CASE 3: Staff rejects booking -> Send notification to ADMIN
      else if (isStaffRejecting) {
        const { createAdminRejectionNotification } = await import("@/lib/notifications");
        
        await createAdminRejectionNotification({
          bookingId: id,
          bookingCode: data.bookingCode,
          ownerUid: ownerUid,
          rejectedByStaffUid: callerUid,
          rejectedByStaffName: userData?.name || userData?.displayName || "Staff",
          rejectionReason: body.rejectionReason || "No reason provided",
          clientName: clientName,
          serviceName: finalServiceName,
          services: finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
            staffId: s.staffId,
          })),
          branchName: data.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
        });
        
        console.log("Sent admin rejection notification");
      }
      
      // CASE 4: Other status changes (completed, canceled) -> Send customer notification
      else if (actualNextStatus === "Completed" || actualNextStatus === "Canceled") {
        const notificationContent = getNotificationContent(
          actualNextStatus, 
          data.bookingCode,
          finalStaffName,
          finalServiceName,
          finalBookingDate,
          finalBookingTime,
          finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName || "Any Available"
          }))
        );
        
        const notificationData: any = {
          bookingId: id,
          type: notificationContent.type,
          title: notificationContent.title,
          message: notificationContent.message,
          status: actualNextStatus,
          ownerUid: ownerUid,
        };
        
        if (data.customerUid) notificationData.customerUid = data.customerUid;
        if (data.clientEmail) notificationData.customerEmail = data.clientEmail;
        if (data.clientPhone) notificationData.customerPhone = data.clientPhone;
        if (data.bookingCode) notificationData.bookingCode = data.bookingCode;
        if (finalStaffName) notificationData.staffName = finalStaffName;
        if (finalServiceName) notificationData.serviceName = finalServiceName;
        if (data.branchName) notificationData.branchName = data.branchName;
        if (finalBookingDate) notificationData.bookingDate = finalBookingDate;
        if (finalBookingTime) notificationData.bookingTime = finalBookingTime;
        
        if (finalServices && Array.isArray(finalServices) && finalServices.length > 0) {
          notificationData.services = finalServices.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName || "Any Available"
          }));
        }
        
        await createNotification(notificationData);
      }
    } catch (notifError) {
      console.error("Failed to create notification:", notifError);
      // Don't fail the request if notification creation fails
    }

    return NextResponse.json({ ok: true, status: actualNextStatus });
  } catch (e: any) {
    console.error("Error in PATCH /api/bookings/[id]/status:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


