import { NextRequest, NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { getDayOfWeekFromYmd } from "@/lib/callCenterBranchForBooking";
import { PINK_STAFF_ROLES, YMD_RE, staffWorksAtBranch } from "@/lib/callCenterBookings";
import { serviceStaffIds } from "@/lib/callCenterServices";
import {
  filterApprovedLeaves,
  hideStaffChipForApprovedLeaveOnDate,
  staffUidAliasListForLeave,
  type LeaveRequestLike,
} from "@/lib/staffLeaveOverlap";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/call-center/services/[serviceId]/staff?branchId=&date=YYYY-MM-DD
 *
 * Stylists who can perform this service — the same filter the Pink booking flows use:
 * active `salon_staff` / `salon_branch_admin`, on the service's `staffIds` allow-list (when set),
 * working at `branchId` (weekly schedule for `date`, else primary branch), and not on
 * full-day approved leave on `date`. Home-branch staff are listed first.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ serviceId: string }> }) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { serviceId } = await context.params;
  if (!serviceId?.trim()) {
    return NextResponse.json({ error: "Missing serviceId" }, { status: 400, headers: CORS_HEADERS });
  }

  const branchId = req.nextUrl.searchParams.get("branchId")?.trim() || "";
  const date = req.nextUrl.searchParams.get("date")?.trim() || "";
  if (date && !YMD_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const db = adminDb();
    const serviceDoc = await db.doc(`services/${serviceId}`).get();
    if (!serviceDoc.exists) {
      return NextResponse.json({ error: "Service not found" }, { status: 404, headers: CORS_HEADERS });
    }
    const svc = serviceDoc.data()!;
    const ownerUid = String(svc.ownerUid || "").trim();
    if (!ownerUid) {
      return NextResponse.json(
        { error: "Service is missing owner information" },
        { status: 422, headers: CORS_HEADERS }
      );
    }
    if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
    }

    let branchName: string | null = null;
    let branchTz = "Australia/Sydney";
    if (branchId) {
      const b = await db.doc(`branches/${branchId}`).get();
      branchName = b.data()?.name || null;
      branchTz = b.data()?.timezone || branchTz;
    }
    const dayName = date ? getDayOfWeekFromYmd(date) : null;

    const [staffSnap, leaveSnap] = await Promise.all([
      db.collection("users").where("ownerUid", "==", ownerUid).get(),
      date ? db.collection("leaveRequests").where("ownerUid", "==", ownerUid).get() : Promise.resolve(null),
    ]);
    const approvedLeaves = leaveSnap
      ? filterApprovedLeaves(leaveSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as LeaveRequestLike))
      : [];

    const allowList = serviceStaffIds(svc);
    const staff = staffSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as DocumentData & { id: string })
      .filter((st) => {
        const role = String(st.role || "").toLowerCase();
        if (!(PINK_STAFF_ROLES as readonly string[]).includes(role)) return false;
        if (st.status === "Suspended") return false;
        if (allowList.length > 0 && !allowList.includes(st.id) && !allowList.includes(String(st.uid || ""))) {
          return false;
        }
        if (branchId && !staffWorksAtBranch(st, branchId, dayName)) return false;
        if (
          date &&
          hideStaffChipForApprovedLeaveOnDate(approvedLeaves, st.id, staffUidAliasListForLeave(st), date, branchTz)
        ) {
          return false;
        }
        return true;
      })
      .map((st) => ({
        id: st.id,
        uid: String(st.uid || st.id),
        name: String(st.name || st.displayName || "Staff"),
        email: String(st.email || ""),
        role: String(st.role || "").toLowerCase(),
        staffRole: String(st.staffRole || ""),
        branchId: st.branchId || null,
        branchName: st.branchName || null,
        status: String(st.status || "Active"),
        avatar: st.avatar || null,
        inServiceAllowList: allowList.length === 0 || allowList.includes(st.id),
      }))
      .sort((a, b) => {
        if (branchId) {
          const aHome = a.branchId === branchId ? 0 : 1;
          const bHome = b.branchId === branchId ? 0 : 1;
          if (aHome !== bHome) return aHome - bHome;
        }
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json(
      {
        service: {
          id: serviceDoc.id,
          name: svc.name || "",
          hasStaffAllowList: allowList.length > 0,
          staffIds: allowList,
          price: Number(svc.price ?? 0) || 0,
          duration: Number(svc.duration ?? 0) || 0,
        },
        filter: { branchId: branchId || null, branchName, date: date || null, dayName },
        staff,
        total: staff.length,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/services/[serviceId]/staff] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
