import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { logStaffDeletedServer } from "@/lib/auditLogServer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { uid, email, performerUid, performerName, performerRole, staffName, ownerUid } = await req.json();
    const auth = adminAuth();
    let targetUid = uid as string | undefined;
    if (!targetUid && email) {
      const user = await auth.getUserByEmail(String(email).trim().toLowerCase()).catch(() => null);
      targetUid = user?.uid;
    }
    if (!targetUid) {
      return NextResponse.json({ ok: false, message: "No user found" }, { status: 200 });
    }

    // Get staff data before deletion for audit log
    let staffDisplayName = staffName || "Unknown Staff";
    let staffOwnerUid = ownerUid || "";
    
    try {
      const db = adminDb();
      const userDoc = await db.doc(`users/${targetUid}`).get();
      const userData = userDoc.data();
      if (userData) {
        staffDisplayName = userData.name || userData.displayName || staffDisplayName;
        staffOwnerUid = userData.ownerUid || staffOwnerUid;
      }
    } catch (e) {
      // Continue with provided data
    }

    await auth.deleteUser(targetUid);

    // Create audit log
    try {
      if (staffOwnerUid) {
        await logStaffDeletedServer(
          staffOwnerUid,
          targetUid,
          staffDisplayName,
          {
            uid: performerUid || "system",
            name: performerName || "Admin",
            role: performerRole || "salon_owner",
          }
        );
      }
    } catch (auditError) {
      console.error("Failed to create audit log for staff deletion:", auditError);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to delete auth user" }, { status: 500 });
  }
}


