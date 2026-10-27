import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
  getTenantId,
  CORS_HEADERS,
} from "@/lib/callCenterAuth";
import {
  loadStaffSummaries,
  serializeCallCenterServiceBase,
  serviceStaffIds,
} from "@/lib/callCenterServices";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * GET /api/call-center/services?ownerUid=X&branchId=Y
 *
 * Services for a salon (optionally only those offered at `branchId`), each with the
 * stylists allowed to perform it (`staff[]`, from the service's `staffIds` allow-list).
 * An empty `staff[]` means any stylist working at the branch may take it.
 */
export async function GET(req: NextRequest) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const ownerUid = getTenantId(req)?.trim();
  if (!ownerUid) {
    return NextResponse.json({ error: "Missing ownerUid" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!canAccessWorkshopForAuth(gate.auth, ownerUid)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
  }

  const branchId = req.nextUrl.searchParams.get("branchId")?.trim() || "";

  try {
    const db = adminDb();
    const snap = await db.collection("services").where("ownerUid", "==", ownerUid).get();
    const docs = branchId
      ? snap.docs.filter((doc) => {
          const branches = doc.data().branches;
          return Array.isArray(branches) && branches.map(String).includes(branchId);
        })
      : snap.docs;

    const staffMap = await loadStaffSummaries(db, docs.flatMap((doc) => serviceStaffIds(doc.data())));

    const services = docs.map((doc) => {
      const d = doc.data();
      return {
        ...serializeCallCenterServiceBase(doc.id, d),
        branches: Array.isArray(d.branches) ? d.branches : [],
        staff: serviceStaffIds(d).filter((sid) => staffMap[sid]).map((sid) => staffMap[sid]),
      };
    });

    return NextResponse.json({ services, total: services.length }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[call-center/services GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
