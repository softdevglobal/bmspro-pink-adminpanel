import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus } from "@/lib/bookingTypes";
import { createStaffAssignmentNotification } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * API endpoint for admin to reassign a rejected booking to a new staff member
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

    // Verify booking is in StaffRejected status (can be reassigned)
    if (currentStatus !== "StaffRejected") {
      return NextResponse.json({ 
        error: `Cannot reassign booking. Current status is ${currentStatus}. Only rejected bookings can be reassigned.` 
      }, { status: 400 });
    }

    // Validate that we have new staff assignment
    const hasMultipleServices = body.services && Array.isArray(body.services) && body.services.length > 0;
    
    if (!hasMultipleServices && !body.staffId) {
      return NextResponse.json({ 
        error: "New staff assignment is required for reassignment" 
      }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {
      status: "AwaitingStaffApproval",
      updatedAt: FieldValue.serverTimestamp(),
      reassignedByUid: callerUid,
      reassignedAt: FieldValue.serverTimestamp(),
      // Clear previous rejection info
      rejectionReason: FieldValue.delete(),
      rejectedByStaffUid: FieldValue.delete(),
      rejectedByStaffName: FieldValue.delete(),
      rejectedAt: FieldValue.delete(),
    };

    // Staff assignments to notify
    const staffToNotify: Array<{ uid: string; name: string }> = [];

    if (hasMultipleServices) {
      updateData.services = body.services;
      updateData.staffId = FieldValue.delete();
      updateData.staffName = FieldValue.delete();
      
      // Collect unique staff to notify
      for (const svc of body.services!) {
        if (svc.staffId && svc.staffId !== "null") {
          const existing = staffToNotify.find(s => s.uid === svc.staffId);
          if (!existing) {
            staffToNotify.push({ uid: svc.staffId, name: svc.staffName || "Staff" });
          }
        }
      }
    } else {
      updateData.staffId = body.staffId;
      updateData.staffName = body.staffName || "Staff";
      staffToNotify.push({ uid: body.staffId!, name: body.staffName || "Staff" });
    }

    // Update the booking
    await bookingRef.update(updateData);

    const clientName = bookingData.client || bookingData.clientName || "Customer";
    const finalServiceName = bookingData.serviceName || null;
    const finalBookingDate = bookingData.date || null;
    const finalBookingTime = bookingData.time || null;

    // Create activity log
    try {
      await db.collection("bookingActivities").add({
        ownerUid: ownerUid,
        bookingId: id,
        bookingCode: bookingData.bookingCode || null,
        activityType: "booking_reassigned",
        clientName: clientName,
        serviceName: finalServiceName,
        branchName: bookingData.branchName || null,
        staffName: staffToNotify.map(s => s.name).join(", "),
        reassignedByUid: callerUid,
        price: bookingData.price || null,
        date: finalBookingDate,
        time: finalBookingTime,
        previousStatus: currentStatus,
        newStatus: "AwaitingStaffApproval",
        previouslyRejectedBy: bookingData.rejectedByStaffName,
        previousRejectionReason: bookingData.rejectionReason,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error("Failed to create activity log:", e);
    }

    // Send notifications to newly assigned staff
    try {
      const finalServices = body.services || bookingData.services || null;
      
      for (const staff of staffToNotify) {
        await createStaffAssignmentNotification({
          bookingId: id,
          bookingCode: bookingData.bookingCode,
          staffUid: staff.uid,
          staffName: staff.name,
          clientName: clientName,
          clientPhone: bookingData.clientPhone,
          serviceName: finalServiceName,
          services: finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
            staffId: s.staffId,
          })),
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

    return NextResponse.json({ 
      ok: true, 
      status: "AwaitingStaffApproval",
      message: `Booking reassigned to ${staffToNotify.map(s => s.name).join(", ")}. Staff has been notified.`,
      assignedStaff: staffToNotify,
    });

  } catch (e: any) {
    console.error("Error in POST /api/bookings/[id]/reassign:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
