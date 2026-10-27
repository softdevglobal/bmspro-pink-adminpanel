import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentData, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  workshopListScopeForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { normalizeBookingStatus } from "@/lib/bookingTypes";
import { generateBookingCode } from "@/lib/bookings";
import { localToUTC } from "@/lib/timezone";
import { logBookingCreatedServer } from "@/lib/auditLogServer";
import {
  createBranchAdminNotification,
  createOwnerNotification,
  createStaffAssignmentNotification,
} from "@/lib/notifications";
import { sendBookingEmail } from "@/lib/emailService";
import { resolveNotificationActorSnapshot } from "@/lib/callCenterActorFromAuth";
import { resolveBranchDaySchedule, getDayOfWeekFromYmd } from "@/lib/callCenterBranchForBooking";
import {
  HHMM_RE,
  YMD_RE,
  checkServiceSlot,
  eligibleStaffForService,
  isAnyStaff,
  loadSlotContext,
  minutesToTime,
  serializeCallCenterBooking,
  timeToMinutes,
} from "@/lib/callCenterBookings";

export const runtime = "nodejs";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

function createdAtMs(d: DocumentData): number {
  const v = d.createdAt;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "string") return Date.parse(v) || 0;
  return 0;
}

/** Newest first; falls back to an in-memory sort when the composite index is missing. */
async function fetchNewest(base: Query, limit: number): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await base.orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs;
  } catch {
    const snap = await base.limit(Math.min(limit * 5, 5000)).get();
    return [...snap.docs].sort((a, b) => createdAtMs(b.data()) - createdAtMs(a.data())).slice(0, limit);
  }
}

/**
 * GET /api/call-center/bookings
 *
 * Query: `ownerUid` / `X-Tenant-Id`, `status`, `date=YYYY-MM-DD`, `branchId`, `customerUid`,
 * `limit` (default 100, max 1000) or `all=1`.
 *
 * Scope: with a tenant → that salon (access checked). Without a tenant → every salon the caller
 * may see (CC admin / unscoped agent / super admin: all; scoped agent: `assignedWorkshops`).
 * Salon owners and branch admins must pass a tenant.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const params = req.nextUrl.searchParams;
  const tenant = getTenantId(req)?.trim() || "";
  const statusFilter = params.get("status")?.trim() || "";
  const date = params.get("date")?.trim() || "";
  const branchId = params.get("branchId")?.trim() || "";
  const customerUid = params.get("customerUid")?.trim() || "";
  const all = params.get("all") === "1" || params.get("all") === "true" || params.get("limit") === "all";
  const limitRaw = parseInt(params.get("limit") || "", 10);
  const limit = all
    ? MAX_LIST_LIMIT
    : Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

  if (date && !YMD_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: CORS_HEADERS });
  }

  let ownerUids: string[] | null;
  if (tenant) {
    if (!canAccessWorkshopForAuth(gate.auth, tenant)) {
      return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
    }
    ownerUids = [tenant];
  } else if (gate.auth.kind === "tenant_admin" && !gate.auth.isSuperAdmin) {
    return NextResponse.json(
      { error: "Missing ownerUid (query or X-Tenant-Id)" },
      { status: 400, headers: CORS_HEADERS }
    );
  } else {
    const scope = workshopListScopeForAuth(gate.auth);
    ownerUids = scope.mode === "all" ? null : scope.ids;
  }

  try {
    const db = adminDb();
    let docs: QueryDocumentSnapshot[] = [];
    const withDate = (q: Query) => (date ? q.where("date", "==", date) : q);

    if (ownerUids === null) {
      docs = await fetchNewest(withDate(db.collection("bookings")), limit);
    } else {
      for (let i = 0; i < ownerUids.length; i += 30) {
        const chunk = ownerUids.slice(i, i + 30);
        const base =
          chunk.length === 1
            ? db.collection("bookings").where("ownerUid", "==", chunk[0])
            : db.collection("bookings").where("ownerUid", "in", chunk);
        docs.push(...(await fetchNewest(withDate(base), limit)));
      }
      docs.sort((a, b) => createdAtMs(b.data()) - createdAtMs(a.data()));
    }

    const wantStatus = statusFilter ? normalizeBookingStatus(statusFilter) : null;
    const bookings = docs
      .filter((doc) => {
        const d = doc.data();
        if (wantStatus && normalizeBookingStatus(d.status) !== wantStatus) return false;
        if (branchId && String(d.branchId || "") !== branchId) return false;
        if (customerUid && String(d.customerUid || "") !== customerUid) return false;
        return true;
      })
      .slice(0, limit)
      .map((doc) => serializeCallCenterBooking(doc.id, doc.data()));

    return NextResponse.json({ bookings, total: bookings.length }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[call-center/bookings GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}

type CreateServiceLine = {
  serviceId?: string;
  id?: string;
  staffId?: string | null;
  staffName?: string | null;
  price?: number;
  duration?: number;
  time?: string;
};

type CreateBody = {
  ownerUid?: string;
  branchId?: string;
  date?: string;
  time?: string;
  client?: string;
  clientEmail?: string;
  clientPhone?: string;
  customerUid?: string;
  notes?: string;
  services?: CreateServiceLine[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status: 400, headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/bookings
 *
 * Agent books on behalf of a customer. Writes a normal Pink `bookings` doc (visible in the
 * admin panel and staff app) with `bookingSource: "Call Center"`.
 *
 * Body:
 * {
 *   "ownerUid": "<salon owner uid>",      // or X-Tenant-Id header
 *   "branchId": "<branch id>",
 *   "date": "YYYY-MM-DD", "time": "HH:mm",
 *   "client": "Name", "clientPhone": "+61…", "clientEmail": "optional",
 *   "customerUid": "optional", "notes": "optional",
 *   "services": [ { "serviceId": "<id>", "staffId": "optional", "time": "optional HH:mm",
 *                   "price": optional, "duration": optional } ]
 * }
 *
 * Services without `time` run back-to-back from `time`. Each line is checked against the
 * day's bookings and approved leave (409 on clash). No staff on any line → `Pending`
 * (owner/branch admins notified to assign); otherwise `AwaitingStaffApproval` (staff notified).
 */
