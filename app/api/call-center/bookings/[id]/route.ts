import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { getServiceCompletionProgress } from "@/lib/bookingTypes";
import { findBookingByIdOrCode, serializeCallCenterBooking, toIso } from "@/lib/callCenterBookings";
import {
  actionForStatus,
  handleCallCenterBookingStatusChange,
  type StatusChangeBody,
} from "@/lib/callCenterBookingStatus";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/call-center/bookings/[id]
 *
 * `id` may be the Firestore document id or the human `bookingCode` (e.g. BK-2026-…).
 * Booking card for the agent: booking fields, per-service staff/approval/completion,
 * completion progress and the latest 20 `bookingActivities` rows.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { id: idParam } = await context.params;
  const segment = decodeURIComponent(idParam || "").trim();
  if (!segment) {
    return NextResponse.json({ error: "Missing booking id" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const db = adminDb();
    let bookingDoc;
    try {
      bookingDoc = await findBookingByIdOrCode(db, segment);
    } catch (e) {
      if (e instanceof Error && e.message === "DUPLICATE_BOOKING_CODE") {
        return NextResponse.json(
          { error: "Multiple bookings match this booking code" },
          { status: 409, headers: CORS_HEADERS }
        );
      }
      throw e;
    }
    if (!bookingDoc || !bookingDoc.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404, headers: CORS_HEADERS });
    }

    const d = bookingDoc.data()!;
    const ownerUid = String(d.ownerUid ?? "").trim();
    if (!ownerUid) {
      return NextResponse.json(
        { error: "Booking is missing owner information" },
        { status: 422, headers: CORS_HEADERS }
      );
    }
    if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
    }

    const booking = serializeCallCenterBooking(bookingDoc.id, d);

    let activitiesSnap;
    try {
      activitiesSnap = await db
        .collection("bookingActivities")
        .where("bookingId", "==", bookingDoc.id)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();
    } catch {
      activitiesSnap = await db.collection("bookingActivities").where("bookingId", "==", bookingDoc.id).limit(100).get();
    }
    const activities = activitiesSnap.docs
      .map((doc) => {
        const a = doc.data();
        return {
          id: doc.id,
          activityType: a.activityType || a.type || "",
          previousStatus: a.previousStatus || null,
          newStatus: a.newStatus || null,
          staffName: a.staffName || null,
          performedByName: a.performedByName || "",
          performedByRole: a.performedByRole || "",
          source: a.source || null,
          createdAt: toIso(a.createdAt),
        };
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 20);

    return NextResponse.json(
      {
        booking,
        services: booking.services,
        progress: { services: getServiceCompletionProgress(Array.isArray(d.services) ? d.services : []) },
        activities,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/bookings/[id]] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}

/**
 * PATCH /api/call-center/bookings/[id]
 * PUT   /api/call-center/bookings/[id]   (alias)
 *
 * Body: `{ "status": "Confirmed" | "Canceled" | "Completed", ...action fields }`.
 * Dispatches to the same handler as POST …/confirm | …/cancel | …/complete, so
 * `staffAssignments` / `staffId` (confirm) and `reason` (cancel) are accepted here too.
 */
async function updateStatus(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as StatusChangeBody & { status?: string };
  const action = actionForStatus(String(body.status || ""));
  if (!action) {
    return NextResponse.json(
      { error: "status must be one of: Confirmed, Canceled, Completed" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  return handleCallCenterBookingStatusChange(req, context, action, body);
}

export const PATCH = updateStatus;
export const PUT = updateStatus;
