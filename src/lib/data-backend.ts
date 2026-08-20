/**
 * Data backend switch (M2). Lets the tenant data-access helpers route to either
 * Totalum (current, default) or Supabase, so the migration can run in parallel
 * and be validated before cutover.
 *
 *   DATA_BACKEND=totalum   (default) — legacy Totalum SDK path, unchanged.
 *   DATA_BACKEND=supabase             — Postgres via the Supabase provider.
 *
 * Flipping to `supabase` requires a Supabase project with the M1 migrations
 * applied. Until Supabase Auth lands (M3) the provider runs in service-role +
 * explicit-org-scope mode (see data-provider.ts); set SUPABASE_USE_RLS=true once
 * the JWT carries the org claim.
 */
export type DataBackend = "totalum" | "supabase";

export function activeBackend(): DataBackend {
  return process.env.DATA_BACKEND === "supabase" ? "supabase" : "totalum";
}

export function isSupabase(): boolean {
  return activeBackend() === "supabase";
}

/**
 * Maps a legacy Totalum table name to its Postgres table. Most tables keep the
 * same name; only a few were renamed by the new schema.
 */
const TABLE_MAP: Record<string, string> = {
  company: "organizations",
};

export function pgTable(totalumTable: string): string {
  return TABLE_MAP[totalumTable] ?? totalumTable;
}