export async function POST(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const ownerUid = String(body.ownerUid || getTenantId(req) || "").trim();
  if (!ownerUid) return badRequest("Missing ownerUid (body or X-Tenant-Id)");
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
  }

  const branchId = String(body.branchId || "").trim();
  const date = String(body.date || "").trim();
  const time = String(body.time || "").trim();
  const client = String(body.client || "").trim();
  const clientPhone = String(body.clientPhone || "").trim();
  const clientEmail = String(body.clientEmail || "").trim();
  const lines = Array.isArray(body.services) ? body.services : [];

  if (!branchId) return badRequest("branchId is required");
  if (!YMD_RE.test(date)) return badRequest("date is required (YYYY-MM-DD)");
  if (!HHMM_RE.test(time)) return badRequest("time is required (HH:mm)");
  if (!client) return badRequest("client is required");
  if (clientPhone.replace(/\D/g, "").length < 6) {
    return badRequest("clientPhone is required (at least 6 digits)", { field: "clientPhone" });
  }
  if (clientEmail && !EMAIL_RE.test(clientEmail)) {
    return badRequest("clientEmail is not a valid email address", { field: "clientEmail" });
  }
  if (lines.length === 0) return badRequest("At least one service is required");

  try {
    const db = adminDb();
    const branchDoc = await db.doc(`branches/${branchId}`).get();
    const branch = branchDoc.data();
    if (!branchDoc.exists || !branch || String(branch.ownerUid || "") !== ownerUid) {
      return NextResponse.json({ error: "Branch not found for this salon" }, { status: 404, headers: CORS_HEADERS });
    }
    const branchName = String(branch.name || "");
    const branchTz = String(branch.timezone || "Australia/Sydney");

    const schedule = resolveBranchDaySchedule(branch.hours, getDayOfWeekFromYmd(date));
    if (schedule.closed || !schedule.open || !schedule.close) {
      return badRequest(`Branch is closed on ${schedule.dayOfWeek}`);
    }

    const serviceIds = lines.map((l) => String(l.serviceId || l.id || "").trim());
    if (serviceIds.some((id) => !id)) return badRequest("Every service line needs a serviceId");
    const serviceSnaps = await db.getAll(...serviceIds.map((id) => db.doc(`services/${id}`)));

    const ctx = await loadSlotContext(db, { ownerUid, date, branchTz });
    const openMin = timeToMinutes(schedule.open);
    const closeMin = timeToMinutes(schedule.close);

    let cursor = timeToMinutes(time);
    const services: Record<string, unknown>[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const snap = serviceSnaps[i];
      const svc = snap.data();
      if (!snap.exists || !svc || String(svc.ownerUid || "") !== ownerUid) {
        return badRequest(`Unknown service: ${serviceIds[i]}`);
      }
      const offeredAt: string[] = Array.isArray(svc.branches) ? svc.branches.map(String) : [];
      if (offeredAt.length > 0 && !offeredAt.includes(branchId)) {
        return badRequest(`Service "${svc.name || serviceIds[i]}" is not offered at ${branchName || "this branch"}`);
      }

      const lineTime = line.time && HHMM_RE.test(line.time) ? line.time : minutesToTime(cursor);
      const start = timeToMinutes(lineTime);
      const duration = Number(line.duration ?? svc.duration) || 60;
      const price = Number(line.price ?? svc.price) || 0;
      if (start < openMin || start + duration > closeMin) {
        return badRequest(
          `Service "${svc.name || serviceIds[i]}" at ${lineTime} is outside branch hours (${schedule.open}–${schedule.close})`
        );
      }

      let staffId: string | null = isAnyStaff(line.staffId) ? null : String(line.staffId);
      let staffName = "Any Available";
      if (staffId) {
        const staff = eligibleStaffForService(ctx, svc, branchId).find(
          (st) => st.id === staffId || String(st.uid || "") === staffId
        );
        if (!staff) {
          return badRequest(
            `Staff ${staffId} cannot take "${svc.name || serviceIds[i]}" at ${branchName || "this branch"} on ${date}`
          );
        }
        staffId = staff.id;
        staffName = String(line.staffName || staff.name || staff.displayName || "Staff");
      }

      const slot = checkServiceSlot(ctx, { staffId, serviceDoc: svc, branchId, start, duration });
      if (!slot.ok) {
        return NextResponse.json(
          { error: slot.error, details: slot.details, service: svc.name || serviceIds[i], time: lineTime },
          { status: 409, headers: CORS_HEADERS }
        );
      }

      services.push({
        id: snap.id,
        name: String(svc.name || "Service"),
        price,
        duration,
        time: lineTime,
        staffId,
        staffName,
        approvalStatus: staffId ? "pending" : "needs_assignment",
        completionStatus: "pending",
      });
      cursor = start + duration;
    }

    const assignedIds = [...new Set(services.map((s) => s.staffId).filter(Boolean) as string[])];
    const status = assignedIds.length > 0 ? "AwaitingStaffApproval" : "Pending";
    const totalPrice = services.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
    const totalDuration = services.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    const serviceName = services.map((s) => s.name).join(", ");
    const bookingTime = String(services[0].time);
    const actor = await resolveNotificationActorSnapshot(gate.auth);
    const bookingCode = generateBookingCode();

    let dateTimeUtc: string | null = null;
    try {
      dateTimeUtc = localToUTC(date, bookingTime, branchTz);
    } catch {
      dateTimeUtc = null;
    }

    const payload = {
      ownerUid,
      client,
      clientEmail: clientEmail || null,
      clientPhone,
      customerUid: String(body.customerUid || "").trim() || null,
      notes: String(body.notes || "").trim() || null,
      serviceId: services.map((s) => s.id).join(","),
      serviceName,
      staffId: assignedIds.length === 1 ? assignedIds[0] : null,
      staffName:
        assignedIds.length === 1
          ? String(services.find((s) => s.staffId === assignedIds[0])?.staffName || "Staff")
          : assignedIds.length > 1
            ? "Multiple Staff"
            : "Any Available",
      branchId,
      branchName,
      branchTimezone: branchTz,
      date,
      time: bookingTime,
      dateTimeUtc,
      duration: totalDuration,
      price: totalPrice,
      status,
      services,
      bookingSource: "Call Center",
      source: "call_center",
      bookingCode,
      createdBy: actor.uid,
      createdByName: actor.displayName,
      createdByRole: actor.role,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await db.collection("bookings").add(payload);
    const bookingId = ref.id;
    const summaries = services.map((s) => ({
      name: String(s.name),
      staffName: String(s.staffName),
      staffId: (s.staffId as string | null) || undefined,
    }));

    try {
      await db.collection("bookingActivities").add({
        ownerUid,
        bookingId,
        bookingCode,
        activityType: "booking_created",
        clientName: client,
        serviceName,
        branchName,
        staffName: payload.staffName,
        price: totalPrice,
        date,
        time: bookingTime,
        previousStatus: null,
        newStatus: status,
        performedBy: actor.uid,
        performedByName: actor.displayName,
        performedByRole: actor.role,
        source: "call_center",
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error("[call-center/bookings POST] bookingActivities write failed:", e);
    }

    try {
      await logBookingCreatedServer(
        ownerUid,
        bookingId,
        bookingCode,
        client,
        serviceName,
        branchName || undefined,
        payload.staffName,
        { uid: actor.uid, name: actor.displayName, role: actor.role },
        {
          price: totalPrice,
          duration: totalDuration,
          date,
          time: bookingTime,
          notes: payload.notes || undefined,
          bookingSource: "Call Center",
          clientEmail: clientEmail || undefined,
          clientPhone,
        }
      );
    } catch (e) {
      console.error("[call-center/bookings POST] audit log failed:", e);
    }

    if (clientEmail) {
      try {
        await sendBookingEmail({
          bookingId,
          bookingCode,
          customerEmail: clientEmail,
          customerName: client,
          customerPhone: clientPhone,
          status: "Pending",
          ownerUid,
          branchName,
          bookingDate: date,
          bookingTime,
          duration: totalDuration,
          price: totalPrice,
          serviceName,
          services: services.map((s) => ({
            name: String(s.name),
            staffName: String(s.staffName),
            time: String(s.time),
            duration: Number(s.duration),
          })),
          staffName: payload.staffName,
        });
      } catch (e) {
        console.error("[call-center/bookings POST] booking email failed:", e);
      }
    }

    try {
      for (const staffUid of assignedIds) {
        await createStaffAssignmentNotification({
          bookingId,
          bookingCode,
          staffUid,
          staffName: String(services.find((s) => s.staffId === staffUid)?.staffName || "Staff"),
          clientName: client,
          clientPhone,
          serviceName,
          services: summaries,
          branchName,
          bookingDate: date,
          bookingTime,
          duration: totalDuration,
          price: totalPrice,
          ownerUid,
        });
      }

      if (services.some((s) => !s.staffId)) {
        await createOwnerNotification({
          bookingId,
          bookingCode,
          ownerUid,
          clientName: client,
          serviceName,
          services: summaries,
          branchName,
          branchId,
          bookingDate: date,
          bookingTime,
          creatorUid: actor.uid,
          creatorName: actor.displayName,
          creatorRole: actor.role,
          type: "booking_needs_assignment",
          status,
        });
        const admins = await db
          .collection("users")
          .where("ownerUid", "==", ownerUid)
          .where("role", "==", "salon_branch_admin")
          .where("branchId", "==", branchId)
          .get()
          .catch(() => null);
        for (const admin of admins?.docs ?? []) {
          if (admin.id === ownerUid) continue;
          await createBranchAdminNotification({
            bookingId,
            bookingCode,
            branchAdminUid: admin.id,
            ownerUid,
            clientName: client,
            serviceName,
            services: summaries,
            branchName,
            branchId,
            bookingDate: date,
            bookingTime,
            status,
            type: "booking_needs_assignment",
          });
        }
      }
    } catch (e) {
      console.error("[call-center/bookings POST] notifications failed:", e);
    }

    return NextResponse.json(
      {
        success: true,
        bookingId,
        bookingCode,
        status,
        totalPrice,
        totalDuration,
        services,
      },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/bookings POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
