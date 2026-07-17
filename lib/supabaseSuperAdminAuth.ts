import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
  roleMayRegisterAgents,
} from "@/lib/supabaseCommandCenterEnv";

export type SupabaseAuthOk = {
  userId: string;
  email: string | undefined;
  roles: string[];
};

export function bearerFromRequest(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice("Bearer ".length).trim();
  return t || null;
}

/** Verifies a Supabase access_token and returns the user + roles (no super-admin check). */
export async function verifySupabaseAccessToken(
  req: NextRequest
): Promise<
  | { ok: true; auth: SupabaseAuthOk }
  | { ok: false; error: string; status: number }
> {
  const token = bearerFromRequest(req);
  if (!token) {
    return {
      ok: false,
      error:
        "Missing Authorization: Bearer <Supabase access_token> — sign in via command-center POST /api/auth/login first.",
      status: 401,
    };
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    return {
      ok: false,
      error:
        "Supabase is not configured on this server (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
      status: 500,
    };
  }

  try {
    const admin = createClient(url, key);
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);

    if (error || !user) {
      return {
        ok: false,
        error: error?.message ?? "Invalid or expired Supabase session.",
        status: 401,
      };
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleRows ?? [])
      .map((row: { role: string }) => row.role)
      .filter(Boolean);

    return {
      ok: true,
      auth: {
        userId: user.id,
        email: user.email ?? undefined,
        roles,
      },
    };
  } catch {
    return {
      ok: false,
      error: "Invalid or expired Supabase session.",
      status: 401,
    };
  }
}

async function fetchRolesForUser(
  url: string,
  serviceRoleKey: string,
  userId: string
): Promise<string[]> {
  const admin = createClient(url, serviceRoleKey);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error || !data?.length) return [];
  return data.map((row: { role: string }) => row.role).filter(Boolean);
}

/**
 * Verifies `Authorization: Bearer <Supabase access_token>` and requires a super-admin role
 * in `user_roles` (same rules as command-center POST /api/agents/register).
 */
export async function verifySupabaseSuperAdminForAgentRegistration(
  req: NextRequest
): Promise<
  | { ok: true; auth: SupabaseAuthOk }
  | { ok: false; error: string; status: number }
> {
  const token = bearerFromRequest(req);
  if (!token) {
    return {
      ok: false,
      error:
        "Missing Authorization: Bearer <Supabase access_token> — sign in via command-center POST /api/auth/login first.",
      status: 401,
    };
  }

  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  if (!url || !key) {
    return {
      ok: false,
      error:
        "Supabase is not configured on this server (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
      status: 500,
    };
  }

  try {
    const admin = createClient(url, key);
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);

    if (error || !user) {
      return {
        ok: false,
        error: error?.message ?? "Invalid or expired Supabase session.",
        status: 401,
      };
    }

    const roles = await fetchRolesForUser(url, key, user.id);
    const allowed = roles.some((r) => roleMayRegisterAgents(r));
    if (!allowed) {
      return {
        ok: false,
        error:
          "Only super admins can register agents. Ensure user_roles.role matches SUPABASE_SUPER_ADMIN_ROLE or super_admin / admin.",
        status: 403,
      };
    }

    return {
      ok: true,
      auth: {
        userId: user.id,
        email: user.email ?? undefined,
        roles,
      },
    };
  } catch {
    return {
      ok: false,
      error: "Invalid or expired Supabase session.",
      status: 401,
    };
  }
}
