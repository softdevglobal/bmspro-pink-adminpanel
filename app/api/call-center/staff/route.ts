import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { PINK_STAFF_ROLES, staffWorksAtBranch } from "@/lib/callCenterBookings";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/** Accept Black-style short role names as well as Pink's `salon_*` roles. */
const ROLE_ALIASES: Record<string, string> = {
  staff: "salon_staff",
  branch_admin: "salon_branch_admin",
  salon_staff: "salon_staff",
  salon_branch_admin: "salon_branch_admin",
};

/**
 * GET /api/call-center/staff
 *
 * Required: `X-Tenant-Id: <ownerUid>` header or `?ownerUid=`.
 *
 * Optional query:
 *   branchId=<id>                        Home branch OR any weekly-schedule day at this branch.
 *   role=staff|branch_admin              (or salon_staff|salon_branch_admin) — default both.
 *   status=Active|Suspended              Default all.
 *
 * Lists salon stylists (`salon_staff`) and branch admins (`salon_branch_admin`) so call center
 * agents can pick someone when creating or confirming a booking.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const ownerUid = getTenantId(req)?.trim();
  if (!ownerUid) {
    return NextResponse.json(
      { error: "Missing ownerUid (X-Tenant-Id header or ?ownerUid=)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
  }

  const params = req.nextUrl.searchParams;
  const branchId = (params.get("branchId") || "").trim();
  const roleRaw = (params.get("role") || "").trim().toLowerCase();
  const statusFilter = (params.get("status") || "").trim();
  const roleFilter = roleRaw ? ROLE_ALIASES[roleRaw] : "";
  if (roleRaw && !roleFilter) {
    return NextResponse.json(
      { error: "role must be one of: staff, branch_admin" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const db = adminDb();
    let snap;
    try {
      snap = await db
        .collection("users")
        .where("ownerUid", "==", ownerUid)
        .where("role", "in", [...PINK_STAFF_ROLES])
        .limit(500)
        .get();
    } catch {
      snap = await db.collection("users").where("ownerUid", "==", ownerUid).limit(500).get();
    }

    const staff = snap.docs
      .map((doc) => ({ id: doc.id, d: doc.data() }))
      .filter(({ d }) => {
        const role = String(d.role || "").toLowerCase();
        if (!(PINK_STAFF_ROLES as readonly string[]).includes(role)) return false;
        if (roleFilter && role !== roleFilter) return false;
        if (statusFilter && String(d.status || "Active") !== statusFilter) return false;
        if (branchId && !staffWorksAtBranch(d, branchId, null)) return false;
        return true;
      })
      .map(({ id, d }) => ({
        id,
        uid: String(d.uid || id),
        name: String(d.name || d.displayName || "Staff"),
        email: String(d.email || ""),
        mobile: String(d.mobile || d.phone || ""),
        role: String(d.role || "").toLowerCase(),
        staffRole: String(d.staffRole || ""),
        branchId: String(d.branchId || ""),
        branchName: String(d.branchName || ""),
        status: String(d.status || "Active"),
        avatar: d.avatar || null,
        timezone: d.timezone || null,
        weeklySchedule: d.weeklySchedule || null,
        training: d.training || null,
        createdAt: d.createdAt ?? null,
        updatedAt: d.updatedAt ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ staff, total: staff.length }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[call-center/staff GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
