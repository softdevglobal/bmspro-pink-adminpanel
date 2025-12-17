import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus, type BookingService, type ServiceCompletionStatus, areAllServicesCompleted } from "@/lib/bookingTypes";
import { createNotification, getNotificationContent } from "@/lib/notifications";

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
 * API endpoint for staff to mark their assigned service as completed
 * When all services are completed, the booking automatically moves to "Completed" status
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
      serviceId?: string | number; // Optional: specify which service to complete (for multi-service bookings)
    };

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

    // Verify booking is in "Confirmed" status (only confirmed bookings can be completed)
    if (currentStatus !== "Confirmed") {
      return NextResponse.json({ 
        error: `Cannot complete service. Booking status is "${currentStatus}". Only confirmed bookings can be marked as completed.` 
      }, { status: 400, headers: corsHeaders });
    }

    // Check if this is a multi-service booking or single-service booking
    const hasMultipleServices = bookingData.services && Array.isArray(bookingData.services) && bookingData.services.length > 0;
    
    const clientName = bookingData.client || bookingData.clientName || "Customer";
    const finalBookingDate = bookingData.date || null;
    const finalBookingTime = bookingData.time || null;
    const nowDate = new Date().toISOString();

    if (hasMultipleServices) {
      // Multi-service booking - handle per-service completion
      const services: BookingService[] = bookingData.services;
      
      // Find services assigned to this staff member
      const staffServices = services.filter(s => 
        s.staffId === staffUid || (s as any).staffAuthUid === staffUid
      );
      
      if (staffServices.length === 0) {
        return NextResponse.json({ 
          error: "You are not assigned to any services in this booking" 
        }, { status: 403, headers: corsHeaders });
      }

      // Determine which services to mark as completed
      let servicesToComplete: BookingService[];
      
      if (body.serviceId !== undefined) {
        // Complete a specific service
        const targetService = staffServices.find(s => String(s.id) === String(body.serviceId));
        
        if (!targetService) {
          // Check if the service exists but belongs to another staff
          const serviceExists = services.find(s => String(s.id) === String(body.serviceId));
          if (serviceExists) {
            return NextResponse.json({ 
              error: "You are not assigned to this service" 
            }, { status: 403, headers: corsHeaders });
          }
          return NextResponse.json({ 
            error: "Service not found in this booking" 
          }, { status: 404, headers: corsHeaders });
        }
        
        if (targetService.completionStatus === "completed") {
          return NextResponse.json({ 
            error: "This service is already marked as completed" 
          }, { status: 400, headers: corsHeaders });
        }
        
        servicesToComplete = [targetService];
      } else {
        // Complete all services assigned to this staff that are not yet completed
        servicesToComplete = staffServices.filter(s => s.completionStatus !== "completed");
        
        if (servicesToComplete.length === 0) {
          return NextResponse.json({ 
            error: "All your assigned services are already completed" 
          }, { status: 400, headers: corsHeaders });
        }
      }

      // Update the services array with completion status
      const updatedServices = services.map(service => {
        const shouldComplete = servicesToComplete.some(s => String(s.id) === String(service.id));
        
        if (shouldComplete) {
          return {
            ...service,
            completionStatus: "completed" as ServiceCompletionStatus,
            completedAt: nowDate,
            completedByStaffUid: staffUid,
            completedByStaffName: staffName,
          };
        }
        return service;
      });

      // Check if all services are now completed
      const allCompleted = areAllServicesCompleted(updatedServices);
      
      // Prepare update data
      const updateData: any = {
        services: updatedServices,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // If all services are completed, update booking status to "Completed"
      if (allCompleted) {
        updateData.status = "Completed";
        updateData.completedAt = FieldValue.serverTimestamp();
        updateData.autoCompletedReason = "All services completed by staff";
      }

      await bookingRef.update(updateData);

      // Create activity log
      try {
        const serviceNames = servicesToComplete.map(s => s.name || "Service").join(", ");
        await db.collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: id,
          bookingCode: bookingData.bookingCode || null,
          activityType: allCompleted ? "booking_completed" : "booking_service_completed",
          clientName: clientName,
          serviceName: serviceNames,
          branchName: bookingData.branchName || null,
          staffName: staffName,
          staffUid: staffUid,
          price: bookingData.price || null,
          date: finalBookingDate,
          time: finalBookingTime,
          previousStatus: currentStatus,
          newStatus: allCompleted ? "Completed" : currentStatus,
          servicesCompleted: servicesToComplete.map(s => ({ id: s.id, name: s.name })),
          allServicesCompleted: allCompleted,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to create activity log:", e);
      }

      // Send notification to customer if booking is fully completed
      if (allCompleted) {
        try {
          const notificationContent = getNotificationContent(
            "Completed",
            bookingData.bookingCode,
            staffName,
            bookingData.serviceName,
            finalBookingDate,
            finalBookingTime,
            updatedServices.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName || "Staff"
            }))
          );
          
          const notificationData: any = {
            bookingId: id,
            type: notificationContent.type,
            title: notificationContent.title,
            message: notificationContent.message,
            status: "Completed",
            ownerUid: ownerUid,
          };
          
          if (bookingData.customerUid) notificationData.customerUid = bookingData.customerUid;
          if (bookingData.clientEmail) notificationData.customerEmail = bookingData.clientEmail;
          if (bookingData.clientPhone) notificationData.customerPhone = bookingData.clientPhone;
          if (bookingData.bookingCode) notificationData.bookingCode = bookingData.bookingCode;
          if (staffName) notificationData.staffName = staffName;
          if (bookingData.serviceName) notificationData.serviceName = bookingData.serviceName;
          if (bookingData.branchName) notificationData.branchName = bookingData.branchName;
          if (finalBookingDate) notificationData.bookingDate = finalBookingDate;
          if (finalBookingTime) notificationData.bookingTime = finalBookingTime;
          
          notificationData.services = updatedServices.map((s: any) => ({
            name: s.name || "Service",
            staffName: s.staffName || "Staff"
          }));
          
          await createNotification(notificationData);
          console.log("Sent booking completion notification to customer");
        } catch (e) {
          console.error("Failed to send customer notification:", e);
        }
      }

      // Calculate progress for response
      const completedCount = updatedServices.filter((s: any) => s.completionStatus === "completed").length;
      const totalCount = updatedServices.length;

      return NextResponse.json({ 
        ok: true, 
        status: allCompleted ? "Completed" : "Confirmed",
        bookingCompleted: allCompleted,
        message: allCompleted 
          ? "All services completed! Booking is now marked as complete. Customer has been notified."
          : `Service(s) marked as completed. (${completedCount}/${totalCount} services done)`,
        servicesCompleted: servicesToComplete.length,
        progress: {
          completed: completedCount,
          total: totalCount,
          percentage: Math.round((completedCount / totalCount) * 100)
        }
      }, { headers: corsHeaders });

    } else {
      // Single service booking - complete the entire booking
      // Verify this staff member is assigned to this booking
      const isAssignedToBooking = bookingData.staffId === staffUid || bookingData.staffAuthUid === staffUid;
      
      if (!isAssignedToBooking) {
        return NextResponse.json({ 
          error: "You are not assigned to this booking" 
        }, { status: 403, headers: corsHeaders });
      }

      // Check if already completed (check raw status to avoid type narrowing issues)
      if (bookingData.completionStatus === "completed" || bookingData.status === "Completed") {
        return NextResponse.json({ 
          error: "This booking is already marked as completed" 
        }, { status: 400, headers: corsHeaders });
      }

      const finalServiceName = bookingData.serviceName || "Service";

      // Update booking to completed
      const updateData: any = {
        status: "Completed",
        completedAt: FieldValue.serverTimestamp(),
        completedByStaffUid: staffUid,
        completedByStaffName: staffName,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await bookingRef.update(updateData);

      // Create activity log
      try {
        await db.collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: id,
          bookingCode: bookingData.bookingCode || null,
          activityType: "booking_completed",
          clientName: clientName,
          serviceName: finalServiceName,
          branchName: bookingData.branchName || null,
          staffName: staffName,
          staffUid: staffUid,
          price: bookingData.price || null,
          date: finalBookingDate,
          time: finalBookingTime,
          previousStatus: currentStatus,
          newStatus: "Completed",
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to create activity log:", e);
      }

      // Send notification to customer
      try {
        const notificationContent = getNotificationContent(
          "Completed",
          bookingData.bookingCode,
          staffName,
          finalServiceName,
          finalBookingDate,
          finalBookingTime,
          undefined
        );
        
        const notificationData: any = {
          bookingId: id,
          type: notificationContent.type,
          title: notificationContent.title,
          message: notificationContent.message,
          status: "Completed",
          ownerUid: ownerUid,
        };
        
        if (bookingData.customerUid) notificationData.customerUid = bookingData.customerUid;
        if (bookingData.clientEmail) notificationData.customerEmail = bookingData.clientEmail;
        if (bookingData.clientPhone) notificationData.customerPhone = bookingData.clientPhone;
        if (bookingData.bookingCode) notificationData.bookingCode = bookingData.bookingCode;
        if (staffName) notificationData.staffName = staffName;
        if (finalServiceName) notificationData.serviceName = finalServiceName;
        if (bookingData.branchName) notificationData.branchName = bookingData.branchName;
        if (finalBookingDate) notificationData.bookingDate = finalBookingDate;
        if (finalBookingTime) notificationData.bookingTime = finalBookingTime;
        
        await createNotification(notificationData);
        console.log("Sent booking completion notification to customer");
      } catch (e) {
        console.error("Failed to send customer notification:", e);
      }

      return NextResponse.json({ 
        ok: true, 
        status: "Completed",
        bookingCompleted: true,
        message: "Booking completed successfully! Customer has been notified.",
        progress: {
          completed: 1,
          total: 1,
          percentage: 100
        }
      }, { headers: corsHeaders });
    }

  } catch (e: any) {
    console.error("Error in POST /api/bookings/[id]/service-complete:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
