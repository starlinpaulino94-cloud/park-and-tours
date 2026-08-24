/** Supabase Auth is the only runtime auth backend. */
export type AuthBackend = "supabase";

export function activeAuthBackend(): AuthBackend {
  return "supabase";
}

export function isSupabaseAuth(): true {
  return true;
}
