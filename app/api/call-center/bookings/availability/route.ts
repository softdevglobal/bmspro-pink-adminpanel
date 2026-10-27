import { NextRequest, NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import {
  getDayOfWeekFromYmd,
  resolveBranchDaySchedule,
  serializeCallCenterBranchForBooking,
} from "@/lib/callCenterBranchForBooking";
import { getCurrentDateTimeInTimezone } from "@/lib/timezone";
import {
  YMD_RE,
  checkServiceSlot,
  eligibleStaffForService,
  forkSlotContext,
  isAnyStaff,
  loadSlotContext,
  minutesToTime,
  timeToMinutes,
} from "@/lib/callCenterBookings";

export const runtime = "nodejs";

const DEFAULT_DURATION = 60;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/call-center/bookings/availability?branchId=&date=YYYY-MM-DD&serviceIds=a,b&staffId=&interval=30
 *
 * Tenant: `X-Tenant-Id` or `?ownerUid=`.
 *
 * Start times (every `interval` minutes, default 30, between branch open and close) at which the
 * requested services fit back-to-back. Each service is checked like a real booking: stylist
 * overlap, "Any Staff" capacity, approved leave and branch hours. With no `serviceIds`, a single
 * 60-minute "any staff" appointment is assumed. Past times are blocked when `date` is today in
 * the branch timezone. `bookingLimitPerDay` (when set on the branch) blocks the whole day.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const params = req.nextUrl.searchParams;
  const ownerUid = getTenantId(req)?.trim() || "";
  const branchId = params.get("branchId")?.trim() || "";
  const date = params.get("date")?.trim() || "";
  const staffId = params.get("staffId")?.trim() || "";
  const serviceIds = (params.get("serviceIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const intervalRaw = parseInt(params.get("interval") || "30", 10);
  const interval = [10, 15, 20, 30, 60].includes(intervalRaw) ? intervalRaw : 30;

  if (!ownerUid || !branchId || !YMD_RE.test(date)) {
    return NextResponse.json(
      { error: "Missing required params: ownerUid (or X-Tenant-Id), branchId, date (YYYY-MM-DD)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
  }

  try {
    const db = adminDb();
    const branchDoc = await db.doc(`branches/${branchId}`).get();
    const branchData = branchDoc.data();
    if (!branchDoc.exists || !branchData || String(branchData.ownerUid || "") !== ownerUid) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404, headers: CORS_HEADERS });
    }

    const dayOfWeek = getDayOfWeekFromYmd(date);
    const branch = serializeCallCenterBranchForBooking(branchId, branchData, date);
    const schedule = resolveBranchDaySchedule(branchData.hours, dayOfWeek);
    const base = {
      dayOfWeek,
      branch,
      branchHours: schedule.closed ? null : { open: schedule.open, close: schedule.close },
      interval,
    };
    if (schedule.closed || !schedule.open || !schedule.close) {
      return NextResponse.json(
        { ...base, available: false, reason: "Branch is closed on this day", allSlots: [], availableSlots: [], blockedSlots: [] },
        { headers: CORS_HEADERS }
      );
    }

    const services: Array<{ id: string; name: string; duration: number; doc: DocumentData | null }> = [];
    if (serviceIds.length > 0) {
      const snaps = await db.getAll(...serviceIds.map((id) => db.doc(`services/${id}`)));
      for (const snap of snaps) {
        const d = snap.data();
        if (!snap.exists || !d || String(d.ownerUid || "") !== ownerUid) {
          return NextResponse.json({ error: `Unknown service: ${snap.id}` }, { status: 400, headers: CORS_HEADERS });
        }
        services.push({ id: snap.id, name: String(d.name || ""), duration: Number(d.duration) || DEFAULT_DURATION, doc: d });
      }
    } else {
      services.push({ id: "", name: "Appointment", duration: DEFAULT_DURATION, doc: null });
    }
    const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);

    const branchTz = String(branchData.timezone || "Australia/Sydney");
    const ctx = await loadSlotContext(db, { ownerUid, date, branchTz });

    const limit = typeof branchData.bookingLimitPerDay === "number" ? branchData.bookingLimitPerDay : null;
    const currentBookings = ctx.activeBookingsByBranch[branchId] || 0;
    const dailyLimitReached = limit != null && limit > 0 && currentBookings >= limit;

    const specificStaff = isAnyStaff(staffId) ? null : staffId;
    const staffUnavailable =
      specificStaff != null &&
      services.some(
        (svc) =>
          !eligibleStaffForService(ctx, svc.doc, branchId).some(
            (st) => st.id === specificStaff || String(st.uid || "") === specificStaff
          )
      );

    const now = getCurrentDateTimeInTimezone(branchTz);
    const nowMin = now.date === date ? timeToMinutes(now.time) : -1;
    const openMin = timeToMinutes(schedule.open);
    const closeMin = timeToMinutes(schedule.close);

    const allSlots: string[] = [];
    const availableSlots: string[] = [];
    const blockedSlots: Array<{ time: string; reason: string }> = [];

    for (let start = openMin; start + totalDuration <= closeMin; start += interval) {
      const label = minutesToTime(start);
      allSlots.push(label);
      if (dailyLimitReached) {
        blockedSlots.push({ time: label, reason: "Daily booking limit reached" });
        continue;
      }
      if (staffUnavailable) {
        blockedSlots.push({ time: label, reason: "Staff does not work these services at this branch on this day" });
        continue;
      }
      if (start <= nowMin) {
        blockedSlots.push({ time: label, reason: "Time has passed" });
        continue;
      }
      const trial = forkSlotContext(ctx);
      let cursor = start;
      let reason: string | null = null;
      for (const svc of services) {
        const result = checkServiceSlot(trial, {
          staffId: specificStaff,
          serviceDoc: svc.doc,
          branchId,
          start: cursor,
          duration: svc.duration,
        });
        if (!result.ok) {
          reason = result.error;
          break;
        }
        cursor += svc.duration;
      }
      if (reason) blockedSlots.push({ time: label, reason });
      else availableSlots.push(label);
    }

    return NextResponse.json(
      {
        ...base,
        available: availableSlots.length > 0,
        ...(availableSlots.length === 0
          ? { reason: dailyLimitReached ? "Daily booking limit reached" : "No free times for the requested services" }
          : {}),
        services: services.filter((s) => s.id).map(({ id, name, duration }) => ({ id, name, duration })),
        totalDuration,
        staffId: staffId || null,
        allSlots,
        availableSlots,
        blockedSlots,
        dailyLimitReached,
        dailyLimit: limit,
        currentBookings,
        remainingBookings: limit != null && limit > 0 ? Math.max(limit - currentBookings, 0) : null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/bookings/availability] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
