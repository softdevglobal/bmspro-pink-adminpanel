import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { logStaffSuspendedServer } from "@/lib/auditLogServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { uid, disabled, performerUid, performerName, performerRole } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    }

    // Update the user's disabled status
    await adminAuth().updateUser(uid, {
      disabled: Boolean(disabled),
    });

    // Create audit log
    try {
      const db = adminDb();
      const userDoc = await db.doc(`users/${uid}`).get();
      const userData = userDoc.data();
      const staffName = userData?.name || userData?.displayName || "Unknown Staff";
      const ownerUid = userData?.ownerUid || performerUid || "";

      if (ownerUid) {
        await logStaffSuspendedServer(
          ownerUid,
          uid,
          staffName,
          {
            uid: performerUid || "system",
            name: performerName || "Admin",
            role: performerRole || "salon_owner",
          },
          Boolean(disabled)
        );
      }
    } catch (auditError) {
      console.error("Failed to create audit log for staff suspension:", auditError);
    }

    return NextResponse.json({ 
      success: true, 
      uid,
      disabled: Boolean(disabled),
      message: disabled ? "User account suspended" : "User account reactivated"
    });
  } catch (error: any) {
    console.error("Error updating user status:", error);
    
    if (error.code === "auth/user-not-found") {
      return NextResponse.json({ 
        error: "User not found in auth system",
        code: error.code 
      }, { status: 404 });
    }
    
    return NextResponse.json({ 
      error: error.message || "Failed to update user status",
      code: error.code 
    }, { status: 500 });
  }
}

