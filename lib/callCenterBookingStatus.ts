import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import {
  canTransitionStatus,
  normalizeBookingStatus,
  type BookingStatus,
} from "@/lib/bookingTypes";
import { logBookingStatusChangedServer } from "@/lib/auditLogServer";
import {
  createCustomerCancellationNotification,
  createCustomerConfirmationNotification,
  createNotification,
  createStaffAssignmentNotification,
  getNotificationContent,
} from "@/lib/notifications";
import { sendBookingStatusChangeEmail } from "@/lib/emailService";
import { findBookingByIdOrCode, isAnyStaff } from "@/lib/callCenterBookings";

/** Action verbs exposed to the call-center API. */
export type CallCenterBookingAction = "confirm" | "cancel" | "complete";

const ACTION_TO_STATUS: Record<CallCenterBookingAction, BookingStatus> = {
  confirm: "Confirmed",
  cancel: "Canceled",
  complete: "Completed",
};

/** Statuses a call-center confirm may start from (same as BMS Black). */
const CONFIRMABLE_FROM: BookingStatus[] = ["Pending", "AwaitingStaffApproval", "PartiallyApproved", "StaffRejected"];

/** Map a requested workflow status (PATCH body) to the call-center action. */
export function actionForStatus(status: string): CallCenterBookingAction | null {
  if (!status) return null;
  const s = normalizeBookingStatus(status);
  if (s === "Confirmed") return "confirm";
  if (s === "Canceled") return "cancel";
  if (s === "Completed") return "complete";
  return null;
}

function activityTypeForStatus(status: BookingStatus): string {
  switch (status) {
    case "Confirmed":
      return "booking_confirmed";
    case "Canceled":
      return "booking_cancelled";
    case "Completed":
      return "booking_completed";
    default:
      return "booking_updated";
  }
}

export type StatusChangeBody = {
  reason?: string;
  staffId?: string;
  staffName?: string;
  staffAssignments?: Record<string, { staffId?: string; staffName?: string }>;
  skipStaffValidation?: boolean;
};

/**
 * Shared implementation for `POST /api/call-center/bookings/[id]/{confirm,cancel,complete}`
 * and `PATCH /api/call-center/bookings/[id]` (`{ "status": … }`).
 *
 * Same contract as BMS Black, adapted to Pink: no task checklist or additional-issue
 * guards (salon bookings have neither).
 */
