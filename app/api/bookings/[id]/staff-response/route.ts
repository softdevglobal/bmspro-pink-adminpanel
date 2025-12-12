import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus } from "@/lib/bookingTypes";
import { 
  createCustomerConfirmationNotification, 
  createAdminRejectionNotification 
} from "@/lib/notifications";

export const runtime = "nodejs";

// CORS headers for mobile app
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle CORS preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * API endpoint for staff to accept or reject a booking assignment
 * This is specifically for the mobile app workflow
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let staffUid: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      staffUid = decoded.uid;
    } catch (verifyError: any) {
      console.error("Token verification failed:", verifyError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const body = (await req.json().catch(() => ({}))) as { 
      action: "accept" | "reject";
      rejectionReason?: string;
    };

    if (!body.action || !["accept", "reject"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid action. Must be 'accept' or 'reject'" }, { status: 400, headers: corsHeaders });
    }

    if (body.action === "reject" && !body.rejectionReason?.trim()) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400, headers: corsHeaders });
    }

    const db = adminDb();

    // Get staff user data
    const staffDoc = await db.doc(`users/${staffUid}`).get();
    const staffData = staffDoc.data();
    const staffName = staffData?.name || staffData?.displayName || "Staff";
    const ownerUid = staffData?.ownerUid || staffUid;

    // Find the booking
    const bookingRef = db.doc(`bookings/${id}`);
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404, headers: corsHeaders });
    }

    const bookingData = bookingSnap.data() as any;
    const currentStatus = normalizeBookingStatus(bookingData.status);

    // Verify booking is in AwaitingStaffApproval status
    if (currentStatus !== "AwaitingStaffApproval") {
      return NextResponse.json({ 
        error: `Cannot ${body.action} booking. Current status is ${currentStatus}. Only bookings awaiting staff approval can be accepted or rejected.` 
      }, { status: 400, headers: corsHeaders });
    }

    // Verify this staff member is assigned to this booking
    let isAssigned = false;
    
    // Check top-level staffId
    if (bookingData.staffId === staffUid) {
      isAssigned = true;
    }
    
    // Check services array
    if (bookingData.services && Array.isArray(bookingData.services)) {
      for (const service of bookingData.services) {
        if (service.staffId === staffUid) {
          isAssigned = true;
          break;
        }
      }
    }

    if (!isAssigned) {
      return NextResponse.json({ 
        error: "You are not assigned to this booking" 
      }, { status: 403, headers: corsHeaders });
    }

    const clientName = bookingData.client || bookingData.clientName || "Customer";
    const finalServices = bookingData.services || null;
    const finalServiceName = bookingData.serviceName || null;
    const finalBookingDate = bookingData.date || null;
    const finalBookingTime = bookingData.time || null;

    if (body.action === "accept") {
      // Staff accepts the booking
      const updateData: any = {
        status: "Confirmed",
        updatedAt: FieldValue.serverTimestamp(),
        acceptedByStaffUid: staffUid,
        acceptedByStaffName: staffName,
        acceptedAt: FieldValue.serverTimestamp(),
      };

      await bookingRef.update(updateData);

      // Create activity log
      try {
        await db.collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: id,
          bookingCode: bookingData.bookingCode || null,
          activityType: "booking_staff_accepted",
          clientName: clientName,
          serviceName: finalServiceName,
          branchName: bookingData.branchName || null,
          staffName: staffName,
          staffUid: staffUid,
          price: bookingData.price || null,
          date: finalBookingDate,
          time: finalBookingTime,
          previousStatus: currentStatus,
          newStatus: "Confirmed",
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to create activity log:", e);
      }

      // Send confirmation notification to customer
      try {
        await createCustomerConfirmationNotification({
          bookingId: id,
          bookingCode: bookingData.bookingCode,
          customerUid: bookingData.customerUid,
          customerEmail: bookingData.clientEmail,
          customerPhone: bookingData.clientPhone,
          clientName: clientName,
          staffName: staffName,
          serviceName: finalServiceName,
          services: finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
          })),
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
          ownerUid: ownerUid,
        });
        console.log("Sent customer confirmation notification");
      } catch (e) {
        console.error("Failed to send customer notification:", e);
      }

      return NextResponse.json({ 
        ok: true, 
        status: "Confirmed",
        message: "Booking accepted. Customer has been notified."
      }, { headers: corsHeaders });

    } else {
      // Staff rejects the booking
      const updateData: any = {
        status: "StaffRejected",
        updatedAt: FieldValue.serverTimestamp(),
        rejectedByStaffUid: staffUid,
        rejectedByStaffName: staffName,
        rejectionReason: body.rejectionReason,
        rejectedAt: FieldValue.serverTimestamp(),
      };

      await bookingRef.update(updateData);

      // Create activity log
      try {
        await db.collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: id,
          bookingCode: bookingData.bookingCode || null,
          activityType: "booking_staff_rejected",
          clientName: clientName,
          serviceName: finalServiceName,
          branchName: bookingData.branchName || null,
          staffName: staffName,
          staffUid: staffUid,
          price: bookingData.price || null,
          date: finalBookingDate,
          time: finalBookingTime,
          previousStatus: currentStatus,
          newStatus: "StaffRejected",
          rejectionReason: body.rejectionReason,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to create activity log:", e);
      }

      // Send rejection notification to admin
      try {
        await createAdminRejectionNotification({
          bookingId: id,
          bookingCode: bookingData.bookingCode,
          ownerUid: ownerUid,
          rejectedByStaffUid: staffUid,
          rejectedByStaffName: staffName,
          rejectionReason: body.rejectionReason || "No reason provided",
          clientName: clientName,
          serviceName: finalServiceName,
          services: finalServices?.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName,
            staffId: s.staffId,
          })),
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
        });
        console.log("Sent admin rejection notification");
      } catch (e) {
        console.error("Failed to send admin notification:", e);
      }

      return NextResponse.json({ 
        ok: true, 
        status: "StaffRejected",
        message: "Booking rejected. Admin has been notified for reassignment."
      }, { headers: corsHeaders });
    }

  } catch (e: any) {
    console.error("Error in POST /api/bookings/[id]/staff-response:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
