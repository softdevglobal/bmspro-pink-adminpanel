import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

// Ensure this route runs in a Node.js runtime (required by firebase-admin)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { email, displayName, password } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    const auth = adminAuth();
    const user = await auth.createUser({
      email: email.trim().toLowerCase(),
      displayName: displayName || "",
      password: password || Math.random().toString(36).slice(2, 10), // temp random password
      emailVerified: false,
      disabled: false,
    });

    return NextResponse.json({ uid: user.uid }, { status: 200 });
  } catch (err: any) {
    // Surface common setup hints to the client for easier debugging in dev
    const msg = err?.message || "Failed to create auth user";
    const hint =
      "Check Firebase Admin credentials in your .env (FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* vars). Also ensure the private key is newline-escaped (\\n).";
    return NextResponse.json({ error: msg, hint }, { status: 500 });
  }
}