export async function handleCallCenterBookingStatusChange(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  action: CallCenterBookingAction,
  parsedBody?: StatusChangeBody
): Promise<NextResponse> {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { id: rawId } = await context.params;
  const segment = decodeURIComponent(rawId || "").trim();
  if (!segment) {
    return NextResponse.json({ error: "Missing booking id" }, { status: 400, headers: CORS_HEADERS });
  }

  const body: StatusChangeBody = parsedBody ?? ((await req.json().catch(() => ({}))) as StatusChangeBody);
  const db = adminDb();

  let bookingSnap;
  try {
    bookingSnap = await findBookingByIdOrCode(db, segment);
  } catch (e) {
    if (e instanceof Error && e.message === "DUPLICATE_BOOKING_CODE") {
      return NextResponse.json(
        { error: "Multiple bookings match this booking code" },
        { status: 409, headers: CORS_HEADERS }
      );
    }
    throw e;
  }
  if (!bookingSnap || !bookingSnap.exists) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const bookingId = bookingSnap.id;
  const data = bookingSnap.data() as DocumentData;
  const ownerUid = String(data.ownerUid ?? "").trim();
  if (!ownerUid) {
    return NextResponse.json(
      { error: "Booking is missing owner information" },
      { status: 422, headers: CORS_HEADERS }
    );
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied for this workshop" }, { status: 403, headers: CORS_HEADERS });
  }

  const currentStatus = normalizeBookingStatus(data.status ?? "Pending");
  const nextStatus = ACTION_TO_STATUS[action];
  if (currentStatus === nextStatus) {
    return NextResponse.json(
      { error: `Booking is already ${nextStatus}`, currentStatus },
      { status: 409, headers: CORS_HEADERS }
    );
  }
  // Confirm acts with owner/admin authority (stylists are assigned and accepted in one step),
  // so it may skip the staff-approval leg that `canTransitionStatus` enforces for the app flow.
  const confirmable = action === "confirm" && CONFIRMABLE_FROM.includes(currentStatus);
  if (!confirmable && !canTransitionStatus(currentStatus, nextStatus)) {
    return NextResponse.json(
      {
        error: `Cannot ${action} a booking that is currently ${currentStatus}`,
        currentStatus,
        targetStatus: nextStatus,
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const performer =
    gate.auth.kind === "agent"
      ? { uid: gate.auth.user.uid, name: gate.auth.user.name || "Call Center Agent", role: gate.auth.user.role || "agent" }
      : { uid: gate.auth.uid, name: gate.auth.name || "BMS Staff", role: gate.auth.role };

  const updateData: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  };
  let staffIdsToNotify: string[] = [];

  if (action === "confirm") {
    const services = Array.isArray(data.services) ? (data.services as DocumentData[]) : [];
    const assignments = body.staffAssignments && typeof body.staffAssignments === "object" ? body.staffAssignments : {};
    const topStaffId = String(body.staffId || "").trim();
    const topStaffName = String(body.staffName || "").trim();
    const missingStaffForServices: string[] = [];
    const notify = new Set<string>();

    const merged = services.map((s) => {
      const id = String(s.id ?? s.serviceId ?? "");
      const override = id && assignments[id] ? assignments[id] : null;
      let staffId = String(s.staffId ?? "").trim();
      let staffName = String(s.staffName ?? "").trim();
      if (override?.staffId) {
        staffId = String(override.staffId).trim();
        if (override.staffName) staffName = String(override.staffName).trim();
      } else if (isAnyStaff(staffId) && services.length === 1 && topStaffId) {
        staffId = topStaffId;
        if (topStaffName) staffName = topStaffName;
      }
      if (isAnyStaff(staffId)) {
        if (!body.skipStaffValidation) missingStaffForServices.push(String(s.name ?? `service ${id || "#?"}`));
      } else {
        notify.add(staffId);
      }
      return {
        ...s,
        ...(staffId ? { staffId } : {}),
        ...(staffName ? { staffName } : {}),
        approvalStatus: "accepted",
      };
    });

    if (services.length === 0 && !body.skipStaffValidation && isAnyStaff(topStaffId || data.staffId)) {
      missingStaffForServices.push(String(data.serviceName ?? "service"));
    }
    if (missingStaffForServices.length > 0) {
      return NextResponse.json(
        {
          error:
            "Staff must be assigned to every service before confirming. Pass `staffAssignments` in the body, or set `skipStaffValidation: true` to override.",
          missingStaffForServices,
          hint: 'Body shape: { "staffAssignments": { "<serviceId>": { "staffId": "X", "staffName": "Y" } } } — or for a single-service booking { "staffId": "X", "staffName": "Y" }.',
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (services.length > 0) updateData.services = merged;
    if (services.length === 0 && topStaffId) {
      updateData.staffId = topStaffId;
      if (topStaffName) updateData.staffName = topStaffName;
      notify.add(topStaffId);
    } else if (services.length === 1 && merged[0].staffId) {
      updateData.staffId = merged[0].staffId;
      if (merged[0].staffName) updateData.staffName = merged[0].staffName;
    } else if (services.length > 1) {
      updateData.staffId = FieldValue.delete();
      updateData.staffName = FieldValue.delete();
    }

    updateData.confirmedBy = performer.uid;
    updateData.confirmedByName = performer.name;
    updateData.confirmedByRole = performer.role;
    updateData.confirmedAt = FieldValue.serverTimestamp();
    updateData.confirmedVia = "call_center";
    staffIdsToNotify = Array.from(notify);
  } else if (action === "cancel") {
    updateData.canceledBy = performer.uid;
    updateData.canceledByName = performer.name;
    updateData.canceledByRole = performer.role;
    updateData.canceledAt = FieldValue.serverTimestamp();
    updateData.canceledVia = "call_center";
    if (typeof body.reason === "string" && body.reason.trim()) {
      updateData.cancelReason = body.reason.trim();
    }
  } else {
    updateData.completedBy = performer.uid;
    updateData.completedByName = performer.name;
    updateData.completedByRole = performer.role;
    updateData.completedAt = FieldValue.serverTimestamp();
    updateData.completedVia = "call_center";
  }

  await db.doc(`bookings/${bookingId}`).update(updateData);

  const clientName = String(data.client || data.clientName || "Customer");
  const reason = action === "cancel" && typeof body.reason === "string" ? body.reason.trim() : "";

  try {
    await db.collection("bookingActivities").add({
      ownerUid,
      bookingId,
      bookingCode: data.bookingCode || null,
      activityType: activityTypeForStatus(nextStatus),
      clientName,
      serviceName: data.serviceName || null,
      branchName: data.branchName || null,
      staffName: (updateData.staffName as string | undefined) || data.staffName || null,
      price: data.price || null,
      date: data.date || null,
      time: data.time || null,
      previousStatus: currentStatus,
      newStatus: nextStatus,
      performedBy: performer.uid,
      performedByName: performer.name,
      performedByRole: performer.role,
      source: "call_center",
      createdAt: FieldValue.serverTimestamp(),
      ...(reason ? { cancelReason: reason } : {}),
    });
  } catch (e) {
    console.error("[call-center/status] bookingActivities write failed:", e);
  }

  try {
    await logBookingStatusChangedServer(
      ownerUid,
      bookingId,
      data.bookingCode || undefined,
      clientName,
      currentStatus,
      nextStatus,
      performer,
      reason ? `Cancel reason: ${reason}` : "Updated via call center",
      data.branchName || undefined
    );
  } catch (e) {
    console.error("[call-center/status] audit log failed:", e);
  }

  try {
    const services = (Array.isArray(updateData.services) ? updateData.services : data.services || []) as DocumentData[];
    const staffName =
      (updateData.staffName as string | undefined) ||
      data.staffName ||
      services.find((s) => s.staffName)?.staffName ||
      undefined;
    const serviceSummaries = services.map((s) => ({
      name: s.name || "Service",
      staffName: s.staffName || "Any Available",
    }));

    if (nextStatus === "Confirmed") {
      for (const staffUid of staffIdsToNotify) {
        try {
          const matched = services.find((s) => String(s.staffId ?? "") === staffUid);
          await createStaffAssignmentNotification({
            bookingId,
            bookingCode: data.bookingCode,
            staffUid,
            staffName: matched?.staffName || staffName,
            clientName,
            clientPhone: data.clientPhone,
            serviceName: matched?.name || data.serviceName,
            services: services.map((s) => ({ name: s.name || "Service", staffName: s.staffName, staffId: s.staffId })),
            branchName: data.branchName,
            bookingDate: String(data.date ?? ""),
            bookingTime: String(data.time ?? ""),
            duration: data.duration,
            price: data.price,
            ownerUid,
          });
        } catch (e) {
          console.error("[call-center/status] staff assignment notification failed:", e);
        }
      }
      await createCustomerConfirmationNotification({
        bookingId,
        bookingCode: data.bookingCode,
        customerUid: data.customerUid,
        customerEmail: data.clientEmail,
        customerPhone: data.clientPhone,
        clientName,
        staffName,
        serviceName: data.serviceName,
        services: serviceSummaries,
        branchName: data.branchName,
        bookingDate: String(data.date ?? ""),
        bookingTime: String(data.time ?? ""),
        ownerUid,
      });
    } else if (nextStatus === "Canceled") {
      await createCustomerCancellationNotification({
        bookingId,
        bookingCode: data.bookingCode,
        customerUid: data.customerUid,
        customerEmail: data.clientEmail,
        customerPhone: data.clientPhone,
        clientName,
        staffName,
        serviceName: data.serviceName,
        services: serviceSummaries,
        branchName: data.branchName,
        bookingDate: data.date,
        bookingTime: data.time,
        ownerUid,
      });
    } else {
      const nc = getNotificationContent(
        nextStatus,
        data.bookingCode,
        staffName,
        data.serviceName,
        data.date,
        data.time,
        serviceSummaries
      );
      const notification: Record<string, unknown> = {
        bookingId,
        type: nc.type,
        title: nc.title,
        message: nc.message,
        status: nextStatus,
        ownerUid,
        clientName,
        services: serviceSummaries,
      };
      if (data.customerUid) notification.customerUid = data.customerUid;
      if (data.clientEmail) notification.customerEmail = data.clientEmail;
      if (data.clientPhone) notification.customerPhone = data.clientPhone;
      if (data.bookingCode) notification.bookingCode = data.bookingCode;
      if (staffName) notification.staffName = staffName;
      if (data.serviceName) notification.serviceName = data.serviceName;
      if (data.branchName) notification.branchName = data.branchName;
      if (data.date) notification.bookingDate = data.date;
      if (data.time) notification.bookingTime = data.time;
      await createNotification(notification as Parameters<typeof createNotification>[0]);
    }

    try {
      await sendBookingStatusChangeEmail(bookingId, nextStatus, data.clientEmail, clientName, ownerUid, {
        bookingCode: data.bookingCode,
        customerPhone: data.clientPhone,
        branchName: data.branchName,
        bookingDate: data.date,
        bookingTime: data.time,
        duration: data.duration,
        price: data.price,
        serviceName: data.serviceName,
        services: services.map((s) => ({
          name: s.name || "Service",
          staffName: s.staffName || null,
          time: s.time || data.time || undefined,
          duration: s.duration || data.duration || undefined,
        })),
        staffName,
      });
    } catch (emailError) {
      console.error(`[call-center/status] Failed to send ${nextStatus} email for ${bookingId}:`, emailError);
    }
  } catch (notifErr) {
    console.error("[call-center/status] notifications failed:", notifErr);
  }

  return NextResponse.json(
    {
      success: true,
      bookingId,
      bookingCode: data.bookingCode || null,
      previousStatus: currentStatus,
      status: nextStatus,
      action,
    },
    { headers: CORS_HEADERS }
  );
}
