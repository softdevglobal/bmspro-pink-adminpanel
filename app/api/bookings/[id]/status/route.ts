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

    // If confirming a booking request, move it to bookings collection
    if (isBookingRequest && requestedStatus === "Confirmed") {
      // Create in bookings collection
      const bookingData = {
        ...data,
        status: requestedStatus,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: data.createdAt || FieldValue.serverTimestamp(),
      };
      await db.collection("bookings").add(bookingData);
      
      // Delete from bookingRequests
      await ref.delete();
    } else {
      // Just update the status
      await ref.update({
        status: requestedStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = process.env.NODE_ENV === "production" ? "Internal error" : e?.message || "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


