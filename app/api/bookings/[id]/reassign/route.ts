import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus, type BookingService } from "@/lib/bookingTypes";
import { createStaffAssignmentNotification } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Calculate booking status based on service approval statuses
 */
function calculateBookingStatus(services: BookingService[]): string {
  if (!services || services.length === 0) return "AwaitingStaffApproval";
  
  const statuses = services.map(s => s.approvalStatus || "pending");
  const allAccepted = statuses.every(s => s === "accepted");
  const anyRejected = statuses.some(s => s === "rejected");
  const anyAccepted = statuses.some(s => s === "accepted");
  const allPending = statuses.every(s => s === "pending");
  
  if (allAccepted) return "Confirmed";
  if (anyRejected) return "StaffRejected";
  if (anyAccepted && !allPending) return "PartiallyApproved";
  return "AwaitingStaffApproval";
}

/**
 * API endpoint for admin to reassign a rejected booking/service to a new staff member
 * Supports:
 * - Reassigning the entire booking to new staff
 * - Reassigning specific rejected services within a multi-service booking
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let callerUid: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      callerUid = decoded.uid;
    } catch (verifyError: any) {
      console.error("Token verification failed:", verifyError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { 
      staffId?: string;
      staffName?: string;
      // For reassigning specific services only
      serviceId?: string | number;
      // For full multi-service reassignment
      services?: Array<{
        id: string | number;
        name?: string;
        staffId: string;
        staffName: string;
        duration?: number;
        price?: number;
        time?: string;
      }>;
    };

    const db = adminDb();

    // Get caller's user data to verify admin role
    const userDoc = await db.doc(`users/${callerUid}`).get();
    const userData = userDoc.data();
    const userRole = (userData?.role || "").toString();
    
    // Only salon_owner, salon_admin, or salon_branch_admin can reassign
    if (!["salon_owner", "salon_admin", "salon_branch_admin"].includes(userRole)) {
      return NextResponse.json({ error: "Only admins can reassign bookings" }, { status: 403 });
    }

    const ownerUid = userRole === "salon_owner" ? callerUid : (userData?.ownerUid || callerUid);

    // Find the booking
    const bookingRef = db.doc(`bookings/${id}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const bookingData = bookingSnap.data() as any;
    
    // Verify booking belongs to same owner
    if (bookingData.ownerUid !== ownerUid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentStatus = normalizeBookingStatus(bookingData.status);

    // Verify booking can be reassigned (StaffRejected or PartiallyApproved with rejected services)
    const allowedStatuses = ["StaffRejected", "PartiallyApproved"];
    if (!allowedStatuses.includes(currentStatus)) {
      return NextResponse.json({ 
        error: `Cannot reassign booking. Current status is ${currentStatus}. Only rejected or partially approved bookings can be reassigned.` 
      }, { status: 400 });
    }

    const hasExistingServices = bookingData.services && Array.isArray(bookingData.services) && bookingData.services.length > 0;
    const hasNewServicesProvided = body.services && Array.isArray(body.services) && body.services.length > 0;
    const isSingleServiceReassign = body.serviceId !== undefined && body.staffId;

    const clientName = bookingData.client || bookingData.clientName || "Customer";
    const finalServiceName = bookingData.serviceName || null;
    const finalBookingDate = bookingData.date || null;
    const finalBookingTime = bookingData.time || null;

    // Staff assignments to notify
    const staffToNotify: Array<{ uid: string; name: string; serviceName?: string }> = [];

    // Prepare update data
    const updateData: any = {
      updatedAt: FieldValue.serverTimestamp(),
      reassignedByUid: callerUid,
      reassignedAt: FieldValue.serverTimestamp(),
    };

    if (hasExistingServices && isSingleServiceReassign) {
      // Reassigning a single service within a multi-service booking
      const existingServices: BookingService[] = bookingData.services;
      const serviceIndex = existingServices.findIndex(s => String(s.id) === String(body.serviceId));
      
      if (serviceIndex === -1) {
        return NextResponse.json({ error: "Service not found in booking" }, { status: 404 });
      }

      const targetService = existingServices[serviceIndex];
      
      // Verify service was rejected
      if (targetService.approvalStatus !== "rejected") {
        return NextResponse.json({ 
          error: `Cannot reassign service. Current approval status is ${targetService.approvalStatus}. Only rejected services can be reassigned.` 
        }, { status: 400 });
      }

      // Update the specific service
      const updatedServices = existingServices.map((service, idx) => {
        if (idx === serviceIndex) {
          return {
            ...service,
            staffId: body.staffId,
            staffName: body.staffName || "Staff",
            approvalStatus: "pending" as const,
            acceptedAt: undefined,
            rejectedAt: undefined,
            rejectionReason: undefined,
            respondedByStaffUid: undefined,
            respondedByStaffName: undefined,
          };
        }
        return service;
      });

      updateData.services = updatedServices;
      
      // Calculate new status based on updated services
      const newStatus = calculateBookingStatus(updatedServices);
      updateData.status = newStatus;

      staffToNotify.push({ 
        uid: body.staffId!, 
        name: body.staffName || "Staff",
        serviceName: targetService.name || "Service"
      });

    } else if (hasNewServicesProvided) {
      // Full multi-service reassignment with new staff for each service
      // Reset all services with new staff and pending status
      updateData.services = body.services!.map((service: any) => ({
        ...service,
        approvalStatus: "pending",
        acceptedAt: undefined,
        rejectedAt: undefined,
        rejectionReason: undefined,
        respondedByStaffUid: undefined,
        respondedByStaffName: undefined,
      }));
      
      updateData.status = "AwaitingStaffApproval";
      updateData.staffId = FieldValue.delete();
      updateData.staffName = FieldValue.delete();
      
      // Clear previous rejection info
      updateData.rejectionReason = FieldValue.delete();
      updateData.rejectedByStaffUid = FieldValue.delete();
      updateData.rejectedByStaffName = FieldValue.delete();
      updateData.rejectedAt = FieldValue.delete();
      updateData.lastRejectedByStaffUid = FieldValue.delete();
      updateData.lastRejectedByStaffName = FieldValue.delete();
      updateData.lastRejectionReason = FieldValue.delete();
      updateData.lastRejectedAt = FieldValue.delete();
      
      // Collect unique staff to notify
      for (const svc of body.services!) {
        if (svc.staffId && svc.staffId !== "null") {
          const existing = staffToNotify.find(s => s.uid === svc.staffId);
          if (!existing) {
            staffToNotify.push({ uid: svc.staffId, name: svc.staffName || "Staff" });
          }
        }
      }

    } else if (body.staffId) {
      // Single service booking reassignment
      updateData.staffId = body.staffId;
      updateData.staffName = body.staffName || "Staff";
      updateData.status = "AwaitingStaffApproval";
      
      // Clear previous rejection info
      updateData.rejectionReason = FieldValue.delete();
      updateData.rejectedByStaffUid = FieldValue.delete();
      updateData.rejectedByStaffName = FieldValue.delete();
      updateData.rejectedAt = FieldValue.delete();
      
      staffToNotify.push({ uid: body.staffId, name: body.staffName || "Staff" });

    } else {
      return NextResponse.json({ 
        error: "New staff assignment is required for reassignment" 
      }, { status: 400 });
    }

    // Update the booking
    await bookingRef.update(updateData);

    // Create activity log
    try {
      const reassignedServiceNames = isSingleServiceReassign 
        ? staffToNotify.map(s => s.serviceName).join(", ")
        : (body.services?.map(s => s.name).join(", ") || finalServiceName);

      await db.collection("bookingActivities").add({
        ownerUid: ownerUid,
        bookingId: id,
        bookingCode: bookingData.bookingCode || null,
        activityType: isSingleServiceReassign ? "booking_service_reassigned" : "booking_reassigned",
        clientName: clientName,
        serviceName: reassignedServiceNames,
        branchName: bookingData.branchName || null,
        staffName: staffToNotify.map(s => s.name).join(", "),
        reassignedByUid: callerUid,
        price: bookingData.price || null,
        date: finalBookingDate,
        time: finalBookingTime,
        previousStatus: currentStatus,
        newStatus: updateData.status,
        previouslyRejectedBy: bookingData.lastRejectedByStaffName || bookingData.rejectedByStaffName,
        previousRejectionReason: bookingData.lastRejectionReason || bookingData.rejectionReason,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error("Failed to create activity log:", e);
    }

    // Send notifications to newly assigned staff
    try {
      const finalServices = updateData.services || body.services || bookingData.services || null;
      
      for (const staff of staffToNotify) {
        // Get services for this specific staff member
        const staffServices = finalServices?.filter((s: any) => s.staffId === staff.uid) || [];
        
        await createStaffAssignmentNotification({
          bookingId: id,
          bookingCode: bookingData.bookingCode,
          staffUid: staff.uid,
          staffName: staff.name,
          clientName: clientName,
          clientPhone: bookingData.clientPhone,
          serviceName: staff.serviceName || finalServiceName,
          services: staffServices.length > 0 ? staffServices.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
            staffId: s.staffId,
          })) : null,
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
          duration: bookingData.duration,
          price: bookingData.price,
          ownerUid: ownerUid,
          isReassignment: true,
        });
      }
      console.log(`Sent reassignment notifications to ${staffToNotify.length} staff member(s)`);
    } catch (e) {
      console.error("Failed to send staff notifications:", e);
    }

    const message = isSingleServiceReassign
      ? `Service reassigned to ${staffToNotify[0]?.name}. Staff has been notified.`
      : `Booking reassigned to ${staffToNotify.map(s => s.name).join(", ")}. Staff has been notified.`;

    return NextResponse.json({ 
      ok: true, 
      status: updateData.status,
      message: message,
      assignedStaff: staffToNotify,
    });

  } catch (e: any) {
    console.error("Error in POST /api/bookings/[id]/reassign:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
