import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Auth } from "firebase-admin/auth";

import { adminAuth } from "@/lib/firebaseAdmin";
import { getOptionalBlackAdminAuth } from "@/lib/firebaseBlackAdminOptional";

/** Mirrors command-center-backend `CreateAgentRequestBody`. */
export type WorkshopUserRole = "owner" | "branch_admin" | "staff";

export type AgentType = "workshop" | "command-centre";

export type CreateCommandCenterAgentBody = {
  name: string;
  email: string;
  phone: string;
  password: string;
  extension: string;
  notes?: string;
  agentType?: AgentType;
  tenantId?: string | null;
  workshopOwnerUid?: string;
  workshopName?: string;
  workshopBranchId?: string;
  workshopBranchName?: string;
  workshopUserRole?: WorkshopUserRole | "";
};

export type RegisterCommandCenterAgentResult = {
  /** Supabase `agents.id`. */
  agentId: string;
  /** Supabase Auth user id. */
  userId: string;
  /** Firebase Auth uid in BMS Pink (this portal). */
  firebasePinkUid: string;
  /** Firebase Auth uid in BMS Black — present when `FIREBASE_BLACK_SERVICE_ACCOUNT` is set on this server. */
  firebaseBlackUid: string | null;
};

const ALLOWED_WORKSHOP_ROLES = ["owner", "branch_admin", "staff"] as const;

/**
 * Supabase Auth user, `user_roles`, `agents` row, Firebase Pink user, optional Firebase Black user.
 */
export async function registerCommandCenterAgentInSupabase(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  body: CreateCommandCenterAgentBody;
}): Promise<RegisterCommandCenterAgentResult> {
  const { supabaseUrl, serviceRoleKey, body } = input;

  const supabaseAdmin: SupabaseClient = createClient(
    supabaseUrl,
    serviceRoleKey
  );

  const {
    name,
    email,
    phone,
    password,
    extension = "",
    notes = "",
    agentType: agentTypeRaw = "workshop",
    tenantId: tenantIdRaw = "",
    workshopOwnerUid: workshopOwnerUidRaw = "",
    workshopBranchId: workshopBranchIdRaw = "",
    workshopUserRole: workshopUserRoleRaw = "",
  } = body;

  if (!name || !email || !password) {
    throw new Error("name, email, and password are required");
  }

  const tenantId = String(tenantIdRaw ?? "").trim();
  const agentType: AgentType =
    String(agentTypeRaw ?? "").trim() === "command-centre"
      ? "command-centre"
      : "workshop";
  const workshopOwnerUid = String(workshopOwnerUidRaw ?? "").trim();
  const workshopBranchId = String(workshopBranchIdRaw ?? "").trim();
  const workshopUserRole = String(workshopUserRoleRaw ?? "").trim();

  if (!String(extension ?? "").trim()) {
    throw new Error(
      "extension is required — use the Yeastar extension number for this agent."
    );
  }
  if (agentType === "workshop" && !workshopOwnerUid) {
    throw new Error(
      "workshopOwnerUid is required — choose a workshop from BMS."
    );
  }
  if (agentType === "workshop" && !workshopBranchId) {
    throw new Error(
      "workshopBranchId is required — choose a workshop branch."
    );
  }
  if (
    agentType === "workshop" &&
    !ALLOWED_WORKSHOP_ROLES.includes(
      workshopUserRole as (typeof ALLOWED_WORKSHOP_ROLES)[number]
    )
  ) {
    throw new Error(
      "workshopUserRole is required for workshop agents — use owner, branch_admin, or staff."
    );
  }

  if (tenantId) {
    const { data: tenantRow, error: tenantErr } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantErr || !tenantRow?.id) {
      throw new Error("Invalid tenantId — tenant not found.");
    }
  }

  const { data: newUser, error: userErr } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: name,
        agent_type: agentType,
      },
    });
  if (userErr) {
    throw new Error(userErr.message);
  }

  const userId = newUser.user.id;

  const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
    user_id: userId,
    role: "agent",
  });
  if (roleErr) {
    throw new Error(`Failed to assign role: ${roleErr.message}`);
  }

  const agentId = `agent-${Date.now()}`;
  const normalizedPhone = String(phone ?? "").trim();
  const nowIso = new Date().toISOString();

  const agentsRow: Record<string, unknown> = {
    id: agentId,
    tenant_id: tenantId || null,
    queue_ids: [],
    allowed_queue_ids: [],
    name,
    extension: String(extension).trim(),
    role: "agent",
    status: "offline",
    email,
    notes: notes ?? "",
    phone_number: normalizedPhone,
    group_ids: null,
    user_id: userId,
    bms_owner_uid:
      agentType === "workshop" ? workshopOwnerUid || null : null,
    bms_branch_id:
      agentType === "workshop" ? workshopBranchId || null : null,
    workshop_user_role:
      agentType === "workshop" ? workshopUserRole || null : null,
    current_caller: null,
    call_start_time: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { error: agentErr } = await supabaseAdmin
    .from("agents")
    .insert(agentsRow);

  if (agentErr) {
    throw new Error(
      `Failed to create agent record: ${agentErr.message}. ` +
        `Check enum labels agent_role / agent_status match your DB (e.g. role=agent, status=offline).`
    );
  }

  const emailNorm = String(email).trim().toLowerCase();
  const firebasePinkUid = await ensureFirebasePinkAuthUser({
    email: emailNorm,
    password,
    displayName: name,
  });

  const blackAuth = getOptionalBlackAdminAuth();
  const firebaseBlackUid = blackAuth
    ? await ensureFirebaseBlackAuthUserWithAuth(blackAuth, {
        email: emailNorm,
        password,
        displayName: name,
      })
    : null;

  const agentUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (firebaseBlackUid) {
    agentUpdates.firebase_black_uid = firebaseBlackUid;
  }

  await supabaseAdmin.from("agents").update(agentUpdates).eq("id", agentId);

  return { agentId, userId, firebasePinkUid, firebaseBlackUid };
}

async function ensureFirebasePinkAuthUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<string> {
  const { email, password, displayName } = input;
  const auth = adminAuth();

  try {
    const existing = await auth.getUserByEmail(email);
    try {
      await auth.updateUser(existing.uid, {
        displayName: displayName || existing.displayName || undefined,
        disabled: false,
        password,
      });
    } catch {
      // best-effort sync
    }
    return existing.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      const msg = err instanceof Error ? err.message : "Firebase lookup failed";
      throw new Error(`Failed to check Firebase Pink user: ${msg}`);
    }
  }

  try {
    const created = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: false,
      disabled: false,
    });
    return created.uid;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Firebase create failed";
    throw new Error(`Failed to create Firebase Pink user: ${msg}`);
  }
}

async function ensureFirebaseBlackAuthUserWithAuth(
  auth: Auth,
  input: { email: string; password: string; displayName: string }
): Promise<string> {
  const { email, password, displayName } = input;

  try {
    const existing = await auth.getUserByEmail(email);
    try {
      await auth.updateUser(existing.uid, {
        displayName: displayName || existing.displayName || undefined,
        disabled: false,
        password,
      });
    } catch {
      // best-effort
    }
    return existing.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      const msg = err instanceof Error ? err.message : "Firebase lookup failed";
      throw new Error(`Failed to check Firebase Black user: ${msg}`);
    }
  }

  try {
    const created = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: false,
      disabled: false,
    });
    return created.uid;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Firebase create failed";
    throw new Error(`Failed to create Firebase Black user: ${msg}`);
  }
}
