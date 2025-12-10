import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canTransitionStatus, normalizeBookingStatus } from "@/lib/bookingTypes";
import { createNotification, getNotificationContent } from "@/lib/notifications";

// Helper to get activity type from status
function getActivityType(status: string): string {
  const s = status.toLowerCase();
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

    let ownerUid: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      ownerUid = decoded.uid;
    } catch (verifyError: any) {
      console.error("Token verification failed:", verifyError);
      
      // Detailed error info for debugging Vercel issues
      const errorDetails = {
        code: verifyError?.code,
        message: verifyError?.message,
        stack: process.env.NODE_ENV !== "production" ? verifyError?.stack : undefined,
        // Do not log full token
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
    };
    const requestedStatus = normalizeBookingStatus(body?.status || "");

    const db = adminDb();
    
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
    if (!canTransitionStatus(currentStatus, requestedStatus)) {
      return NextResponse.json({ error: `Invalid transition ${currentStatus} -> ${requestedStatus}` }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {
      status: requestedStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add services update if provided (for multi-service staff assignment)
    if (body.services && Array.isArray(body.services) && body.services.length > 0) {
      updateData.services = body.services;
      
      // If we have services, we don't need top-level staff info
      // We'll mark them for deletion if this is an update to an existing booking
      if (!isBookingRequest) {
        updateData.staffId = FieldValue.delete();
        updateData.staffName = FieldValue.delete();
      }
    } else if (body.staffId) {
      // Only set top-level staff if no services array update (legacy support)
      updateData.staffId = body.staffId;
      updateData.staffName = body.staffName || "Staff";
    }

    // If confirming a booking request, move it to bookings collection
    if (isBookingRequest && requestedStatus === "Confirmed") {
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
        activityType: getActivityType(requestedStatus),
        clientName: data.client || data.clientName || "Unknown",
        serviceName: data.serviceName || null,
        branchName: data.branchName || null,
        staffName: body.staffName || data.staffName || null,
        price: data.price || null,
        date: data.date || null,
        time: data.time || null,
        previousStatus: currentStatus,
        newStatus: requestedStatus,
        createdAt: FieldValue.serverTimestamp(),
      };
      await db.collection("bookingActivities").add(activityData);
    } catch (activityError) {
      console.error("Failed to create booking activity:", activityError);
      // Don't fail the request if activity creation fails
    }

    // Create notification for customer
    try {
      const finalStaffName = body.staffName || data.staffName || null;
      const finalServiceName = data.serviceName || null;
      const finalBookingDate = data.date || null;
      const finalBookingTime = data.time || null;
      const finalServices = body.services || data.services || null;
      
      const notificationContent = getNotificationContent(
        requestedStatus, 
        data.bookingCode,
        finalStaffName,
        finalServiceName,
        finalBookingDate,
        finalBookingTime,
        finalServices ? finalServices.map((s: any) => ({
          name: s.name || "Service",
          staffName: s.staffName || "Any Available"
        })) : undefined
      );
      
      // Build notification data with only defined values
      const notificationData: any = {
        bookingId: id,
        type: notificationContent.type,
        title: notificationContent.title,
        message: notificationContent.message,
        status: requestedStatus,
        ownerUid: ownerUid,
      };
      
      // Only add optional fields if they exist
      if (data.customerUid) notificationData.customerUid = data.customerUid;
      if (data.clientEmail) notificationData.customerEmail = data.clientEmail;
      if (data.clientPhone) notificationData.customerPhone = data.clientPhone;
      if (data.bookingCode) notificationData.bookingCode = data.bookingCode;
      
      // Add booking details for richer notifications
      if (finalStaffName) notificationData.staffName = finalStaffName;
      if (finalServiceName) notificationData.serviceName = finalServiceName;
      if (data.branchName) notificationData.branchName = data.branchName;
      if (finalBookingDate) notificationData.bookingDate = finalBookingDate;
      if (finalBookingTime) notificationData.bookingTime = finalBookingTime;
      
      // Add services list if available
      if (finalServices && Array.isArray(finalServices) && finalServices.length > 0) {
        notificationData.services = finalServices.map((s: any) => ({
          name: s.name || "Service",
          staffName: s.staffName || "Any Available"
        }));
      }
      
      await createNotification(notificationData);
    } catch (notifError) {
      console.error("Failed to create notification:", notifError);
      // Don't fail the request if notification creation fails
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


