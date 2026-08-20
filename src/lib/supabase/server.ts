import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Request-scoped Supabase client that carries the user's JWT (via cookies) and
 * therefore runs under RLS — the tenant is enforced by the database, not by the
 * app. Use for all normal reads/writes on behalf of the signed-in user.
 */
export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase no configurado: falta NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component render where cookies are read-only;
          // the middleware refreshes the session instead.
        }
      },
    },
  });
}
