import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canActOnCustomerNotificationTracking,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { resolveNotificationActorSnapshot } from "@/lib/callCenterActorFromAuth";
import { toIso } from "@/lib/callCenterBookings";
import type { CustomerNotificationType } from "@/lib/notifications";

/**
 * Pink has no `customer_notifications` collection: customer-facing rows live in `notifications`
 * with one of the customer types below (same docs the booking app reads by `customerUid`).
 */
export const CUSTOMER_NOTIFICATION_TYPES: CustomerNotificationType[] = [
  "booking_confirmed",
  "booking_completed",
  "booking_canceled",
  "booking_status_changed",
];

export function isCustomerFacingNotification(d: DocumentData): boolean {
  return (CUSTOMER_NOTIFICATION_TYPES as string[]).includes(String(d.type || ""));
}

export function serializeCustomerNotification(id: string, d: DocumentData) {
  return {
    id,
    type: d.type || "",
    title: d.title || "",
    message: d.message || "",
    status: d.status || null,
    read: d.read === true,
    ownerUid: d.ownerUid || null,
    bookingId: d.bookingId || null,
    bookingCode: d.bookingCode || null,
    customerUid: d.customerUid || null,
    customerEmail: d.customerEmail || null,
    customerPhone: d.customerPhone || null,
    clientName: d.clientName || null,
    serviceName: d.serviceName || null,
    branchName: d.branchName || null,
    staffName: d.staffName || null,
    bookingDate: d.bookingDate || null,
    bookingTime: d.bookingTime || null,
    services: Array.isArray(d.services) ? d.services : [],
    createdAt: toIso(d.createdAt),
    calledCustomer: d.calledCustomer === true,
    calledCustomerAt: toIso(d.calledCustomerAt),
    calledCustomerByUid: d.calledCustomerByUid || null,
    calledCustomerByName: d.calledCustomerByName || null,
    calledCustomerByEmail: d.calledCustomerByEmail || null,
    notificationReviewed: d.notificationReviewed === true,
    notificationReviewedAt: toIso(d.notificationReviewedAt),
    notificationReviewedByUid: d.notificationReviewedByUid || null,
    notificationReviewedByName: d.notificationReviewedByName || null,
    notificationReviewedByEmail: d.notificationReviewedByEmail || null,
  };
}

type TrackingKind = "calledCustomer" | "notificationReviewed";

/**
 * Shared POST handler for
 *   …/customer-notifications/[notificationId]/called-customer       body `{ "calledCustomer"?: boolean }`
 *   …/customer-notifications/[notificationId]/notification-reviewed body `{ "notificationReviewed"?: boolean }`
 * Missing flag = true. `true` stores who did it; `false` clears it.
 * Agents may update any customer notification; BMS staff only their own salon's.
 */
export async function handleCustomerNotificationTracking(
  req: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
  kind: TrackingKind
): Promise<NextResponse> {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { notificationId } = await context.params;
  const id = decodeURIComponent(notificationId || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Missing notification id" }, { status: 400, headers: CORS_HEADERS });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const value = body[kind] === undefined ? true : body[kind] === true;

  try {
    const db = adminDb();
    const ref = db.collection("notifications").doc(id);
    const snap = await ref.get();
    const d = snap.data();
    if (!snap.exists || !d) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404, headers: CORS_HEADERS });
    }
    if (!isCustomerFacingNotification(d)) {
      return NextResponse.json(
        { error: "This notification is not part of the customer inbox" },
        { status: 403, headers: CORS_HEADERS }
      );
    }
    const ownerUid = String(d.ownerUid || "").trim();
    if (!ownerUid) {
      return NextResponse.json(
        { error: "Notification is missing owner information" },
        { status: 422, headers: CORS_HEADERS }
      );
    }
    if (!canActOnCustomerNotificationTracking(gate.auth, ownerUid)) {
      return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
    }

    const update: Record<string, unknown> = value
      ? await (async () => {
          const actor = await resolveNotificationActorSnapshot(gate.auth);
          return {
            [kind]: true,
            [`${kind}At`]: FieldValue.serverTimestamp(),
            [`${kind}ByUid`]: actor.uid,
            [`${kind}ByName`]: actor.displayName,
            [`${kind}ByEmail`]: actor.email,
          };
        })()
      : {
          [kind]: false,
          [`${kind}At`]: FieldValue.delete(),
          [`${kind}ByUid`]: FieldValue.delete(),
          [`${kind}ByName`]: FieldValue.delete(),
          [`${kind}ByEmail`]: FieldValue.delete(),
        };
    await ref.update(update);

    const fresh = (await ref.get()).data() || {};
    return NextResponse.json(
      {
        success: true,
        notificationId: id,
        collection: "notifications",
        documentPath: `notifications/${id}`,
        [kind]: fresh[kind] === true,
        [`${kind}ByUid`]: fresh[`${kind}ByUid`] || null,
        [`${kind}ByName`]: fresh[`${kind}ByName`] || null,
        [`${kind}ByEmail`]: fresh[`${kind}ByEmail`] || null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error(`[call-center/customer-notifications ${kind}] Error:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
