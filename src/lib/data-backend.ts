/**
 * Data backend switch (M2). Lets the tenant data-access helpers route to either
 * Totalum (current, default) or Supabase, so the migration can run in parallel
 * and be validated before cutover.
 *
 *   DATA_BACKEND=totalum   (default) — legacy Totalum SDK path, unchanged.
 *   DATA_BACKEND=supabase             — Postgres via the Supabase provider.
 *
 * Flipping to `supabase` requires a Supabase project with the migrations
 * applied. Non-production environments may use service-role + explicit org scope
 * for validation. Production is fail-closed: `DATA_BACKEND=supabase` requires
 * `SUPABASE_USE_RLS=true` so the request JWT and database RLS are active.
 */
export type DataBackend = "totalum" | "supabase";

export function assertSafeDataBackendConfig(): void {
  if (process.env.DATA_BACKEND !== "supabase") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SUPABASE_USE_RLS === "true") return;

  throw new Error(
    "Unsafe production config: DATA_BACKEND=supabase requires SUPABASE_USE_RLS=true. " +
    "Confirm Supabase Auth memberships/JWT claims before enabling the Supabase data backend in production."
  );
}

export function activeBackend(): DataBackend {
  assertSafeDataBackendConfig();
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
  // `order` is a reserved SQL word — the Postgres table is `sales_order`.
  order: "sales_order",
};

export function pgTable(totalumTable: string): string {
  return TABLE_MAP[totalumTable] ?? totalumTable;
}
