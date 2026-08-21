/**
 * Auth backend switch (M3). Routes session→tenant resolution to either
 * better-auth (current, default) or Supabase Auth.
 *
 *   AUTH_BACKEND=better-auth  (default) — current path, unchanged.
 *   AUTH_BACKEND=supabase                — Supabase Auth; the tenant (org_id,
 *     app_role, partner_id) comes from the JWT claims injected by
 *     app.custom_access_token_hook, so there is no per-request DB lookup.
 *
 * Flipping requires a Supabase project with the M1 migrations and the access
 * token hook wired (see supabase/README.md). Typically set alongside
 * DATA_BACKEND=supabase and SUPABASE_USE_RLS=true.
 */
export type AuthBackend = "better-auth" | "supabase";

export function activeAuthBackend(): AuthBackend {
  return process.env.AUTH_BACKEND === "supabase" ? "supabase" : "better-auth";
}

export function isSupabaseAuth(): boolean {
  return activeAuthBackend() === "supabase";
}
