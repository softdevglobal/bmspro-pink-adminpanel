import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { logStaffDeletedServer } from "@/lib/auditLogServer";
import { verifyAdminAuth, STAFF_MANAGEMENT_ROLES, canManageStaff } from "@/lib/authHelpers";
import { checkRateLimit, getClientIdentifier, RateLimiters, getRateLimitHeaders } from "@/lib/rateLimiterDistributed";

export const runtime = "nodejs";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export async function POST(req: NextRequest) {
  try {
    // Security: Distributed rate limiting to prevent abuse
    const clientId = getClientIdentifier(req);
    const rateLimitResult = await checkRateLimit(clientId, RateLimiters.staffAuth);
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: "Too many requests. Please try again later.",
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // Security: Verify authentication - only salon owners/branch admins can delete staff
    const authResult = await verifyAdminAuth(req, STAFF_MANAGEMENT_ROLES);
    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const { userData } = authResult;
    
    const body = await req.json();
    const { uid, email, staffName } = body;
    
    const auth = adminAuth();
    const db = adminDb();
    let targetUid = uid as string | undefined;
    
    // Try to find user by email if UID not provided
    if (!targetUid && email) {
      const user = await auth.getUserByEmail(String(email).trim().toLowerCase()).catch(() => null);
      targetUid = user?.uid;
    }
    
    if (!targetUid) {
      return NextResponse.json({ ok: false, message: "No user found" }, { status: 404 });
    }

    // Security: Verify the staff member belongs to the same salon as the requester
    const canManage = await canManageStaff(userData.ownerUid, targetUid);
    if (!canManage.allowed) {
      return NextResponse.json(
        { error: canManage.error || "You can only delete staff from your own salon" },
        { status: 403 }
      );
    }

    // Security: Prevent users from deleting themselves
    if (targetUid === userData.uid) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      );
    }

    // Get staff data before deletion for audit log
    let staffDisplayName = staffName || "Unknown Staff";
    try {
      const userDoc = await db.doc(`users/${targetUid}`).get();
      const staffData = userDoc.data();
      if (staffData) {
        staffDisplayName = staffData.name || staffData.displayName || staffDisplayName;
      }
    } catch (e) {
      // Continue with provided data
    }

    // 1. Delete from Firebase Auth (so email can be reused for new accounts)
    try {
      await auth.deleteUser(targetUid);
    } catch (authErr: any) {
      // auth/user-not-found: staff may have been created without auth - continue with DB cleanup
      if (authErr?.code !== "auth/user-not-found") {
        throw authErr;
      }
      console.warn("[STAFF DELETE] Auth user not found, proceeding with Firestore cleanup:", targetUid);
    }

    // 2. Remove staff from all branches
    try {
      const branchesSnap = await db.collection("branches").where("ownerUid", "==", userData.ownerUid).get();
      for (const branchDoc of branchesSnap.docs) {
        const branchData = branchDoc.data();
        const staffIds = branchData.staffIds || [];
        const staffByDay = branchData.staffByDay || {};
        if (!staffIds.includes(targetUid)) continue;

        const newStaffByDay: Record<string, string[]> = {};
        for (const day of DAYS) {
          const dayStaff = (staffByDay[day] || []).filter((id: string) => id !== targetUid);
          if (dayStaff.length > 0) newStaffByDay[day] = dayStaff;
        }
        const newStaffIds = staffIds.filter((id: string) => id !== targetUid);
        await branchDoc.ref.update({
          staffByDay: newStaffByDay,
          staffIds: newStaffIds,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (branchErr: any) {
      console.error("[STAFF DELETE] Error removing from branches:", branchErr);
      // Continue - still delete the user doc
    }

    // 3. Delete Firestore users document
    await db.doc(`users/${targetUid}`).delete();

    // Create audit log
    try {
      await logStaffDeletedServer(
        userData.ownerUid,
        targetUid,
        staffDisplayName,
        { uid: userData.uid, name: userData.name || "Admin", role: userData.role }
      );
    } catch (auditError) {
      console.error("Failed to create audit log for staff deletion:", auditError);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("API Error:", err);
    const message = process.env.NODE_ENV === "production"
      ? "Failed to delete staff"
      : err?.message || "Failed to delete staff";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
