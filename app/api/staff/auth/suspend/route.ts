import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { uid, disabled } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    }

    // Import Firebase Admin SDK
    const { getAuth } = await import("firebase-admin/auth");
    const { initAdmin } = await import("@/lib/firebase-admin");
    
    initAdmin();
    const auth = getAuth();

    // Update the user's disabled status
    await auth.updateUser(uid, {
      disabled: Boolean(disabled),
    });

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

