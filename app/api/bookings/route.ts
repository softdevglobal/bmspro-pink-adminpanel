import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminMessaging } from "@/lib/firebaseAdmin";
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { Message } from "firebase-admin/messaging";
import { normalizeBookingStatus, shouldBlockSlots } from "@/lib/bookingTypes";
import { generateBookingCode } from "@/lib/bookings";
import { checkRateLimit, getClientIdentifier, RateLimiters, getRateLimitHeaders } from "@/lib/rateLimiterDistributed";
import { logBookingCreatedServer } from "@/lib/auditLogServer";
import { createStaffAssignmentNotification, createOwnerNotification } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Check if a staff ID represents "Any Staff" (unassigned)
 */
function isAnyStaff(staffId?: string | null): boolean {
  if (!staffId) return true; // null, undefined, or empty
  const str = String(staffId).trim().toLowerCase();
  return str === "" || str === "null" || str.includes("any");
}

/**
 * Check if a booking has "Any Staff" assignments
 */
function hasAnyStaffBooking(
  services?: Array<{ staffId?: string | null; staffName?: string | null }> | null,
  staffId?: string | null,
  staffName?: string | null
): boolean {
  // Check services array for multi-service bookings
  if (services && Array.isArray(services) && services.length > 0) {
    return services.some(s => {
      // Check both staffId and staffName for "Any Staff" indicators
      const hasAnyStaffId = isAnyStaff(s.staffId);
      const hasAnyStaffName = !!(s.staffName && (
        s.staffName.toLowerCase().includes("any available") ||
        s.staffName.toLowerCase().includes("any staff") ||
        s.staffName.toLowerCase() === "any"
      ));
      return hasAnyStaffId || hasAnyStaffName;
    });
  }
  // Single service booking - check both staffId and staffName
  const hasAnyStaffId = isAnyStaff(staffId);
  const hasAnyStaffName = !!(staffName && (
    staffName.toLowerCase().includes("any available") ||
    staffName.toLowerCase().includes("any staff") ||
    staffName.toLowerCase() === "any"
  ));
  return hasAnyStaffId || hasAnyStaffName;
}

/**
 * Get all branch admin UIDs for a branch
 * Branch admins are stored in the users collection with role='salon_branch_admin' and matching branchId
 */
async function getBranchAdminUids(db: Firestore, branchId: string, ownerUid: string): Promise<string[]> {
  try {
    // Query users collection for branch admins
    // Branch admins have: role='salon_branch_admin', ownerUid matches, and branchId matches
    const branchAdminQuery = await db.collection("users")
      .where("ownerUid", "==", ownerUid)
      .where("role", "==", "salon_branch_admin")
      .where("branchId", "==", branchId)
      .get();
    
    const branchAdminUids = branchAdminQuery.docs.map(doc => doc.id);
    
    // Also check legacy adminStaffId in branch document (for backward compatibility)
    if (branchAdminUids.length === 0) {
      const branchDoc = await db.collection("branches").doc(branchId).get();
      if (branchDoc.exists) {
        const branchData = branchDoc.data();
        if (branchData?.adminStaffId) {
          return [branchData.adminStaffId];
        }
      }
    }
    
    return branchAdminUids;
  } catch (error) {
    console.error("Error getting branch admins:", error);
    return [];
  }
}

/**
 * Get FCM token for a user
 */
async function getUserFcmToken(db: Firestore, userUid: string): Promise<string | null> {
  try {
    // Check users collection first
    const userDoc = await db.collection("users").doc(userUid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData?.fcmToken) {
        return userData.fcmToken;
      }
    }
    
    // Also check salon_staff collection
    const staffDoc = await db.collection("salon_staff").doc(userUid).get();
    if (staffDoc.exists) {
      const staffData = staffDoc.data();
      if (staffData?.fcmToken) {
        return staffData.fcmToken;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error getting FCM token for user:", userUid, error);
    return null;
  }
}

/**
 * Send FCM push notification
 */
async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const messaging = adminMessaging();
    
    const message: Message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: data || {},
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "appointments",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    await messaging.send(message);
    console.log("✅ Push notification sent successfully");
  } catch (error: any) {
    // Don't throw error - push notification failure shouldn't break notification creation
    console.error("⚠️ Error sending push notification:", error?.message || error);
    if (error?.code === "messaging/invalid-registration-token" || 
        error?.code === "messaging/registration-token-not-registered") {
      console.log("Invalid FCM token detected, but continuing with notification creation");
    }
  }
}

