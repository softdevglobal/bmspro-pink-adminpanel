import "server-only";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getFirebaseIdTokenFromRequest } from "@/lib/authHelpers";

export async function requireSuperAdmin(req: Request): Promise<
  | { ok: true; uid: string; email: string | undefined }
  | { ok: false; status: number; error: string }
> {
  const token = getFirebaseIdTokenFromRequest(
    req as import("next/server").NextRequest,
  );
  if (!token) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const isSuperAdmin =
      decoded.superAdmin === true || decoded.role === "super_admin";

    if (!isSuperAdmin) {
      const snap = await adminDb().collection("super_admins").doc(decoded.uid).get();
      if (!snap.exists) {
        return { ok: false, status: 403, error: "Super admin access required." };
      }
    }

    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}
