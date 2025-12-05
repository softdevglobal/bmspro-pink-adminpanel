import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canTransitionStatus, normalizeBookingStatus } from "@/lib/bookingTypes";
import { createNotification, getNotificationContent } from "@/lib/notifications";

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
    } catch {
      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({ ok: true, devNoop: true });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { 
      status?: string; 
      staffId?: string;
      staffName?: string;
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

    // Add staff assignment if provided
    if (body.staffId) {
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
      await db.collection("bookings").add(bookingData);
      
      // Delete from bookingRequests
      await ref.delete();
    } else {
      // Just update the booking
      await ref.update(updateData);
    }

    // Create notification for customer
    try {
      // Use the updated staff info if provided, otherwise use existing
      const finalStaffName = body.staffName || data.staffName || null;
      const finalServiceName = data.serviceName || null;
      const finalBookingDate = data.date || null;
      const finalBookingTime = data.time || null;
      
      const notificationContent = getNotificationContent(
        requestedStatus, 
        data.bookingCode,
        finalStaffName,
        finalServiceName,
        finalBookingDate,
        finalBookingTime
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


