import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeBookingStatus } from "@/lib/bookingTypes";

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
      "staffId",
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
        const s = await adminDb().doc(`services/${String(body.serviceId)}`).get();
        serviceName = (s.data() as any)?.name || null;
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

    const payload: any = {
      ownerUid,
      client: String(body.client),
      clientEmail: body.clientEmail || null,
      clientPhone: body.clientPhone || null,
      notes: body.notes || null,
      serviceId: typeof body.serviceId === "number" ? body.serviceId : String(body.serviceId),
      serviceName: serviceName,
      staffId: String(body.staffId),
      staffName: staffName,
      branchId: String(body.branchId),
      branchName: branchName,
      date: String(body.date), // YYYY-MM-DD
      time: String(body.time), // HH:mm
      duration: Number(body.duration) || 0,
      status: normalizeBookingStatus(body.status || "Pending"),
      price: Number(body.price) || 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    try {
      const ref = await adminDb().collection("bookings").add(payload);
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


