import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import { serializeCallCenterBranchForBooking } from "@/lib/callCenterBranchForBooking";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/call-center/branches/[branchId]
 *
 * Branch details: `hours`, `daySchedules`, `bookingLimitPerDay`.
 * Optional `date=YYYY-MM-DD` sets `daySchedule` for that weekday.
 *
 * Call center agents may read any branch (tenant header ignored). BMS staff must have
 * access to the branch's salon; a supplied `ownerUid` / `X-Tenant-Id` must match it.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ branchId: string }> }) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { branchId } = await context.params;
  const id = branchId?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing branchId" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const branchDoc = await adminDb().collection("branches").doc(id).get();
    const data = branchDoc.data();
    const branchOwnerUid = typeof data?.ownerUid === "string" ? data.ownerUid.trim() : "";
    if (!branchDoc.exists || !data || !branchOwnerUid) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404, headers: CORS_HEADERS });
    }

    if (gate.auth.kind !== "agent") {
      const requestedTenant = getTenantId(req)?.trim();
      if (requestedTenant && requestedTenant !== branchOwnerUid) {
        return NextResponse.json(
          { error: "ownerUid does not match this branch" },
          { status: 400, headers: CORS_HEADERS }
        );
      }
      if (!canAccessWorkshopForAuth(gate.auth, branchOwnerUid)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
      }
    }

    const branch = serializeCallCenterBranchForBooking(id, data, req.nextUrl.searchParams.get("date"));
    return NextResponse.json({ branch }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("[call-center/branches/[branchId]]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
