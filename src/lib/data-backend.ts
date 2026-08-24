/**
 * Supabase is the only runtime data backend.
 */
export type DataBackend = "supabase";

export function configuredDataBackend(): DataBackend {
  return "supabase";
}

export function assertSafeDataBackendConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SUPABASE_USE_RLS === "true") return;

  throw new Error(
    "Unsafe production config: Supabase data access requires SUPABASE_USE_RLS=true. " +
    "Confirm Supabase Auth memberships/JWT claims before deploying to production."
  );
}

export function activeBackend(): DataBackend {
  assertSafeDataBackendConfig();
  return "supabase";
}

export function isSupabase(): true {
  activeBackend();
  return true;
}

/** Maps legacy domain table names to their Postgres table names. */
const TABLE_MAP: Record<string, string> = {
  company: "organizations",
  // `order` is a reserved SQL word; the Postgres table is `sales_order`.
  order: "sales_order",
};

export function pgTable(tableName: string): string {
  return TABLE_MAP[tableName] ?? tableName;
}
