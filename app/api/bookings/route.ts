import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus, shouldBlockSlots } from "@/lib/bookingTypes";
import { generateBookingCode } from "@/lib/bookings";
import { checkRateLimit, getClientIdentifier, RateLimiters } from "@/lib/rateLimiter";

export const runtime = "nodejs";

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
    // Security: Rate limiting to prevent booking spam
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, RateLimiters.booking);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many booking requests. Please try again later.",
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(rateLimitResult.resetTime),
          },
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
      status: normalizeBookingStatus(body.status || "Pending"),
      price: Number(body.price) || 0,
      services: body.services || null,
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


