/**
 * Env for Supabase — same contract as command-center-backend agent registration.
 */

function trimEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  return t === "" ? undefined : t;
}

function isUnset(value: string | undefined): boolean {
  const v = trimEnv(value);
  return v === undefined || v.startsWith("your_");
}

export function getSupabaseProjectUrl(): string | null {
  const primary = process.env.SUPABASE_URL;
  if (!isUnset(primary)) return primary as string;
  const vite = process.env.VITE_SUPABASE_URL;
  if (!isUnset(vite)) return vite as string;
  return null;
}

/** Service role — required for auth.admin.createUser and privileged inserts. */
export function getSupabaseServiceRoleKey(): string | null {
  const k = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!isUnset(k)) return k as string;
  return null;
}

export function getMissingSupabaseRegistrationEnv(): string[] {
  const missing: string[] = [];
  if (!getSupabaseProjectUrl()) missing.push("SUPABASE_URL");
  if (!getSupabaseServiceRoleKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

function readConfiguredSuperAdminRole(): string | undefined {
  const direct =
    process.env.SUPABASE_SUPER_ADMIN_ROLE?.trim() ||
    process.env.APP_ROLE_SUPER_ADMIN?.trim();
  if (direct && !direct.startsWith("your_")) return direct;
  return undefined;
}

/** Roles that may call POST /api/call-center/supabase/register-agent. */
export function roleMayRegisterAgents(role: string): boolean {
  const configured = readConfiguredSuperAdminRole();
  if (configured && role === configured) return true;
  const legacy = new Set<string>([
    "super_admin",
    "super-admin",
    "superadmin",
    "admin",
  ]);
  return legacy.has(role);
}
