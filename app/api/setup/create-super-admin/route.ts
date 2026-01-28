import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * POST /api/setup/create-super-admin
 * One-time setup endpoint to create super admin user
 * 
 * Body: { email, password, secretKey, uid? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, secretKey, uid } = body;

    // Simple secret key protection (change this or remove after use)
    if (secretKey !== "bmspro-setup-2026") {
      return NextResponse.json({ error: "Invalid secret key" }, { status: 403 });
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const auth = adminAuth();
    const db = adminDb();

    // Check if user already exists in Auth
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log("[SETUP] User already exists in Auth:", userRecord.uid);
      
      // Update password if needed
      await auth.updateUser(userRecord.uid, { password: password });
      console.log("[SETUP] Updated password for existing user");
    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        // Create new user with specific UID if provided
        const createUserData: any = {
          email: email,
          password: password,
          displayName: "Super Admin",
        };
        
        // Use existing UID from Firestore if provided
        if (uid) {
          createUserData.uid = uid;
        }
        
        userRecord = await auth.createUser(createUserData);
        console.log("[SETUP] Created new user:", userRecord.uid);
      } else {
        throw error;
      }
    }

    // Set custom claims for super admin
    await auth.setCustomUserClaims(userRecord.uid, {
      role: "super_admin",
    });

    // Create/update super_admins document
    await db.collection("super_admins").doc(userRecord.uid).set({
      email: email,
      displayName: "Super Admin",
      role: "super_admin",
      uid: userRecord.uid,
      provider: "password",
      createdAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });

    return NextResponse.json({
      success: true,
      message: "Super admin created/updated successfully",
      uid: userRecord.uid,
      email: email,
    });
  } catch (error: any) {
    console.error("[SETUP] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create super admin" },
      { status: 500 }
    );
  }
}
