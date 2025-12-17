import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus, type BookingService, type ServiceApprovalStatus } from "@/lib/bookingTypes";
import { 
  createCustomerConfirmationNotification, 
  createAdminRejectionNotification,
  createCustomerReschedulingNotification
} from "@/lib/notifications";
import { logBookingStaffResponseServer } from "@/lib/auditLogServer";

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
 * API endpoint for staff to accept or reject a booking assignment
 * Supports per-service accept/reject for multi-service bookings
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
      serviceId?: string | number; // Optional: specify which service to accept/reject
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

    // Verify booking is in a state that allows staff response
    const allowedStatuses = ["AwaitingStaffApproval", "PartiallyApproved"];
    if (!allowedStatuses.includes(currentStatus)) {
      return NextResponse.json({ 
        error: `Cannot ${body.action} booking. Current status is ${currentStatus}. Only bookings awaiting staff approval or partially approved can be responded to.` 
      }, { status: 400, headers: corsHeaders });
    }

    // Check if this is a multi-service booking
    const hasMultipleServices = bookingData.services && Array.isArray(bookingData.services) && bookingData.services.length > 0;
    
    const clientName = bookingData.client || bookingData.clientName || "Customer";
    const finalBookingDate = bookingData.date || null;
    const finalBookingTime = bookingData.time || null;

    if (hasMultipleServices) {
      // Multi-service booking - handle per-service accept/reject
      const services: BookingService[] = bookingData.services;
      
      // Find services assigned to this staff member (check both staffId and staffAuthUid)
      const staffServices = services.filter(s => 
        s.staffId === staffUid || (s as any).staffAuthUid === staffUid
      );
      
      if (staffServices.length === 0) {
        return NextResponse.json({ 
          error: "You are not assigned to any services in this booking" 
        }, { status: 403, headers: corsHeaders });
      }

      // If serviceId is provided, only respond to that specific service
      // Otherwise, respond to all services assigned to this staff
      let servicesToUpdate: BookingService[];
      
      if (body.serviceId !== undefined) {
        // Find the target service - first check in staffServices, then in all services by ID
        let targetService = staffServices.find(s => String(s.id) === String(body.serviceId));
        
        // If not found in staffServices, check if the service exists and is assigned to this staff
        if (!targetService) {
          const serviceById = services.find(s => String(s.id) === String(body.serviceId));
          if (serviceById && (serviceById.staffId === staffUid || (serviceById as any).staffAuthUid === staffUid)) {
            targetService = serviceById;
          }
        }
        
        if (!targetService) {
          return NextResponse.json({ 
            error: "You are not assigned to this service" 
          }, { status: 403, headers: corsHeaders });
        }
        servicesToUpdate = [targetService];
      } else {
        // Respond to all services assigned to this staff that are still pending
        servicesToUpdate = staffServices.filter(s => !s.approvalStatus || s.approvalStatus === "pending");
        
        if (servicesToUpdate.length === 0) {
          return NextResponse.json({ 
            error: "You have already responded to all your assigned services" 
          }, { status: 400, headers: corsHeaders });
        }
      }

      // Update the services array with the staff's response
      // Note: FieldValue.serverTimestamp() can't be used in arrays, so use Date for service fields
      const nowDate = new Date().toISOString();
      const updatedServices = services.map(service => {
        const shouldUpdate = servicesToUpdate.some(s => String(s.id) === String(service.id));
        
        if (shouldUpdate) {
          if (body.action === "accept") {
            return {
              ...service,
              approvalStatus: "accepted" as ServiceApprovalStatus,
              acceptedAt: nowDate,
              respondedByStaffUid: staffUid,
              respondedByStaffName: staffName,
            };
          } else {
            return {
              ...service,
              approvalStatus: "rejected" as ServiceApprovalStatus,
              rejectedAt: nowDate,
              rejectionReason: body.rejectionReason,
              respondedByStaffUid: staffUid,
              respondedByStaffName: staffName,
            };
          }
        }
        return service;
      });

      // Calculate new booking status based on all service approvals
      const newBookingStatus = calculateBookingStatus(updatedServices);
      
      // Prepare update data
      const updateData: any = {
        services: updatedServices,
        status: newBookingStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // If all accepted, add acceptance metadata
      if (newBookingStatus === "Confirmed") {
        updateData.confirmedAt = FieldValue.serverTimestamp();
      }

      // If any rejected, add rejection metadata (for the most recent rejection)
      if (body.action === "reject") {
        updateData.lastRejectedByStaffUid = staffUid;
        updateData.lastRejectedByStaffName = staffName;
        updateData.lastRejectionReason = body.rejectionReason;
        updateData.lastRejectedAt = FieldValue.serverTimestamp();
      }

      await bookingRef.update(updateData);

      // Create activity log
      try {
        const serviceNames = servicesToUpdate.map(s => s.name || "Service").join(", ");
        await db.collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: id,
          bookingCode: bookingData.bookingCode || null,
          activityType: body.action === "accept" ? "booking_service_accepted" : "booking_service_rejected",
          clientName: clientName,
          serviceName: serviceNames,
          branchName: bookingData.branchName || null,
          staffName: staffName,
          staffUid: staffUid,
          price: bookingData.price || null,
          date: finalBookingDate,
          time: finalBookingTime,
          previousStatus: currentStatus,
          newStatus: newBookingStatus,
          servicesUpdated: servicesToUpdate.map(s => ({ id: s.id, name: s.name })),
          ...(body.action === "reject" ? { rejectionReason: body.rejectionReason } : {}),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to create activity log:", e);
      }

      // Create audit log for staff response
      try {
        const serviceNames = servicesToUpdate.map(s => s.name || "Service").join(", ");
        const performer = {
          uid: staffUid,
          name: staffName,
          role: staffData?.role || "salon_staff",
        };
        await logBookingStaffResponseServer(
          ownerUid,
          id,
          bookingData.bookingCode,
          clientName,
          body.action === "accept" ? "accepted" : "rejected",
          performer,
          serviceNames,
          body.rejectionReason,
          bookingData.branchName
        );
      } catch (e) {
        console.error("Failed to create audit log:", e);
      }

      // Send notifications based on new status
      if (newBookingStatus === "Confirmed") {
        // All services accepted - send confirmation to customer
        try {
          await createCustomerConfirmationNotification({
            bookingId: id,
            bookingCode: bookingData.bookingCode,
            customerUid: bookingData.customerUid,
            customerEmail: bookingData.clientEmail,
            customerPhone: bookingData.clientPhone,
            clientName: clientName,
            staffName: staffName,
            serviceName: bookingData.serviceName,
            services: updatedServices.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName,
            })),
            branchName: bookingData.branchName,
            bookingDate: finalBookingDate,
            bookingTime: finalBookingTime,
            ownerUid: ownerUid,
          });
          console.log("Sent customer confirmation notification - all services accepted");
        } catch (e) {
          console.error("Failed to send customer notification:", e);
        }
      } else if (body.action === "reject") {
        // A service was rejected - notify admin for reassignment
        try {
          const rejectedServices = updatedServices.filter((s: any) => s.approvalStatus === "rejected");
          await createAdminRejectionNotification({
            bookingId: id,
            bookingCode: bookingData.bookingCode,
            ownerUid: ownerUid,
            rejectedByStaffUid: staffUid,
            rejectedByStaffName: staffName,
            rejectionReason: body.rejectionReason || "No reason provided",
            clientName: clientName,
            serviceName: servicesToUpdate.map(s => s.name).join(", "),
            services: rejectedServices.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName,
              staffId: s.staffId,
            })),
            branchName: bookingData.branchName,
            bookingDate: finalBookingDate,
            bookingTime: finalBookingTime,
          });
          console.log("Sent admin rejection notification for service(s)");
        } catch (e) {
          console.error("Failed to send admin notification:", e);
        }
        
        // Also notify customer that their booking is being rescheduled
        // (Customer-friendly notification without exposing staff rejection details)
        try {
          await createCustomerReschedulingNotification({
            bookingId: id,
            bookingCode: bookingData.bookingCode,
            customerUid: bookingData.customerUid,
            customerEmail: bookingData.clientEmail,
            customerPhone: bookingData.clientPhone,
            clientName: clientName,
            serviceName: bookingData.serviceName,
            services: updatedServices.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName,
            })),
            branchName: bookingData.branchName,
            bookingDate: finalBookingDate,
            bookingTime: finalBookingTime,
            ownerUid: ownerUid,
          });
          console.log("Sent customer rescheduling notification (multi-service)");
        } catch (e) {
          console.error("Failed to send customer notification:", e);
        }
      }

      // Determine response message
      let message = "";
      if (body.action === "accept") {
        if (newBookingStatus === "Confirmed") {
          message = "All services accepted! Booking is now confirmed. Customer has been notified.";
        } else {
          message = `Service(s) accepted. Waiting for other staff to respond. (${updatedServices.filter((s: any) => s.approvalStatus === "accepted").length}/${updatedServices.length} accepted)`;
        }
      } else {
        message = "Service(s) rejected. Admin has been notified for reassignment.";
      }

      return NextResponse.json({ 
        ok: true, 
        status: newBookingStatus,
        message: message,
        servicesUpdated: servicesToUpdate.length,
        allServicesCount: services.length,
        acceptedCount: updatedServices.filter((s: any) => s.approvalStatus === "accepted").length,
        rejectedCount: updatedServices.filter((s: any) => s.approvalStatus === "rejected").length,
        pendingCount: updatedServices.filter((s: any) => !s.approvalStatus || s.approvalStatus === "pending").length,
      }, { headers: corsHeaders });

    } else {
      // Single service booking - original logic
      // Verify this staff member is assigned to this booking (check both staffId and staffAuthUid)
      const isAssignedToBooking = bookingData.staffId === staffUid || bookingData.staffAuthUid === staffUid;
      if (!isAssignedToBooking) {
      return NextResponse.json({ 
        error: "You are not assigned to this booking" 
      }, { status: 403, headers: corsHeaders });
    }

    const finalServiceName = bookingData.serviceName || null;

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
          services: undefined,
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
          ownerUid: ownerUid,
        });
        console.log("Sent customer confirmation notification");
      } catch (e) {
        console.error("Failed to send customer notification:", e);
      }

      // Create audit log for staff acceptance (single service)
      try {
        const performer = {
          uid: staffUid,
          name: staffName,
          role: staffData?.role || "salon_staff",
        };
        await logBookingStaffResponseServer(
          ownerUid,
          id,
          bookingData.bookingCode,
          clientName,
          "accepted",
          performer,
          finalServiceName,
          undefined,
          bookingData.branchName
        );
      } catch (e) {
        console.error("Failed to create audit log:", e);
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
          services: undefined,
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
        });
        console.log("Sent admin rejection notification");
      } catch (e) {
        console.error("Failed to send admin notification:", e);
      }
      
      // Also notify customer that their booking is being rescheduled
      // (Customer-friendly notification without exposing staff rejection details)
      try {
        await createCustomerReschedulingNotification({
          bookingId: id,
          bookingCode: bookingData.bookingCode,
          customerUid: bookingData.customerUid,
          customerEmail: bookingData.clientEmail,
          customerPhone: bookingData.clientPhone,
          clientName: clientName,
          serviceName: finalServiceName,
          branchName: bookingData.branchName,
          bookingDate: finalBookingDate,
          bookingTime: finalBookingTime,
          ownerUid: ownerUid,
        });
        console.log("Sent customer rescheduling notification (single service)");
      } catch (e) {
        console.error("Failed to send customer notification:", e);
      }

      // Create audit log for staff rejection (single service)
      try {
        const performer = {
          uid: staffUid,
          name: staffName,
          role: staffData?.role || "salon_staff",
        };
        await logBookingStaffResponseServer(
          ownerUid,
          id,
          bookingData.bookingCode,
          clientName,
          "rejected",
          performer,
          finalServiceName,
          body.rejectionReason,
          bookingData.branchName
        );
      } catch (e) {
        console.error("Failed to create audit log:", e);
      }

      return NextResponse.json({ 
        ok: true, 
        status: "StaffRejected",
        message: "Booking rejected. Admin has been notified for reassignment."
      }, { headers: corsHeaders });
      }
    }

  } catch (e: any) {
    console.error("Error in POST /api/bookings/[id]/staff-response:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
