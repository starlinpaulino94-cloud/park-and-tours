import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — BYPASSES RLS. SERVER ONLY. Never import into a client
 * component and never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 *
 * Restricted to legitimately cross-tenant server flows: superadmin, the Stripe
 * webhook, tenant onboarding/seed, team management, and audited impersonation.
 * Every other path must use `supabaseServer()` so RLS applies.
 */
export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service no configurado: falta NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
