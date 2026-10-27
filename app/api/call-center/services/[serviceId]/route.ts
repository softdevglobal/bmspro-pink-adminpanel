import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  verifyCallCenterOrTenantAdminAuth,
  canAccessWorkshopForAuth,
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
 * GET /api/call-center/services/[serviceId]
 *
 * Full service detail: branches (resolved to names) and the stylists on its allow-list.
 * No tenant header needed — access is checked against the service's own `ownerUid`.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ serviceId: string }> }) {
  const gate = await verifyCallCenterOrTenantAdminAuth(req);
  if (!gate.success) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401, headers: CORS_HEADERS });
  }

  const { serviceId } = await context.params;

  try {
    const db = adminDb();
    const serviceDoc = await db.doc(`services/${serviceId}`).get();
    if (!serviceDoc.exists) {
      return NextResponse.json({ error: "Service not found" }, { status: 404, headers: CORS_HEADERS });
    }
    const d = serviceDoc.data()!;
    if (!canAccessWorkshopForAuth(gate.auth, String(d.ownerUid || ""))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: CORS_HEADERS });
    }

    const branchIds: string[] = Array.isArray(d.branches) ? d.branches.map(String) : [];
    const branchSnaps = branchIds.length > 0 ? await db.getAll(...branchIds.map((bid) => db.doc(`branches/${bid}`))) : [];
    const branches = branchSnaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, name: s.data()?.name || "" }));

    const staffMap = await loadStaffSummaries(db, serviceStaffIds(d));

    return NextResponse.json(
      {
        service: {
          ...serializeCallCenterServiceBase(serviceId, d),
          branches,
          staff: Object.values(staffMap),
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[call-center/services/[serviceId]] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
