import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canTransitionStatus, normalizeBookingStatus } from "@/lib/bookingTypes";

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

    const body = (await req.json().catch(() => ({}))) as { status?: string };
    const requestedStatus = normalizeBookingStatus(body?.status || "");

    // Load booking
    const ref = adminDb().doc(`bookings/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data = snap.data() as any;
    if (!data || data.ownerUid !== ownerUid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentStatus = normalizeBookingStatus(data.status);
    if (!canTransitionStatus(currentStatus, requestedStatus)) {
      return NextResponse.json({ error: `Invalid transition ${currentStatus} -> ${requestedStatus}` }, { status: 400 });
    }

    await ref.update({
      status: requestedStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


