import { NextRequest, NextResponse } from "next/server";
import { createAuditLogServer } from "@/lib/auditLogServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ownerUid,
      action,
      actionType,
      entityType,
      entityId,
      entityName,
      performedBy,
      performedByName,
      performedByRole,
      details,
      previousValue,
      newValue,
      branchId,
      branchName,
      metadata,
    } = body;

    // Validate required fields
    if (!ownerUid || !action || !actionType || !entityType || !performedBy) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const logId = await createAuditLogServer({
      ownerUid,
      action,
      actionType,
      entityType,
      entityId,
      entityName,
      performedBy,
      performedByName,
      performedByRole,
      details,
      previousValue,
      newValue,
      branchId,
      branchName,
      metadata,
    });

    if (!logId) {
      return NextResponse.json(
        { error: "Failed to create audit log" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, logId }, { status: 200 });
  } catch (err: any) {
    console.error("API Error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
