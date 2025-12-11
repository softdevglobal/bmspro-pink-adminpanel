import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { uid, disabled } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: "Missing uid" }, { status: 400 });
    }

    // Update the user's disabled status
    await adminAuth().updateUser(uid, {
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