type CreateBookingInput = {
  client: string;
  clientEmail?: string;
  clientPhone?: string;
  notes?: string;
  serviceId: string | number;
  serviceName?: string;
  staffId: string;
  staffName?: string;
  branchId: string;
  branchName?: string;
  branchTimezone?: string; // IANA timezone for the branch
  date: string; // YYYY-MM-DD in branch's local timezone
  time: string; // HH:mm in branch's local timezone
  dateTimeUtc?: string; // ISO string in UTC for consistent storage
  duration: number;
  status?: string;
  price: number;
  services?: any[];
};

export async function POST(req: NextRequest) {
  try {
    // Security: Distributed rate limiting to prevent booking spam
    // Works across all serverless instances (Vercel, etc.)
    const clientId = getClientIdentifier(req);
    const rateLimitResult = await checkRateLimit(clientId, RateLimiters.booking);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many booking requests. Please try again later.",
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // Security: Limit request size to prevent DoS attacks (CVE-2025-55184)
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let ownerUid: string;
    let currentUserId: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      currentUserId = decoded.uid;
      
      // Check if user is a branch admin or staff - if so, use their ownerUid
      const userDoc = await adminDb().doc(`users/${currentUserId}`).get();
      const userData = userDoc.data();
      
      if (userData) {
        const userRole = userData.role || userData.systemRole;
        // For branch admins and staff, use their ownerUid field (the salon owner's UID)
        if ((userRole === "salon_branch_admin" || userRole === "salon_staff") && userData.ownerUid) {
          ownerUid = userData.ownerUid;
        } else {
          // For salon owners, use their own UID
          ownerUid = currentUserId;
        }
      } else {
        ownerUid = currentUserId;
      }
    } catch (e) {
      // In development, allow no-op response so the client-side fallback can persist
      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json({ id: "DEV_LOCAL", devNoop: true });
      }
      throw e;
    }

    const body = (await req.json()) as Partial<CreateBookingInput>;

    // Basic validation
    const required: Array<keyof CreateBookingInput> = [
      "client",
      "serviceId",
      // "staffId", // Optional for multi-service bookings
      "branchId",
      "date",
      "time",
      "duration",
      "price",
    ];
    for (const key of required) {
      if ((body as any)?.[key] === undefined || (body as any)?.[key] === null || (String((body as any)[key]).trim() === "" && typeof (body as any)[key] !== "number")) {
        return NextResponse.json({ error: `Missing field: ${key}` }, { status: 400 });
      }
    }

    // Enrich names and timezone if not provided
    let serviceName = body.serviceName || null;
    let staffName = body.staffName || null;
    let branchName = body.branchName || null;
    let branchTimezone = body.branchTimezone || null;

    try {
      if (!serviceName && body.serviceId) {
        // If multiple services (string with comma), skip lookup or fetch first
        if (String(body.serviceId).includes(",")) {
          // already provided or will be null
        } else {
          const s = await adminDb().doc(`services/${String(body.serviceId)}`).get();
          serviceName = (s.data() as any)?.name || null;
        }
      }
    } catch {}
    try {
      if (!staffName && body.staffId) {
        const st = await adminDb().doc(`salon_staff/${String(body.staffId)}`).get();
        staffName = (st.data() as any)?.name || null;
      }
    } catch {}
    try {
      if ((!branchName || !branchTimezone) && body.branchId) {
        const b = await adminDb().doc(`branches/${String(body.branchId)}`).get();
        const branchData = b.data() as any;
        if (!branchName) branchName = branchData?.name || null;
        if (!branchTimezone) branchTimezone = branchData?.timezone || "Australia/Sydney"; // Default fallback
      }
    } catch {}

    // Determine booking source based on user role
    // We need to fetch the current user's data (not the owner) for the booking source
    let bookingSource = "AdminBooking";
    try {
      const currentUserDoc = await adminDb().doc(`users/${currentUserId}`).get();
      const currentUserData = currentUserDoc.data();
      if (currentUserData) {
        const userRole = currentUserData.role || currentUserData.systemRole;
        const userBranchName = currentUserData.branchName || branchName;
        const userName = currentUserData.displayName || currentUserData.name || "Staff";
        
        if (userRole === "salon_branch_admin") {
          bookingSource = `Branch Admin Booking - ${userBranchName || "Unknown Branch"}`;
        } else if (userRole === "salon_owner") {
          bookingSource = "Salon Owner Booking";
        } else if (userRole === "salon_staff") {
          // For staff bookings, show the staff member's name instead of branch
          bookingSource = `Staff Booking - ${userName}`;
        }
      }
    } catch (roleError) {
      console.error("Failed to get user role for booking source:", roleError);
    }

    // Validate that the requested time slots are not already booked
    const db = adminDb();
    const dateStr = String(body.date);
    
    // Helper function to check if two time ranges overlap
    const timeRangesOverlap = (
      start1: number, end1: number,
      start2: number, end2: number
    ): boolean => {
      // Overlap occurs if: start1 < end2 && start2 < end1
      return start1 < end2 && start2 < end1;
    };

    // Helper function to parse time string to minutes
    const timeToMinutes = (timeStr: string): number => {
      const parts = timeStr.split(':').map(Number);
      if (parts.length < 2) return 0;
      return parts[0] * 60 + parts[1];
    };

    // Use centralized helper to check if booking status should block slots
    const isActiveStatus = (status: string | undefined): boolean => {
      return shouldBlockSlots(status);
    };

    // Check for existing bookings that would conflict
    try {
      // Query bookings for the same date
      const bookingsQuery = db.collection("bookings")
        .where("ownerUid", "==", ownerUid)
        .where("date", "==", dateStr);
      
      const bookingRequestsQuery = db.collection("bookingRequests")
        .where("ownerUid", "==", ownerUid)
        .where("date", "==", dateStr);

      const [bookingsSnapshot, bookingRequestsSnapshot] = await Promise.all([
        bookingsQuery.get().catch(() => ({ docs: [] })),
        bookingRequestsQuery.get().catch(() => ({ docs: [] }))
      ]);

      // Combine results from both collections
      const allExistingBookings: Array<any> = [
        ...bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...bookingRequestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      ];

      // Check each service in the new booking request
      const servicesToCheck = body.services && Array.isArray(body.services) && body.services.length > 0
        ? body.services
        : [{
            id: body.serviceId,
            time: body.time,
            duration: body.duration,
            staffId: body.staffId || null
          }];

      for (const newService of servicesToCheck) {
        const newServiceTime = newService.time || body.time;
        const newServiceDuration = newService.duration || body.duration;
        const newServiceStaffId = newService.staffId || body.staffId || null;

        if (!newServiceTime) continue;

        const newStartMinutes = timeToMinutes(newServiceTime);
        const newEndMinutes = newStartMinutes + newServiceDuration;

        // Check against all existing bookings
        for (const existingBooking of allExistingBookings) {
          // Skip if booking is not active
          if (!isActiveStatus(existingBooking.status)) continue;

          // Check if this is a multi-service booking
          if (existingBooking.services && Array.isArray(existingBooking.services) && existingBooking.services.length > 0) {
            // Check each service in the existing booking
            for (const existingService of existingBooking.services) {
              if (!existingService.time) continue;
              
              const existingServiceStaffId = existingService.staffId || existingBooking.staffId || null;
              
              // Only check if same staff (or both are "any staff")
              if (newServiceStaffId && existingServiceStaffId) {
                if (newServiceStaffId !== existingServiceStaffId) continue;
              } else if (newServiceStaffId || existingServiceStaffId) {
                // If one has staff and other doesn't, they might conflict
                // For safety, we'll check them
              }

              const existingStartMinutes = timeToMinutes(existingService.time);
              const existingDuration = existingService.duration || existingBooking.duration || 60;
              const existingEndMinutes = existingStartMinutes + existingDuration;

              // Check for overlap
              if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
                return NextResponse.json(
                  { 
                    error: "Time slot already booked",
                    details: `The selected time ${newServiceTime} conflicts with an existing booking. Please choose a different time.`
                  },
                  { status: 409 } // 409 Conflict
                );
              }
            }
          } else {
            // Single-service booking
            if (!existingBooking.time) continue;

            const existingStaffId = existingBooking.staffId || null;
            
            // Only check if same staff (or both are "any staff")
            if (newServiceStaffId && existingStaffId) {
              if (newServiceStaffId !== existingStaffId) continue;
            } else if (newServiceStaffId || existingStaffId) {
              // If one has staff and other doesn't, they might conflict
              // For safety, we'll check them
            }

            const existingStartMinutes = timeToMinutes(existingBooking.time);
            const existingDuration = existingBooking.duration || 60;
            const existingEndMinutes = existingStartMinutes + existingDuration;

            // Check for overlap
            if (timeRangesOverlap(newStartMinutes, newEndMinutes, existingStartMinutes, existingEndMinutes)) {
              return NextResponse.json(
                { 
                  error: "Time slot already booked",
                  details: `The selected time ${newServiceTime} conflicts with an existing booking. Please choose a different time.`
                },
                { status: 409 } // 409 Conflict
              );
            }
          }
        }
      }
    } catch (validationError: any) {
      // Log the error but don't fail the booking if validation query fails
      // This is a safety check, so we'll proceed if we can't verify
      console.error("Error validating booking availability:", validationError);
      // In production, you might want to be more strict and reject the booking
      // For now, we'll proceed but log the error
    }

    const bookingCode = generateBookingCode();
    
    // Determine if this is a staff-created booking (auto-confirm)
    let finalStatus = normalizeBookingStatus(body.status || "Pending");
    let processedServices = body.services || null;
    
    // Check if user is staff, salon_owner, or salon_branch_admin for auto-confirmation logic
    try {
      const currentUserDoc = await adminDb().doc(`users/${currentUserId}`).get();
      const currentUserData = currentUserDoc.data();
      if (currentUserData) {
        const userRole = currentUserData.role || currentUserData.systemRole;
        
        if (userRole === "salon_staff") {
          // Auto-confirm staff bookings (all services accepted immediately)
          finalStatus = "Confirmed";
          
          // Mark services as accepted if services array exists
          if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
            processedServices = processedServices.map((service: any) => ({
              ...service,
              approvalStatus: "accepted",
            }));
          }
        } else if (userRole === "salon_owner" || userRole === "salon_branch_admin") {
          // For salon_owner and salon_branch_admin: skip Pending status
          // If services have staff assigned, go directly to AwaitingStaffApproval
          // If all services need assignment, still go to AwaitingStaffApproval (not Pending)
          
          // Initialize services with approval status
          if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
            processedServices = processedServices.map((service: any) => {
              const hasStaff = service.staffId && service.staffId !== "null" && 
                               !String(service.staffId).toLowerCase().includes("any");
              return {
                ...service,
                // Services with valid staff get "pending" approval status
                // Services without staff (Any Available) get "needs_assignment" status
                approvalStatus: hasStaff ? "pending" : "needs_assignment",
              };
            });
            
            // Check if any service has staff assigned
            const hasAnyAssignedStaff = processedServices.some((s: any) => 
              s.approvalStatus === "pending"
            );
            
            // Skip Pending status - go directly to AwaitingStaffApproval
            if (hasAnyAssignedStaff || processedServices.some((s: any) => s.approvalStatus === "needs_assignment")) {
              finalStatus = "AwaitingStaffApproval";
            }
          } else if (body.staffId && body.staffId !== "null" && 
                     !String(body.staffId).toLowerCase().includes("any")) {
            // Single service booking with staff assigned - skip Pending
            finalStatus = "AwaitingStaffApproval";
          } else {
            // Single service booking without staff - still skip Pending for owner/admin
            finalStatus = "AwaitingStaffApproval";
          }
        }
      }
    } catch (roleError) {
      console.error("Failed to check user role for auto-confirmation:", roleError);
    }
    
    const payload: any = {
      ownerUid,
      client: String(body.client),
      clientEmail: body.clientEmail || null,
      clientPhone: body.clientPhone || null,
      notes: body.notes || null,
      serviceId: typeof body.serviceId === "number" ? body.serviceId : String(body.serviceId),
      serviceName: serviceName,
      staffId: body.staffId ? String(body.staffId) : null,
      staffName: staffName,
      branchId: String(body.branchId),
      branchName: branchName,
      branchTimezone: branchTimezone, // Store branch timezone
      date: String(body.date), // YYYY-MM-DD in branch's local timezone (for backward compatibility)
      time: String(body.time), // HH:mm in branch's local timezone (for backward compatibility)
      dateTimeUtc: body.dateTimeUtc || null, // UTC ISO string for consistent storage
      duration: Number(body.duration) || 0,
      status: finalStatus,
      price: Number(body.price) || 0,
      services: processedServices,
      bookingSource: bookingSource,
      bookingCode: bookingCode,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    try {
      const ref = await adminDb().collection("bookings").add(payload);
      
      // Create booking activity log for new booking
      try {
        await adminDb().collection("bookingActivities").add({
          ownerUid: ownerUid,
          bookingId: ref.id,
          bookingCode: bookingCode,
          activityType: "booking_created",
          clientName: String(body.client),
          serviceName: serviceName,
          branchName: branchName,
          staffName: staffName,
          price: Number(body.price) || 0,
          date: String(body.date),
          time: String(body.time),
          previousStatus: null,
          newStatus: normalizeBookingStatus(body.status || "Pending"),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (activityError) {
        console.error("Failed to create booking activity:", activityError);
        // Don't fail the request if activity creation fails
      }
      
      // Create audit log for booking creation
      try {
        // Get user info for audit log
        let performerName = "User";
        let performerRole = "unknown";
        try {
          const userDoc = await adminDb().doc(`users/${currentUserId}`).get();
          const userData = userDoc.data();
          if (userData) {
            performerName = userData.displayName || userData.name || "User";
            performerRole = userData.role || userData.systemRole || "unknown";
          }
        } catch (userError) {
          console.error("Failed to get user data for audit log:", userError);
        }
        
        await logBookingCreatedServer(
          ownerUid,
          ref.id,
          bookingCode,
          String(body.client),
          serviceName || "Service",
          branchName || undefined,
          staffName || undefined,
          {
            uid: currentUserId,
            name: performerName,
            role: performerRole,
          },
          {
            price: Number(body.price) || 0,
            duration: Number(body.duration) || 0,
            date: String(body.date),
            time: String(body.time),
            notes: body.notes || undefined,
            bookingSource: bookingSource,
            clientEmail: body.clientEmail || undefined,
            clientPhone: body.clientPhone || undefined,
          }
        );
      } catch (auditError) {
        console.error("Failed to create audit log for booking creation:", auditError);
        // Don't fail the request if audit log creation fails
      }
      
      // Send notifications to assigned staff members if booking requires approval
      if (finalStatus === "AwaitingStaffApproval") {
        try {
          const staffToNotify: Array<{ uid: string; name: string }> = [];
          
          // Collect staff members to notify from services array
          if (processedServices && Array.isArray(processedServices) && processedServices.length > 0) {
            for (const svc of processedServices) {
              // Only notify staff who have actual assignments (not "Any Available")
              if (svc.staffId && svc.staffId !== "null" && 
                  !String(svc.staffId).toLowerCase().includes("any")) {
                const existing = staffToNotify.find(s => s.uid === svc.staffId);
                if (!existing) {
                  staffToNotify.push({ 
                    uid: svc.staffId, 
                    name: svc.staffName || "Staff" 
                  });
                }
              }
            }
          } else if (body.staffId && body.staffId !== "null" && 
                     !String(body.staffId).toLowerCase().includes("any")) {
            // Single staff assignment
            staffToNotify.push({ 
              uid: body.staffId, 
              name: body.staffName || "Staff" 
            });
          }
          
          // Send notification to each assigned staff member
          for (const staff of staffToNotify) {
            await createStaffAssignmentNotification({
              bookingId: ref.id,
              bookingCode: bookingCode,
              staffUid: staff.uid,
              staffName: staff.name,
              clientName: String(body.client),
              clientPhone: body.clientPhone || undefined,
              serviceName: serviceName || undefined,
              services: processedServices?.map((s: any) => ({
                name: s.name || "Service",
                staffName: s.staffName || undefined,
                staffId: s.staffId || undefined,
              })),
              branchName: branchName || undefined,
              bookingDate: String(body.date),
              bookingTime: String(body.time),
              duration: Number(body.duration) || 0,
              price: Number(body.price) || 0,
              ownerUid: ownerUid,
            });
          }
          
          if (staffToNotify.length > 0) {
            console.log(`✅ Sent staff assignment notifications to ${staffToNotify.length} staff member(s) for booking ${bookingCode}`);
          }
        } catch (notifError) {
          console.error("❌ Failed to send staff assignment notifications:", notifError);
          // Don't fail the request if notification sending fails
        }
      }
      
      // Send notifications to owner and branch admins for "Any Staff" bookings
      const hasAnyStaff = hasAnyStaffBooking(processedServices, body.staffId, body.staffName);
      console.log(`📋 Booking ${bookingCode}: Checking for Any Staff booking - hasAnyStaff: ${hasAnyStaff}, staffId: ${body.staffId}, staffName: ${body.staffName}, processedServices: ${JSON.stringify(processedServices?.map(s => ({ name: s.name, staffId: s.staffId, staffName: s.staffName })))}`);
      
      if (hasAnyStaff) {
        try {
          const serviceList = processedServices && Array.isArray(processedServices) && processedServices.length > 0
            ? processedServices.map(s => s.name || "Service").join(", ")
            : serviceName || "Service";
          
          console.log(`📋 Booking ${bookingCode}: Detected Any Staff booking - notifying owner and branch admins`);
          
          // Notify salon owner
          await createOwnerNotification({
            bookingId: ref.id,
            bookingCode: bookingCode,
            ownerUid: ownerUid,
            clientName: String(body.client),
            serviceName: serviceName || undefined,
            services: processedServices?.map((s: any) => ({
              name: s.name || "Service",
              staffName: s.staffName || undefined,
              staffId: s.staffId || undefined,
            })),
            branchName: branchName || undefined,
            branchId: String(body.branchId),
            bookingDate: String(body.date),
            bookingTime: String(body.time),
            type: "booking_needs_assignment",
            status: finalStatus,
          });
          console.log(`✅ Booking ${bookingCode}: Owner notified for "Any Staff" booking`);
          
          // Notify all branch admins for this branch
          console.log(`📋 Booking ${bookingCode}: Looking up branch admins for branchId: ${body.branchId}, ownerUid: ${ownerUid}`);
          const branchAdminUids = await getBranchAdminUids(db, String(body.branchId), ownerUid);
          console.log(`📋 Booking ${bookingCode}: Found ${branchAdminUids.length} branch admin(s): ${branchAdminUids.join(", ")}`);
          
          for (const branchAdminUid of branchAdminUids) {
            // Skip if branch admin is the owner
            if (branchAdminUid === ownerUid) {
              console.log(`⏭️ Booking ${bookingCode}: Skipping branch admin ${branchAdminUid} (is owner)`);
              continue;
            }
            
            console.log(`📋 Booking ${bookingCode}: Creating notification for branch admin ${branchAdminUid}`);
            
            // Create branch admin notification matching booking engine format
            const branchAdminNotificationPayload = {
              bookingId: ref.id,
              bookingCode: bookingCode,
              type: "booking_needs_assignment",
              title: "New Booking - Staff Assignment Required",
              message: `New booking from ${body.client} for ${serviceList} on ${body.date} at ${body.time}. Please assign staff.`,
              status: finalStatus,
              ownerUid: ownerUid,
              branchAdminUid: branchAdminUid,
              targetAdminUid: branchAdminUid, // Target branch admin
              clientName: String(body.client),
              clientPhone: body.clientPhone || null,
              serviceName: serviceName || null,
              services: processedServices?.map((s: any) => ({
                name: s.name || "Service",
                staffName: s.staffName || "Needs Assignment",
                staffId: s.staffId || null,
              })) || null,
              branchName: branchName || null,
              branchId: String(body.branchId), // Include branchId for branch admin filtering
              bookingDate: String(body.date),
              bookingTime: String(body.time),
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            };
            
            const branchAdminNotifRef = await db.collection("notifications").add(branchAdminNotificationPayload);
            console.log(`✅ Booking ${bookingCode}: Branch admin notification created in Firestore with ID: ${branchAdminNotifRef.id}`);
            
            // Send FCM push notification to branch admin
            console.log(`📱 Booking ${bookingCode}: Looking up FCM token for branch admin ${branchAdminUid}...`);
            const branchAdminFcmToken = await getUserFcmToken(db, branchAdminUid);
            if (branchAdminFcmToken) {
              console.log(`📱 Booking ${bookingCode}: Found FCM token for branch admin ${branchAdminUid}, sending push notification...`);
              await sendPushNotification(branchAdminFcmToken, branchAdminNotificationPayload.title, branchAdminNotificationPayload.message, {
                notificationId: branchAdminNotifRef.id,
                type: "booking_needs_assignment",
                bookingId: ref.id,
                bookingCode: bookingCode || "",
              });
              console.log(`✅ Booking ${bookingCode}: FCM push sent to branch admin ${branchAdminUid} for "Any Staff" booking`);
            } else {
              console.log(`⚠️ Booking ${bookingCode}: No FCM token found for branch admin ${branchAdminUid}, skipping push notification`);
              console.log(`⚠️ Booking ${bookingCode}: Notification was still created in Firestore (ID: ${branchAdminNotifRef.id}) - mobile app will receive it when it syncs`);
            }
            
            console.log(`✅ Booking ${bookingCode}: Branch admin ${branchAdminUid} notified for "Any Staff" booking`);
          }
          
          if (branchAdminUids.length > 0) {
            console.log(`✅ Booking ${bookingCode}: Notified ${branchAdminUids.length} branch admin(s) for "Any Staff" booking`);
          } else {
            console.log(`⚠️ Booking ${bookingCode}: No branch admins found for branch ${body.branchId}`);
          }
        } catch (anyStaffNotifError) {
          console.error("❌ Failed to send owner/branch admin notifications for Any Staff booking:", anyStaffNotifError);
          console.error("❌ Error details:", anyStaffNotifError);
          // Don't fail the request if notification sending fails
        }
      } else {
        console.log(`ℹ️ Booking ${bookingCode}: No Any Staff detected - skipping owner/branch admin notification`);
      }
      
      return NextResponse.json({ id: ref.id });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        // Fall back silently in dev to let client persist
        return NextResponse.json({ id: "DEV_LOCAL", devNoop: true });
      }
      throw e;
    }
  } catch (e: any) {
    console.error("Create booking API error:", e);
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


