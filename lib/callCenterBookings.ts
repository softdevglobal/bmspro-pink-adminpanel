import type { DocumentData, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { normalizeBookingStatus, shouldBlockSlots } from "@/lib/bookingTypes";
import {
  filterApprovedLeaves,
  findStaffLeavePrimaryAndAliases,
  isStaffUnavailableDueToApprovedLeave,
  staffUidAliasListForLeave,
  type LeaveRequestLike,
} from "@/lib/staffLeaveOverlap";
import { getDayOfWeekFromYmd } from "@/lib/callCenterBranchForBooking";

/**
 * Shared helpers for the Pink call-center booking routes (`/api/call-center/bookings/*`).
 *
 * Slot rules mirror POST /api/bookings (admin panel booking path):
 * - a specific stylist is blocked by any overlapping active booking for that stylist,
 *   by overlapping "Any Staff" bookings, and by approved leave;
 * - an "Any Staff" service needs at least one eligible stylist who is still free.
 */

/** Pink roles that can be assigned to a booking service. */
export const PINK_STAFF_ROLES = ["salon_staff", "salon_branch_admin"] as const;

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isAnyStaff(staffId?: string | null): boolean {
  if (!staffId) return true;
  const str = String(staffId).trim().toLowerCase();
  return str === "" || str === "null" || str.includes("any");
}

export function timeToMinutes(timeStr: string): number {
  const parts = String(timeStr || "").split(":").map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return 0;
  return parts[0] * 60 + parts[1];
}

export function minutesToTime(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof v === "string") return v;
  return null;
}

/**
 * Resolve a `bookings` doc by Firestore id or human `bookingCode` (e.g. `BK-2026-…`).
 * Throws `Error("DUPLICATE_BOOKING_CODE")` when the code matches more than one booking.
 */
export async function findBookingByIdOrCode(
  db: Firestore,
  segment: string
): Promise<DocumentSnapshot | null> {
  const direct = await db.doc(`bookings/${segment}`).get();
  if (direct.exists) return direct;
  const byCode = await db.collection("bookings").where("bookingCode", "==", segment).limit(2).get();
  if (byCode.empty) return null;
  if (byCode.size > 1) throw new Error("DUPLICATE_BOOKING_CODE");
  return byCode.docs[0];
}

/** Stylist works at `branchId` on `dayOfWeek` (weekly schedule first, then primary branch). */
export function staffWorksAtBranch(
  staff: DocumentData,
  branchId: string,
  dayOfWeek: string | null
): boolean {
  const ws = staff.weeklySchedule;
  if (ws && typeof ws === "object") {
    if (dayOfWeek) {
      const day = (ws as Record<string, { branchId?: string } | null | undefined>)[dayOfWeek];
      if (day && day.branchId) return day.branchId === branchId;
      if (day === null || day === undefined) return false;
    } else {
      for (const day of Object.values(ws as Record<string, { branchId?: string } | null>)) {
        if (day && day.branchId === branchId) return true;
      }
    }
  }
  return String(staff.branchId || "") === branchId;
}

export type StaffRow = DocumentData & { id: string };

export type SlotContext = {
  date: string;
  dayOfWeek: string;
  branchTz: string;
  staff: StaffRow[];
  approvedLeaves: LeaveRequestLike[];
  occupancies: Array<{ staffId: string | null; start: number; end: number }>;
  /** Active bookings per branch id on this date (for `bookingLimitPerDay`). */
  activeBookingsByBranch: Record<string, number>;
};

/** Load bookings, booking requests, staff and approved leave for one salon + date. */
export async function loadSlotContext(
  db: Firestore,
  input: { ownerUid: string; date: string; branchTz: string; excludeBookingId?: string }
): Promise<SlotContext> {
  const { ownerUid, date, branchTz, excludeBookingId } = input;
  const empty = { docs: [] as Array<{ id: string; data: () => DocumentData }> };
  const [bookingsSnap, requestsSnap, staffSnap, leaveSnap] = await Promise.all([
    db.collection("bookings").where("ownerUid", "==", ownerUid).where("date", "==", date).get().catch(() => empty),
    db.collection("bookingRequests").where("ownerUid", "==", ownerUid).where("date", "==", date).get().catch(() => empty),
    db.collection("users").where("ownerUid", "==", ownerUid).get().catch(() => empty),
    db.collection("leaveRequests").where("ownerUid", "==", ownerUid).get().catch(() => empty),
  ]);

  const occupancies: SlotContext["occupancies"] = [];
  const activeBookingsByBranch: Record<string, number> = {};
  for (const doc of [...bookingsSnap.docs, ...requestsSnap.docs]) {
    if (excludeBookingId && doc.id === excludeBookingId) continue;
    const b = doc.data();
    if (!shouldBlockSlots(b.status)) continue;
    const bid = String(b.branchId || "");
    if (bid) activeBookingsByBranch[bid] = (activeBookingsByBranch[bid] || 0) + 1;
    const services = Array.isArray(b.services) && b.services.length > 0 ? b.services : null;
    if (services) {
      for (const s of services) {
        if (!s?.time) continue;
        const start = timeToMinutes(s.time);
        const staffId = s.staffId || b.staffId || null;
        occupancies.push({
          staffId: isAnyStaff(staffId) ? null : String(staffId),
          start,
          end: start + (Number(s.duration || b.duration) || 60),
        });
      }
    } else if (b.time) {
      const start = timeToMinutes(b.time);
      occupancies.push({
        staffId: isAnyStaff(b.staffId) ? null : String(b.staffId),
        start,
        end: start + (Number(b.duration) || 60),
      });
    }
  }

  return {
    date,
    dayOfWeek: getDayOfWeekFromYmd(date),
    branchTz,
    staff: staffSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    approvedLeaves: filterApprovedLeaves(
      leaveSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRequestLike)
    ),
    occupancies,
    activeBookingsByBranch,
  };
}

