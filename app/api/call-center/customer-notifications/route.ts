import { NextRequest, NextResponse } from "next/server";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  workshopListScopeForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import {
  CUSTOMER_NOTIFICATION_TYPES,
  serializeCustomerNotification,
} from "@/lib/callCenterCustomerNotifications";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SINCE_DAYS = 14;
const MAX_SINCE_DAYS = 90;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

function createdMs(doc: QueryDocumentSnapshot): number {
  const v = doc.data().createdAt;
  return v && typeof v.toMillis === "function" ? v.toMillis() : 0;
}

/** Customer-type rows, newest first; tolerates a missing composite index. */
async function fetchCustomerRows(base: Query, scanCap: number): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await base
      .where("type", "in", CUSTOMER_NOTIFICATION_TYPES)
      .orderBy("createdAt", "desc")
      .limit(scanCap)
      .get();
    return snap.docs;
  } catch {
    // No composite index: newest-first scan (single-field index), else unordered scan.
    const snap = await base
      .orderBy("createdAt", "desc")
      .limit(scanCap * 4)
      .get()
      .catch(() => base.limit(scanCap * 4).get());
    return snap.docs
      .filter((d) => (CUSTOMER_NOTIFICATION_TYPES as string[]).includes(String(d.data().type || "")))
      .sort((a, b) => createdMs(b) - createdMs(a));
  }
}

/**
 * GET /api/call-center/customer-notifications
 *
 * The customer inbox (what the Pink booking app shows customers): `notifications` rows of type
 * booking_confirmed / booking_completed / booking_canceled / booking_status_changed, plus the
 * call-center tracking flags (`calledCustomer…`, `notificationReviewed…`).
 *
 * Query:
 *   ownerUid / tenantId / X-Tenant-Id   Salon scope (required unless all=1).
 *   all=1 (or scope=all)                System-wide feed — call center agents and super admins only;
 *                                       scoped agents are limited to `assignedWorkshops`.
 *   unreadOnly=1                        Only rows the customer has not read.
 *   limit                               Default 50, max 200.
 *   sinceDays                           Default 14, max 90.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const params = req.nextUrl.searchParams;
  const systemScope = params.get("all") === "1" || params.get("scope") === "all";
  const tenant = getTenantId(req)?.trim() || "";
  const unreadOnly = params.get("unreadOnly") === "1";
  const limitRaw = parseInt(params.get("limit") || "", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sinceRaw = parseInt(params.get("sinceDays") || "", 10);
  const sinceDays = Math.min(Math.max(Number.isFinite(sinceRaw) ? sinceRaw : DEFAULT_SINCE_DAYS, 1), MAX_SINCE_DAYS);
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  let scopedTo: string[] | null = null;
  if (systemScope) {
    const allowed = gate.auth.kind === "agent" || gate.auth.isSuperAdmin;
    if (!allowed) {
      return NextResponse.json(
        { error: "all=1 is only available to call center agents and super admins" },
        { status: 403, headers: CORS_HEADERS }
      );
    }
    const scope = workshopListScopeForAuth(gate.auth);
    scopedTo = scope.mode === "all" ? null : scope.ids;
  } else {
    if (!tenant) {
      return NextResponse.json(
        { error: "Missing ownerUid (query, tenantId or X-Tenant-Id), or pass all=1" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (!canAccessWorkshopForAuth(gate.auth, tenant)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
    }
  }

  try {
    const db = adminDb();
    const scanCap = Math.min(limit * 3, 600);
    const base: Query = systemScope
      ? db.collection("notifications")
      : db.collection("notifications").where("ownerUid", "==", tenant);
    const docs = await fetchCustomerRows(base, scanCap);

    const allowed = scopedTo ? new Set(scopedTo) : null;
    const notifications = docs
      .filter((doc) => {
        const d = doc.data();
        if (createdMs(doc) && createdMs(doc) < sinceMs) return false;
        if (unreadOnly && d.read === true) return false;
        if (allowed && !allowed.has(String(d.ownerUid || ""))) return false;
        return true;
      })
      .slice(0, limit)
      .map((doc) => serializeCustomerNotification(doc.id, doc.data()));

    return NextResponse.json(
      {
        scope: systemScope ? "all" : "workshop",
        ...(systemScope ? { scopedToWorkshops: scopedTo } : { ownerUid: tenant }),
        notifications,
        total: notifications.length,
        unreadCount: notifications.filter((n) => !n.read).length,
        limit,
        sinceDays,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/customer-notifications GET] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer notifications" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
