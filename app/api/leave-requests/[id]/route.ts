import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAdminAuth, verifyTenantAccess, OWNER_ROLES } from "@/lib/authHelpers";

export const runtime = "nodejs";

type LeaveDoc = {
  ownerUid?: string;
  status?: string;
  requesterUid?: string;
};

/**
 * PATCH /api/leave-requests/[id]
 * Approve or reject a leave request (salon_owner / super_admin only).
 * Reject requires a non-empty `reason`.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAdminAuth(req, OWNER_ROLES);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      reason?: string;
    };

    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "Invalid action. Use approve or reject." },
        { status: 400 }
      );
    }

    if (action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 2) {
        return NextResponse.json(
          { error: "Rejection requires a reason (at least 2 characters)." },
          { status: 400 }
        );
      }
    }

    const db = adminDb();
    const ref = db.collection("leaveRequests").doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }

    const data = snap.data() as LeaveDoc;
    const leaveOwnerUid = data.ownerUid;

    const isSuper = authResult.userData.role === "super_admin";
    if (!isSuper && !verifyTenantAccess(leaveOwnerUid, authResult.userData.ownerUid)) {
      return NextResponse.json(
        { error: "You do not have permission to update this leave request" },
        { status: 403 }
      );
    }

    const currentStatus = (data.status || "pending").toString();
    if (currentStatus !== "pending") {
      return NextResponse.json(
        { error: "This leave request has already been processed." },
        { status: 409 }
      );
    }

    const reviewerName =
      authResult.userData.name ||
      authResult.userData.email?.split("@")[0] ||
      "Salon owner";

    if (action === "approve") {
      await ref.update({
        status: "approved",
        rejectionReason: FieldValue.delete(),
        reviewedByUid: authResult.userData.uid,
        reviewedByName: reviewerName,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      const reason = (body.reason as string).trim();
      await ref.update({
        status: "rejected",
        rejectionReason: reason,
        reviewedByUid: authResult.userData.uid,
        reviewedByName: reviewerName,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("PATCH leave-requests error:", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal error"
        : error instanceof Error
          ? error.message
          : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