/** Copy of `ctx` whose occupancy list can be mutated without affecting the original. */
export function forkSlotContext(ctx: SlotContext): SlotContext {
  return { ...ctx, occupancies: [...ctx.occupancies] };
}

/** Active stylists who may perform `serviceDoc` at `branchId` on the context date. */
export function eligibleStaffForService(
  ctx: SlotContext,
  serviceDoc: DocumentData | null,
  branchId: string
): StaffRow[] {
  const allowList: string[] = Array.isArray(serviceDoc?.staffIds)
    ? (serviceDoc!.staffIds as unknown[]).map(String)
    : [];
  return ctx.staff.filter((st) => {
    const role = String(st.role || "").toLowerCase();
    if (!(PINK_STAFF_ROLES as readonly string[]).includes(role)) return false;
    if (st.status && st.status !== "Active") return false;
    if (allowList.length > 0 && !allowList.includes(st.id) && !allowList.includes(String(st.uid || ""))) {
      return false;
    }
    return staffWorksAtBranch(st, branchId, ctx.dayOfWeek);
  });
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type SlotCheckResult = { ok: true } | { ok: false; error: string; details: string };

/**
 * Check one service line against the day's bookings. On success the line is added to
 * `ctx.occupancies` so later lines of the same booking are checked against it too.
 */
export function checkServiceSlot(
  ctx: SlotContext,
  input: {
    staffId: string | null;
    serviceDoc: DocumentData | null;
    branchId: string;
    start: number;
    duration: number;
  }
): SlotCheckResult {
  const { staffId, serviceDoc, branchId, start, duration } = input;
  const end = start + duration;
  const at = minutesToTime(start);

  if (!isAnyStaff(staffId)) {
    const sid = String(staffId);
    const match = findStaffLeavePrimaryAndAliases(ctx.staff, sid);
    if (
      isStaffUnavailableDueToApprovedLeave(
        ctx.approvedLeaves,
        match.primaryId,
        ctx.date,
        start,
        duration,
        ctx.branchTz,
        match.aliases
      )
    ) {
      return {
        ok: false,
        error: "Staff on leave",
        details: "This staff member has approved leave during the selected date and time.",
      };
    }
    const clash = ctx.occupancies.some(
      (o) => (o.staffId === null || o.staffId === sid) && overlaps(start, end, o.start, o.end)
    );
    if (clash) {
      return {
        ok: false,
        error: "Time slot already booked",
        details: `The selected time ${at} conflicts with an existing booking. Please choose a different time.`,
      };
    }
    ctx.occupancies.push({ staffId: sid, start, end });
    return { ok: true };
  }

  const eligible = eligibleStaffForService(ctx, serviceDoc, branchId).filter(
    (st) =>
      !isStaffUnavailableDueToApprovedLeave(
        ctx.approvedLeaves,
        st.id,
        ctx.date,
        start,
        duration,
        ctx.branchTz,
        staffUidAliasListForLeave(st)
      )
  );
  if (eligible.length === 0) {
    return {
      ok: false,
      error: "No staff available",
      details:
        "No eligible staff for this service, date, and time (includes approved leave). Choose another time or staff.",
    };
  }
  const eligibleIds = new Set(eligible.map((s) => s.id));
  const busy = new Set<string>();
  let anyStaffOverlapping = 0;
  for (const o of ctx.occupancies) {
    if (!overlaps(start, end, o.start, o.end)) continue;
    if (o.staffId === null) anyStaffOverlapping++;
    else if (eligibleIds.has(o.staffId)) busy.add(o.staffId);
  }
  if (eligible.length - busy.size - anyStaffOverlapping <= 0) {
    return {
      ok: false,
      error: "Time slot fully booked",
      details: `All available staff members are booked at ${at}. Please choose a different time.`,
    };
  }
  ctx.occupancies.push({ staffId: null, start, end });
  return { ok: true };
}

/** List-row shape shared by GET /bookings and GET /bookings/by-… responses. */
export function serializeCallCenterBooking(id: string, d: DocumentData) {
  const services = Array.isArray(d.services) ? d.services : [];
  return {
    id,
    bookingCode: d.bookingCode || "",
    ownerUid: d.ownerUid || "",
    status: normalizeBookingStatus(d.status),
    date: d.date || "",
    time: d.time || "",
    duration: Number(d.duration) || 0,
    clientName: d.client || d.clientName || "",
    clientEmail: d.clientEmail || "",
    clientPhone: d.clientPhone || "",
    customerUid: d.customerUid || null,
    branchId: d.branchId || "",
    branchName: d.branchName || "",
    services: services.map((s: DocumentData) => ({
      id: s.id != null ? String(s.id) : "",
      name: s.name || "",
      price: Number(s.price) || 0,
      duration: Number(s.duration) || 0,
      time: s.time || null,
      staffId: s.staffId || null,
      staffName: s.staffName || null,
      approvalStatus: s.approvalStatus || "pending",
      completionStatus: s.completionStatus || "pending",
    })),
    staffId: d.staffId || null,
    staffName: d.staffName || null,
    totalPrice: Number(d.price ?? d.totalPrice) || 0,
    notes: d.notes || "",
    source: d.bookingSource || d.source || "",
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}
