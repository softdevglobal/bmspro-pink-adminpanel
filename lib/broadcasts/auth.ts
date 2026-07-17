import { NextRequest } from "next/server";
import { verifyAdminAuth } from "@/lib/authHelpers";

const BUSINESS_MEMBER_ROLES = [
  "salon_owner",
  "salon_branch_admin",
  "salon_staff",
  "salon_admin",
];

export async function requireSuperAdmin(req: NextRequest): Promise<
  | { ok: true; uid: string; email: string | undefined }
  | { ok: false; status: number; error: string }
> {
  const authResult = await verifyAdminAuth(req, ["super_admin"]);
  if (!authResult.success) {
    return {
      ok: false,
      status: authResult.status,
      error: authResult.error,
    };
  }
  return {
    ok: true,
    uid: authResult.userData.uid,
    email: authResult.userData.email,
  };
}

export async function requireBusinessMember(req: NextRequest): Promise<
  | { ok: true; uid: string; role: string; email: string | undefined }
  | { ok: false; status: number; error: string }
> {
  const authResult = await verifyAdminAuth(req, BUSINESS_MEMBER_ROLES);
  if (!authResult.success) {
    return {
      ok: false,
      status: authResult.status,
      error: authResult.error,
    };
  }
  return {
    ok: true,
    uid: authResult.userData.uid,
    role: authResult.userData.role,
    email: authResult.userData.email,
  };
}
