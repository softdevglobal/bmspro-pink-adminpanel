import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { CORS_HEADERS } from "@/lib/callCenterAuth";
import { adminAuth } from "@/lib/firebaseAdmin";
import {
  getSupabaseProjectUrl,
  getSupabaseServiceRoleKey,
} from "@/lib/supabaseCommandCenterEnv";
import { verifySupabaseAccessToken } from "@/lib/supabaseSuperAdminAuth";

export const runtime = "nodejs";

const FIREBASE_CUSTOM_TOKEN_TTL_SECONDS = 3600;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

/**
 * POST /api/call-center/supabase/firebase-token
 *
 * Mints a Firebase **Pink** custom token for the authenticated Supabase user (same email in Pink Firebase).
 *
 * Auth: `Authorization: Bearer <Supabase access_token>`
 */
export async function POST(req: NextRequest) {
  const gate = await verifySupabaseAccessToken(req);
  if (!gate.ok) {
    return NextResponse.json(
      { success: false, error: gate.error },
      { status: gate.status, headers: CORS_HEADERS }
    );
  }

  const email = (gate.auth.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Supabase user has no email — cannot map to Firebase Pink identity.",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let firebaseUid: string;
  try {
    const user = await adminAuth().getUserByEmail(email);
    firebaseUid = user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/user-not-found") {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Firebase Pink user for this email. Register the agent first via /api/call-center/supabase/register-agent.",
        },
        { status: 404, headers: CORS_HEADERS }
      );
    }
    const msg = err instanceof Error ? err.message : "Firebase lookup failed";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const claims = await loadAgentClaimsFromSupabase(gate.auth.userId);

  let firebaseCustomToken: string;
  try {
    firebaseCustomToken = await adminAuth().createCustomToken(firebaseUid, {
      supabaseUserId: gate.auth.userId,
      roles: gate.auth.roles,
      agentType: claims.agentType,
      workshopOwnerUid: claims.workshopOwnerUid,
      workshopBranchId: claims.workshopBranchId,
      workshopUserRole: claims.workshopUserRole,
      source: "command-center",
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to mint Firebase custom token";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      success: true,
      firebaseCustomToken,
      uid: firebaseUid,
      expiresIn: FIREBASE_CUSTOM_TOKEN_TTL_SECONDS,
    },
    { headers: CORS_HEADERS }
  );
}

async function loadAgentClaimsFromSupabase(userId: string): Promise<{
  agentType: string | null;
  workshopOwnerUid: string | null;
  workshopBranchId: string | null;
  workshopUserRole: string | null;
}> {
  const url = getSupabaseProjectUrl();
  const key = getSupabaseServiceRoleKey();
  const empty = {
    agentType: null,
    workshopOwnerUid: null,
    workshopBranchId: null,
    workshopUserRole: null,
  };
  if (!url || !key) return empty;

  try {
    const admin = createClient(url, key);
    const { data, error } = await admin
      .from("agents")
      .select("bms_owner_uid, bms_branch_id, workshop_user_role")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return empty;

    return {
      agentType: data.workshop_user_role ? "workshop" : "command-centre",
      workshopOwnerUid: data.bms_owner_uid ?? null,
      workshopBranchId: data.bms_branch_id ?? null,
      workshopUserRole: data.workshop_user_role ?? null,
    };
  } catch {
    return empty;
  }
}
