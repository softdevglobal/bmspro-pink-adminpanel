import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

// Ensure this route runs in a Node.js runtime (required by firebase-admin)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, displayName, password } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const auth = adminAuth();
    let uid: string;

    try {
      // Check if user already exists
      const existingUser = await auth.getUserByEmail(email.trim().toLowerCase());
      uid = existingUser.uid;
      
      // If user exists, update password if provided, and ensure account is enabled
      // IMPORTANT: Do not automatically sign in - require explicit login
      const updateData: any = {
        disabled: false,
        displayName: displayName || existingUser.displayName,
        emailVerified: false, // Ensure email is not verified to prevent auto-login
      };
      if (password && password.length >= 6) {
        updateData.password = password;
      }
      
      await auth.updateUser(uid, updateData);

    } catch (error: any) {
      if (error.code === "auth/user-not-found") {
        // Create new user
        // IMPORTANT: Ensure account requires explicit login - do not auto-login
        try {
          const user = await auth.createUser({
            email: email.trim().toLowerCase(),
            displayName: displayName || "",
            password: (password && password.length >= 6) ? password : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
            emailVerified: false, // Require email verification before allowing login
            disabled: false,
          });
          uid = user.uid;
          
          // Revoke all existing sessions to prevent auto-login
          // This ensures the newly created staff must explicitly sign in
          try {
            await auth.revokeRefreshTokens(uid);
          } catch (revokeError) {
            // Ignore errors if no tokens exist (new account)
            console.log("No existing tokens to revoke for new user");
          }
        } catch (createError: any) {
          console.error("Error creating user:", createError);
          return NextResponse.json({ 
            error: createError.message || "Failed to create user", 
            code: createError.code 
          }, { status: 400 });
        }
      } else {
        console.error("Error fetching user:", error);
        // Propagate known firebase auth errors as 400 bad request instead of 500
        if (error.code?.startsWith("auth/")) {
           return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
        }
        throw error;
      }
    }
    
    // For existing users being updated, also revoke existing sessions to prevent auto-login
    // This ensures staff must explicitly sign in after account creation/update
    try {
      await auth.revokeRefreshTokens(uid);
    } catch (revokeError) {
      // Ignore errors - this is a safeguard, not critical
      console.log("Could not revoke tokens (may not exist)");
    }

    return NextResponse.json({ uid }, { status: 200 });
  } catch (err: any) {
    console.error("API Error:", err);
    // Surface common setup hints to the client for easier debugging in dev
    const msg = err?.message || "Internal Server Error";
    const hint =
      "Check Firebase Admin credentials in your .env (FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* vars). Also ensure the private key is newline-escaped (\\n).";
    return NextResponse.json({ error: msg, hint }, { status: 500 });
  }
}
