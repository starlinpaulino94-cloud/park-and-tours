"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Singleton so auth state is shared across the app.
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

// Thin auth facade used by login/register and sign-out buttons.
export const supabaseAuth = {
  signUpEmail: (email: string, password: string, name?: string) =>
    supabaseBrowser().auth.signUp({ email, password, options: { data: name ? { name } : undefined } }),
  signInEmail: (email: string, password: string) =>
    supabaseBrowser().auth.signInWithPassword({ email, password }),
  signOut: () => supabaseBrowser().auth.signOut(),
  resetPassword: (email: string, redirectTo?: string) =>
    supabaseBrowser().auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
};
