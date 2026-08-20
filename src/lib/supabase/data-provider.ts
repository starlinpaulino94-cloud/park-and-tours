import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { applyQuery, applyFilter, aliasField, type QueryShape } from "@/lib/supabase/query-translator";
import { TenantError } from "@/lib/tenant";

/**
 * Supabase data provider — the M2 replacement for the Totalum-backed helpers in
 * `tenant.ts`, exposing the SAME signatures so call sites port unchanged. The
 * tenant scope is enforced by RLS (the JWT carries `org_id`), so these helpers
 * no longer inject `company` into every filter; they only translate the
 * Totalum-style query shape onto PostgREST.
 *
 * NOTE: `table` is the Postgres table name. The reserved word `order` is quoted
 * by PostgREST automatically via `.from('order')`.
 */

function stripSystemKeys(options: QueryShape): QueryShape {
  // Totalum passed relation-expansion keys (`partner: true`) at the top level;
  // Supabase expresses embeds inside `select`, so those keys are dropped here.
  const { _filter, _sort, _limit, _offset } = options;
  return { _filter, _sort, _limit, _offset };
}

export async function spQuery<T = Record<string, unknown>>(
  table: string,
  options: QueryShape = {},
  select = "*"
): Promise<T[]> {
  const sb = await supabaseServer();
  const q = applyQuery(sb.from(table).select(select) as any, stripSystemKeys(options));
  const { data, error } = await (q as any);
  if (error) {
    console.error(`[spQuery] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

export async function spCount(table: string, filter: Record<string, unknown> = {}): Promise<number> {
  const sb = await supabaseServer();
  const base = sb.from(table).select("*", { count: "exact", head: true }) as any;
  const q = applyFilter(base, filter);
  const { count, error } = await (q as any);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function spFindOne<T = Record<string, unknown>>(
  table: string,
  id: string,
  select = "*"
): Promise<T> {
  const sb = await supabaseServer();
  const { data, error } = await sb.from(table).select(select).eq("id", id).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new TenantError("Registro no encontrado o fuera de tu empresa", 404);
  return data as T;
}

export async function spCreate<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await supabaseServer();
  // organization_id must match the RLS claim (WITH CHECK) — set it explicitly.
  const payload = { ...data, organization_id: orgId };
  const { data: row, error } = await sb.from(table).insert(payload).select().single();
  if (error) {
    console.error(`[spCreate] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return row as T;
}

export async function spUpdate<T = Record<string, unknown>>(
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await supabaseServer();
  // organization_id is immutable through this path (RLS also forbids moving rows
  // across tenants).
  const { organization_id: _drop, ...safe } = data as Record<string, unknown>;
  const { data: row, error } = await sb.from(table).update(safe).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return row as T;
}

export async function spDelete(table: string, id: string): Promise<void> {
  const sb = await supabaseServer();
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reserves departure capacity atomically (RPC 0008) — closes overbooking. */
export async function spReserveCapacity(departureId: string, pax: number, override = false): Promise<boolean> {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("reserve_departure_capacity", {
    p_departure_id: departureId,
    p_pax: pax,
    p_override: override,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export { aliasField };
