import { NextRequest, NextResponse } from "next/server";

import { CORS_HEADERS } from "@/lib/callCenterAuth";
import {
  registerCommandCenterAgentInSupabase,
  type CreateCommandCenterAgentBody,
} from "@/lib/registerCommandCenterAgentInSupabase";
import { verifySupabaseSuperAdminForAgentRegistration } from "@/lib/supabaseSuperAdminAuth";
import {
  getMissingSupabaseRegistrationEnv,
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "@/lib/supabaseCommandCenterEnv";

export const runtime = "nodejs";

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/supabase/register-agent
 *
 * Auth: `Authorization: Bearer <Supabase access_token>` — caller must have super_admin (or configured role).
 */
export async function POST(req: NextRequest) {
  const gate = await verifySupabaseSuperAdminForAgentRegistration(req);
  if (!gate.ok) {
    return NextResponse.json(
      { success: false, error: gate.error },
      { status: gate.status, headers: CORS_HEADERS }
    );
  }

  const supabaseUrl = getSupabaseProjectUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    const missing = getMissingSupabaseRegistrationEnv();
    return NextResponse.json(
      {
        success: false,
        error:
          missing.length > 0
            ? `Missing Supabase env: ${missing.join(", ")}`
            : "Supabase is not configured.",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body: CreateCommandCenterAgentBody;
  try {
    body = (await req.json()) as CreateCommandCenterAgentBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (
    !body?.name ||
    !body?.email ||
    !body?.password ||
    body.phone === undefined
  ) {
    return NextResponse.json(
      { success: false, error: "name, email, phone, and password are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const result = await registerCommandCenterAgentInSupabase({
      supabaseUrl,
      serviceRoleKey,
      body,
    });

    return NextResponse.json(
      {
        success: true,
        authenticatedAs: {
          uid: gate.auth.userId,
          email: gate.auth.email ?? "",
          roles: gate.auth.roles,
        },
        supabase: {
          userId: result.userId,
          agentId: result.agentId,
        },
        firebasePink: {
          uid: result.firebasePinkUid,
        },
        firebaseBlack: result.firebaseBlackUid
          ? { uid: result.firebaseBlackUid }
          : null,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration failed";
    console.error("[call-center/supabase/register-agent POST]", e);
    return NextResponse.json(
      { success: false, error: msg },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
