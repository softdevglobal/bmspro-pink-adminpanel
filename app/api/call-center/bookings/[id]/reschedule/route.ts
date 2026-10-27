import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { normalizeBookingStatus } from "@/lib/bookingTypes";
import { localToUTC } from "@/lib/timezone";
import { createAuditLogServer } from "@/lib/auditLogServer";
import { createNotification, createStaffAssignmentNotification } from "@/lib/notifications";
import { resolveNotificationActorSnapshot } from "@/lib/callCenterActorFromAuth";
import { getDayOfWeekFromYmd, resolveBranchDaySchedule } from "@/lib/callCenterBranchForBooking";
import {
  HHMM_RE,
  YMD_RE,
  checkServiceSlot,
  eligibleStaffForService,
  findBookingByIdOrCode,
  isAnyStaff,
  loadSlotContext,
  minutesToTime,
  timeToMinutes,
} from "@/lib/callCenterBookings";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

type RescheduleBody = {
  newDate?: string;
  newTime?: string;
  reason?: string;
  newStaffId?: string;
  newStaffName?: string;
  staffAssignments?: Record<string, { staffId?: string; staffName?: string }>;
};

/**
 * PATCH /api/call-center/bookings/[id]/reschedule
 *
 * `id` = Firestore id or `bookingCode`. Body:
 * {
 *   "newDate": "YYYY-MM-DD", "newTime": "HH:mm", "reason": "optional",
 *   "newStaffId": "<uid>", "newStaffName": "<name>",                         // single-service
 *   "staffAssignments": { "<serviceId>": { "staffId": "<uid>", "staffName": "<name>" } }  // multi-service
 * }
 *
 * Services keep their gaps relative to the booking start. Each line is re-checked on the new
 * date (stylist overlap, "Any Staff" capacity, approved leave, branch hours). Completed /
 * canceled bookings, and bookings where a stylist already finished a service, cannot move.
 * Newly assigned stylists and the customer are notified; a `rescheduleHistory` entry is stored.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { id: rawId } = await context.params;
  const segment = decodeURIComponent(rawId || "").trim();
  let body: RescheduleBody;
  try {
    body = (await req.json()) as RescheduleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const newDate = String(body.newDate || "").trim();
  const newTime = String(body.newTime || "").trim();
  if (!segment) return NextResponse.json({ error: "Missing booking id" }, { status: 400, headers: CORS_HEADERS });
  if (!YMD_RE.test(newDate) || !HHMM_RE.test(newTime)) {
    return NextResponse.json(
      { error: "newDate (YYYY-MM-DD) and newTime (HH:mm) are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const db = adminDb();
    let snap;
    try {
      snap = await findBookingByIdOrCode(db, segment);
    } catch (e) {
      if (e instanceof Error && e.message === "DUPLICATE_BOOKING_CODE") {
        return NextResponse.json(
          { error: "Multiple bookings match this booking code" },
          { status: 409, headers: CORS_HEADERS }
        );
      }
      throw e;
    }
    if (!snap || !snap.exists) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404, headers: CORS_HEADERS });
    }
    const bookingId = snap.id;
    const data = snap.data() as DocumentData;
    const ownerUid = String(data.ownerUid || "").trim();
    if (!ownerUid) {
      return NextResponse.json({ error: "Booking is missing owner information" }, { status: 422, headers: CORS_HEADERS });
    }
    if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
      return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
    }

    const status = normalizeBookingStatus(data.status);
    if (status === "Completed" || status === "Canceled") {
      return NextResponse.json(
        { error: `Cannot reschedule a ${status.toLowerCase()} booking` },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const original: DocumentData[] =
      Array.isArray(data.services) && data.services.length > 0
        ? data.services
        : [
            {
              id: String(data.serviceId || ""),
              name: data.serviceName || "Service",
              price: data.price,
              duration: data.duration,
              time: data.time,
              staffId: data.staffId || null,
              staffName: data.staffName || null,
            },
          ];
    if (original.some((s) => s.completionStatus === "completed")) {
      return NextResponse.json(
        { error: "This booking has already been started by staff and can no longer be rescheduled. Cancel it instead." },
        { status: 409, headers: CORS_HEADERS }
      );
    }

    const branchId = String(data.branchId || "");
    const branchDoc = await db.doc(`branches/${branchId}`).get();
    const branch = branchDoc.data() || {};
    const branchTz = String(data.branchTimezone || branch.timezone || "Australia/Sydney");
    const schedule = resolveBranchDaySchedule(branch.hours, getDayOfWeekFromYmd(newDate));
    if (schedule.closed || !schedule.open || !schedule.close) {
      return NextResponse.json(
        { error: `Branch is closed on ${schedule.dayOfWeek}` },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const openMin = timeToMinutes(schedule.open);
    const closeMin = timeToMinutes(schedule.close);

    const assignments = body.staffAssignments && typeof body.staffAssignments === "object" ? body.staffAssignments : {};
    const singleStaffId = String(body.newStaffId || "").trim();
    const oldStart = timeToMinutes(String(data.time || original[0]?.time || newTime));
    const newStart = timeToMinutes(newTime);

    const serviceIds = original.map((s) => String(s.id || "")).filter(Boolean);
    const serviceSnaps = serviceIds.length > 0 ? await db.getAll(...serviceIds.map((id) => db.doc(`services/${id}`))) : [];
    const serviceDocs = new Map(serviceSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));

    const ctx = await loadSlotContext(db, { ownerUid, date: newDate, branchTz, excludeBookingId: bookingId });
    const changedStaff: Array<{ uid: string; name: string; service: string }> = [];
    const updated: DocumentData[] = [];

    for (const s of original) {
      const sid = String(s.id || "");
      const offset = s.time ? timeToMinutes(s.time) - oldStart : 0;
      const start = newStart + offset;
      const duration = Number(s.duration) || 60;
      const lineTime = minutesToTime(start);
      if (start < openMin || start + duration > closeMin) {
        return NextResponse.json(
          { error: `"${s.name || "Service"}" at ${lineTime} is outside branch hours (${schedule.open}–${schedule.close})` },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const override = sid && assignments[sid]?.staffId ? assignments[sid] : null;
      let staffId: string | null = isAnyStaff(s.staffId) ? null : String(s.staffId);
      let staffName: string | null = s.staffName || null;
      if (override) {
        staffId = String(override.staffId);
        staffName = override.staffName || null;
      } else if (singleStaffId && original.length === 1) {
        staffId = singleStaffId;
        staffName = body.newStaffName || null;
      }
      const staffChanged = (staffId || null) !== (isAnyStaff(s.staffId) ? null : String(s.staffId));

      const svcDoc = serviceDocs.get(sid) || null;
      if (staffId) {
        const staff = eligibleStaffForService(ctx, svcDoc, branchId).find(
          (st) => st.id === staffId || String(st.uid || "") === staffId
        );
        if (!staff) {
          return NextResponse.json(
            { error: `${staffName || "Selected staff"} cannot take "${s.name || "Service"}" at this branch on ${newDate}` },
            { status: 409, headers: CORS_HEADERS }
          );
        }
        staffId = staff.id;
        staffName = staffName || staff.name || staff.displayName || "Staff";
      }

      const slot = checkServiceSlot(ctx, { staffId, serviceDoc: svcDoc, branchId, start, duration });
      if (!slot.ok) {
        return NextResponse.json(
          { error: slot.error, details: slot.details, service: s.name || null, time: lineTime },
          { status: 409, headers: CORS_HEADERS }
        );
      }

      if (staffChanged && staffId) changedStaff.push({ uid: staffId, name: String(staffName), service: s.name || "Service" });
      updated.push({
        ...s,
        time: lineTime,
        staffId,
        staffName: staffName || "Any Available",
        ...(staffChanged
          ? { approvalStatus: staffId ? (status === "Confirmed" ? "accepted" : "pending") : "needs_assignment" }
          : {}),
      });
    }

    const firstTime = String(updated[0].time);
    const sameSchedule =
      newDate === data.date && firstTime === data.time && changedStaff.length === 0 &&
      updated.every((u, i) => (u.staffId || null) === (isAnyStaff(original[i].staffId) ? null : String(original[i].staffId)));
    if (sameSchedule) {
      return NextResponse.json(
        { error: "The new date, time and staff are the same as the current booking" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const actor = await resolveNotificationActorSnapshot(gate.auth);
    const reason = String(body.reason || "").trim();
    const previous = {
      date: data.date || null,
      time: data.time || null,
      staffId: data.staffId || null,
      staffName: data.staffName || null,
    };
    const assignedIds = [...new Set(updated.map((u) => u.staffId).filter(Boolean))];

    const update: Record<string, unknown> = {
      date: newDate,
      time: firstTime,
      dateTimeUtc: localToUTC(newDate, firstTime, branchTz),
      updatedAt: FieldValue.serverTimestamp(),
      rescheduledAt: FieldValue.serverTimestamp(),
      rescheduledBy: actor.uid,
      rescheduledByName: actor.displayName,
      rescheduledVia: "call_center",
      rescheduleHistory: FieldValue.arrayUnion({
        from: { date: previous.date, time: previous.time },
        to: { date: newDate, time: firstTime },
        reason: reason || null,
        by: actor.uid,
        byName: actor.displayName,
        at: new Date().toISOString(),
      }),
    };
    if (Array.isArray(data.services) && data.services.length > 0) {
      update.services = updated;
      update.staffId = assignedIds.length === 1 ? assignedIds[0] : null;
      update.staffName =
        assignedIds.length === 1
          ? updated.find((u) => u.staffId === assignedIds[0])?.staffName
          : assignedIds.length > 1
            ? "Multiple Staff"
            : "Any Available";
    } else {
      update.staffId = updated[0].staffId;
      update.staffName = updated[0].staffName;
    }
    await db.doc(`bookings/${bookingId}`).update(update);

    const clientName = String(data.client || data.clientName || "Customer");
    try {
      await db.collection("bookingActivities").add({
        ownerUid,
        bookingId,
        bookingCode: data.bookingCode || null,
        activityType: "booking_rescheduled",
        clientName,
        serviceName: data.serviceName || null,
        branchName: data.branchName || null,
        staffName: update.staffName || null,
        price: data.price || null,
        date: newDate,
        time: firstTime,
        previousStatus: status,
        newStatus: status,
        performedBy: actor.uid,
        performedByName: actor.displayName,
        performedByRole: actor.role,
        source: "call_center",
        createdAt: FieldValue.serverTimestamp(),
        ...(reason ? { rescheduleReason: reason } : {}),
      });
      await createAuditLogServer({
        ownerUid,
        action: `Booking rescheduled: ${previous.date} ${previous.time} → ${newDate} ${firstTime}`,
        actionType: "update",
        entityType: "booking",
        entityId: bookingId,
        entityName: `${data.bookingCode || bookingId} - ${clientName}`,
        performedBy: actor.uid,
        performedByName: actor.displayName,
        performedByRole: actor.role,
        details: reason ? `Reason: ${reason}` : "Rescheduled via call center",
        previousValue: `${previous.date} ${previous.time}`,
        newValue: `${newDate} ${firstTime}`,
        branchId,
        branchName: data.branchName || undefined,
      });
    } catch (e) {
      console.error("[call-center/reschedule] activity/audit failed:", e);
    }

    try {
      const summaries = updated.map((u) => ({ name: u.name || "Service", staffName: u.staffName, staffId: u.staffId || undefined }));
      for (const staff of changedStaff) {
        await createStaffAssignmentNotification({
          bookingId,
          bookingCode: data.bookingCode,
          staffUid: staff.uid,
          staffName: staff.name,
          clientName,
          clientPhone: data.clientPhone,
          serviceName: staff.service,
          services: summaries,
          branchName: data.branchName,
          bookingDate: newDate,
          bookingTime: firstTime,
          duration: data.duration,
          price: data.price,
          ownerUid,
          isReassignment: true,
        });
      }
      const customer: Record<string, unknown> = {
        bookingId,
        type: "booking_status_changed",
        title: "Booking Rescheduled",
        message: `Your booking${data.bookingCode ? ` ${data.bookingCode}` : ""} has been moved to ${newDate} at ${firstTime}.`,
        status,
        ownerUid,
        clientName,
        bookingDate: newDate,
        bookingTime: firstTime,
        services: summaries.map(({ name, staffName }) => ({ name, staffName })),
      };
      if (data.customerUid) customer.customerUid = data.customerUid;
      if (data.clientEmail) customer.customerEmail = data.clientEmail;
      if (data.clientPhone) customer.customerPhone = data.clientPhone;
      if (data.bookingCode) customer.bookingCode = data.bookingCode;
      if (data.branchName) customer.branchName = data.branchName;
      if (data.serviceName) customer.serviceName = data.serviceName;
      await createNotification(customer as Parameters<typeof createNotification>[0]);
    } catch (e) {
      console.error("[call-center/reschedule] notifications failed:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        bookingId,
        bookingCode: data.bookingCode || null,
        date: newDate,
        time: firstTime,
        staffId: update.staffId ?? null,
        staffName: update.staffName ?? null,
        services: updated,
        previous,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/bookings/[id]/reschedule] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
