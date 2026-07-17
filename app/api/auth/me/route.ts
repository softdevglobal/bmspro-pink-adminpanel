import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * GET /api/auth/me
 * 
 * Returns the current user's role and profile info by verifying
 * the Firebase ID token and reading from Firestore via Admin SDK
 * (bypasses security rules).
 * 
 * Headers: Authorization: Bearer <idToken>
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing authorization header" }, { status: 401 });
    }

    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    // Verify the Firebase ID token
    const auth = adminAuth();
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (verifyErr) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const uid = decodedToken.uid;
    const db = adminDb();

    // Check super_admins collection first
    const superAdminDoc = await db.doc(`super_admins/${uid}`).get();
    
    if (superAdminDoc.exists) {
      const data = superAdminDoc.data();
      return NextResponse.json({
        uid,
        role: "super_admin",
        email: data?.email || decodedToken.email || "",
        displayName: data?.displayName || "",
        isSuperAdmin: true,
      });
    }

    // Command-center agents (prefer over users/{uid} so auto-created "pending" rows don't win)
    const ccAgentDoc = await db.doc(`call_center_agents/${uid}`).get();
    if (ccAgentDoc.exists) {
      const data = ccAgentDoc.data();
      const role = (data?.role || "agent").toString().toLowerCase();
      return NextResponse.json({
        uid,
        role,
        email: data?.email || decodedToken.email || "",
        displayName: data?.displayName || data?.name || "",
        isSuperAdmin: false,
        suspended: Boolean(data?.suspended),
        status: data?.status || "",
        ownerUid: uid,
        accountStatus: "active",
        subscriptionStatus: "active",
        stripeSubscriptionId: null,
        trial_end: null,
        trialDays: 0,
        plan: null,
        price: null,
        planId: null,
        plan_key: null,
        salonName: "",
      });
    }

    const userDoc = await db.doc(`users/${uid}`).get();

    if (userDoc.exists) {
      const data = userDoc.data();
      return NextResponse.json({
        uid,
        role: (data?.role || "").toString().toLowerCase(),
        email: data?.email || decodedToken.email || "",
        displayName: data?.displayName || data?.name || "",
        isSuperAdmin: false,
        suspended: Boolean(data?.suspended),
        status: data?.status || "",
        ownerUid: data?.ownerUid || uid,
        accountStatus: data?.accountStatus || "active",
        subscriptionStatus: data?.subscriptionStatus || "active",
        stripeSubscriptionId: data?.stripeSubscriptionId || null,
        trial_end: data?.trial_end || null,
        trialDays: data?.trialDays || 0,
        plan: data?.plan || null,
        price: data?.price || null,
        planId: data?.planId || null,
        plan_key: data?.plan_key || null,
        salonName: data?.salonName || data?.name || data?.businessName || "",
      });
    }

    // User exists in Auth but not in Firestore
    return NextResponse.json({
      uid,
      role: "",
      email: decodedToken.email || "",
      displayName: "",
      isSuperAdmin: false,
    });

  } catch (err: any) {
    console.error("[/api/auth/me] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
