import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus } from "@/lib/bookingTypes";
import { generateBookingCode } from "@/lib/bookings";

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
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration: number;
  status?: string;
  price: number;
  services?: any[];
};

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let ownerUid: string;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      ownerUid = decoded.uid;
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

    // Enrich names if not provided
    let serviceName = body.serviceName || null;
    let staffName = body.staffName || null;
    let branchName = body.branchName || null;

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
      if (!branchName && body.branchId) {
        const b = await adminDb().doc(`branches/${String(body.branchId)}`).get();
        branchName = (b.data() as any)?.name || null;
      }
    } catch {}

    // Determine booking source based on user role
    let bookingSource = "AdminBooking";
    try {
      const userDoc = await adminDb().doc(`users/${ownerUid}`).get();
      const userData = userDoc.data();
      if (userData) {
        const userRole = userData.role || userData.systemRole;
        const userBranchName = userData.branchName || branchName;
        
        if (userRole === "salon_branch_admin") {
          bookingSource = `Branch Admin Booking - ${userBranchName || "Unknown Branch"}`;
        } else if (userRole === "salon_owner") {
          bookingSource = "Owner Booking";
        } else if (userRole === "salon_staff") {
          bookingSource = `Staff Booking - ${userBranchName || "Unknown Branch"}`;
        }
      }
    } catch (roleError) {
      console.error("Failed to get user role for booking source:", roleError);
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
      date: String(body.date), // YYYY-MM-DD
      time: String(body.time), // HH:mm
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


