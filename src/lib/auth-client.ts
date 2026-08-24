"use client";

import { supabaseAuth } from "@/lib/supabase/client";

export const signIn = {
  email: async ({ email, password }: { email: string; password: string }) => {
    const { error, data } = await supabaseAuth.signInEmail(email, password);
    return { data, error: error ? { message: error.message } : null };
  },
};

export const signUp = {
  email: async ({ email, password, name }: { email: string; password: string; name?: string }) => {
    const { error, data } = await supabaseAuth.signUpEmail(email, password, name);
    return { data, error: error ? { message: error.message } : null };
  },
};

export const signOut = () => supabaseAuth.signOut();
