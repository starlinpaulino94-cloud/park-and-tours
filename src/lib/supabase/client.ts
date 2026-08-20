"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (M3). Singleton so auth state is shared across the app.
 * Used by the login/register pages when AUTH_BACKEND=supabase.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase no configurado (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)");
  cached = createBrowserClient(url, key);
  return cached;
}

// Thin facade mirroring the shape the pages use with better-auth, so the
// login/register flows port with minimal change.
export const supabaseAuth = {
  signUpEmail: (email: string, password: string, name?: string) =>
    supabaseBrowser().auth.signUp({ email, password, options: { data: name ? { name } : undefined } }),
  signInEmail: (email: string, password: string) =>
    supabaseBrowser().auth.signInWithPassword({ email, password }),
  signOut: () => supabaseBrowser().auth.signOut(),
  resetPassword: (email: string, redirectTo?: string) =>
    supabaseBrowser().auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
};
