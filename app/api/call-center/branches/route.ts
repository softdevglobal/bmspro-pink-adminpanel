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
 * GET /api/call-center/branches?ownerUid=<salonOwnerUid>
 *
 * All branches for a salon owner, each in the same shape as GET …/branches/[branchId].
 * Optional `date=YYYY-MM-DD` sets `daySchedule` on every row.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const ownerUid = getTenantId(req)?.trim();
  if (!ownerUid) {
    return NextResponse.json(
      { error: "Missing ownerUid (query or X-Tenant-Id)" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
  }

  const dateParam = req.nextUrl.searchParams.get("date");

  try {
    const snap = await adminDb().collection("branches").where("ownerUid", "==", ownerUid).get();
    const branches = snap.docs
      .map((doc) => serializeCallCenterBranchForBooking(doc.id, doc.data(), dateParam))
      .filter((b): b is NonNullable<typeof b> => b != null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    return NextResponse.json({ ownerUid, total: branches.length, branches }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("[call-center/branches GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
