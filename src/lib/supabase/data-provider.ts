import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { supabaseServer } from "@/lib/supabase/server";
import { applyQuery, applyFilter, type QueryShape } from "@/lib/supabase/query-translator";

/**
 * Supabase data provider — the M2 replacement for the Totalum-backed helpers in
 * `tenant.ts`, exposing matching operations so `tenant.ts` can delegate to it
 * behind the `DATA_BACKEND` flag.
 *
 * TENANT SCOPING — two modes:
 *  - TRANSITION (default, pre-M3 auth): uses the SERVICE-ROLE client and applies
 *    `organization_id = <orgId>` EXPLICITLY on every operation. This mirrors the
 *    current app-level isolation exactly, so the Supabase backend is usable and
 *    testable BEFORE Supabase Auth is migrated.
 *  - RLS (post-M3, SUPABASE_USE_RLS=true): uses the request client that carries
 *    the user's JWT; the database enforces the tenant via RLS and the explicit
 *    filter becomes a redundant defense-in-depth.
 *
 * The explicit `organization_id` filter is always applied, so isolation never
 * depends on which client is active.
 */

const notFound = (msg = "Registro no encontrado o fuera de tu empresa") =>
  Object.assign(new Error(msg), { status: 404 });

function rlsEnabled(): boolean {
  return process.env.SUPABASE_USE_RLS === "true";
}

async function client() {
  return rlsEnabled() ? await supabaseServer() : supabaseService();
}

/** Merges the tenant scope into a filter (defense-in-depth in both modes). */
function scoped(orgId: string, filter: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...filter, organization_id: orgId };
}

export async function spQuery<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  options: QueryShape = {},
  select = "*"
): Promise<T[]> {
  const sb = await client();
  const scopedOpts: QueryShape = { ...options, _filter: scoped(orgId, options._filter) };
  const q = applyQuery(sb.from(table).select(select) as any, scopedOpts);
  const { data, error } = await (q as any);
  if (error) {
    console.error(`[spQuery] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

export async function spCount(orgId: string, table: string, filter: Record<string, unknown> = {}): Promise<number> {
  const sb = await client();
  const base = sb.from(table).select("*", { count: "exact", head: true }) as any;
  const q = applyFilter(base, scoped(orgId, filter));
  const { count, error } = await (q as any);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function spFindOne<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  id: string,
  select = "*"
): Promise<T> {
  const sb = await client();
  const { data, error } = await sb
    .from(table).select(select).eq("id", id).eq("organization_id", orgId).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound();
  return data as T;
}

export async function spCreate<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await client();
  const payload = { ...data, organization_id: orgId };
  const { data: row, error } = await sb.from(table).insert(payload).select().single();
  if (error) {
    console.error(`[spCreate] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return row as T;
}

export async function spUpdate<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await client();
  // organization_id is immutable through this path.
  const { organization_id: _drop, company: _drop2, ...safe } = data as Record<string, unknown>;
  const { data: row, error } = await sb
    .from(table).update(safe).eq("id", id).eq("organization_id", orgId).select().single();
  if (error) throw new Error(error.message);
  if (!row) throw notFound();
  return row as T;
}

export async function spDelete(orgId: string, table: string, id: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.from(table).delete().eq("id", id).eq("organization_id", orgId);
  if (error) throw new Error(error.message);
}

/** Reserves departure capacity atomically (RPC 0008) — closes overbooking. */
export async function spReserveCapacity(departureId: string, pax: number, override = false): Promise<boolean> {
  const sb = await client();
  const { data, error } = await sb.rpc("reserve_departure_capacity", {
    p_departure_id: departureId,
    p_pax: pax,
    p_override: override,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
