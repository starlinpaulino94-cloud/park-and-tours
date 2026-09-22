"use client";

import { supabaseAuth } from "@/lib/supabase/client";

/**
 * El error se reenvía con `code` y `status`, no solo con el texto.
 *
 * El texto de Supabase es inglés y cambia entre versiones; `code` es estable y
 * es lo único que permite separar «la contraseña no es esa» de «el email no
 * está confirmado» sin adivinar. `src/lib/auth-errors.ts` decide qué se enseña.
 */
type AuthErrorShape = { message: string; code: string | null; status: number | null };

const forward = (error: { message: string; code?: string; status?: number } | null): AuthErrorShape | null =>
  error ? { message: error.message, code: error.code ?? null, status: error.status ?? null } : null;

export const signIn = {
  email: async ({ email, password }: { email: string; password: string }) => {
    const { error, data } = await supabaseAuth.signInEmail(email, password);
    return { data, error: forward(error) };
  },
};

export const signUp = {
  email: async ({ email, password, name }: { email: string; password: string; name?: string }) => {
    const { error, data } = await supabaseAuth.signUpEmail(email, password, name);
    return { data, error: forward(error) };
  },
};

export const signOut = () => supabaseAuth.signOut();
