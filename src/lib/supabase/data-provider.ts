import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { supabaseServer } from "@/lib/supabase/server";
import { applyQuery, applyFilter, type QueryShape } from "@/lib/supabase/query-translator";
import { aliasField, DEFAULT_FIELD_ALIASES } from "@/lib/supabase/query-translator";

/**
 * Supabase data provider for tenant-scoped CRUD helpers in `tenant.ts`.
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

const PG_TO_LEGACY = Object.entries(DEFAULT_FIELD_ALIASES).reduce<Record<string, string>>(
  (acc, [legacy, pg]) => {
    acc[pg] = legacy;
    return acc;
  },
  {}
);

function refValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as { _id?: unknown; id?: unknown };
    return row._id ?? row.id ?? value;
  }
  return value;
}

function toPgPayload(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (["_id", "id", "createdAt", "updatedAt", "created_at", "updated_at"].includes(key)) continue;
    out[aliasField(key)] = refValue(value);
  }
  return out;
}

function toPartnerPayload(orgId: string, data: Record<string, unknown>): Record<string, unknown> {
  const payload = toPgPayload(data);
  const metadata = {
    ...(payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {}),
    commercial_name: data.commercial_name ?? payload.commercial_name,
    partner_type: data.partner_type ?? payload.partner_type,
    contact_name: data.contact_name ?? payload.contact_name,
    whatsapp: data.whatsapp ?? payload.whatsapp,
    address: data.address ?? payload.address,
    city: data.city ?? payload.city,
    notes: data.notes ?? payload.notes,
    commercial_terms: data.commercial_terms ?? payload.commercial_terms,
  };
  for (const key of [
    "commercial_name", "partner_type", "contact_name", "whatsapp", "address", "city",
    "credit_limit", "credit_days", "default_commission_pct", "balance", "contract_from",
    "contract_to", "commercial_terms", "notes", "parent_partner_id", "authorized_products",
  ]) {
    delete payload[key];
  }

  return {
    ...payload,
    kind: "partner",
    parent_org_id: orgId,
    tenant_org_id: orgId,
    name: String(payload.name || payload.legal_name || data.commercial_name || "Partner"),
    metadata,
  };
}

function fromPartnerRow<T>(value: T): T {
  const row = fromPgRow(value) as Record<string, unknown>;
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    ...row,
    company: row.tenant_org_id,
    commercial_name: metadata.commercial_name ?? row.legal_name ?? row.name,
    partner_type: metadata.partner_type,
    contact_name: metadata.contact_name,
    whatsapp: metadata.whatsapp,
    address: metadata.address,
    city: metadata.city,
    notes: metadata.notes,
    commercial_terms: metadata.commercial_terms,
  } as T;
}

function fromPgRow<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => fromPgRow(item)) as T;
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };
  for (const [key, raw] of Object.entries(input)) {
    const normalised = fromPgRow(raw);
    out[key] = normalised;
    const legacy = PG_TO_LEGACY[key];
    if (legacy && out[legacy] === undefined) out[legacy] = normalised;
  }
  return out as T;
}

function rlsEnabled(): boolean {
  return process.env.SUPABASE_USE_RLS === "true";
}

function partnerScoped(orgId: string, filter: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...filter, kind: "partner", tenant_org_id: orgId };
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
  if (table === "partner") {
    const scopedOpts: QueryShape = { ...options, _filter: partnerScoped(orgId, options._filter) };
    const q = applyQuery(sb.from("organizations").select(select) as any, scopedOpts);
    const { data, error } = await (q as any);
    if (error) {
      console.error(`[spQuery] partner:`, error.message);
      throw new Error(error.message);
    }
    return ((data ?? []) as T[]).map((row) => fromPartnerRow(row));
  }
  const scopedOpts: QueryShape = { ...options, _filter: scoped(orgId, options._filter) };
  const q = applyQuery(sb.from(table).select(select) as any, scopedOpts);
  const { data, error } = await (q as any);
  if (error) {
    console.error(`[spQuery] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return fromPgRow((data ?? []) as T[]);
}

export async function spCount(orgId: string, table: string, filter: Record<string, unknown> = {}): Promise<number> {
  const sb = await client();
  if (table === "partner") {
    const base = sb.from("organizations").select("*", { count: "exact", head: true }) as any;
    const q = applyFilter(base, partnerScoped(orgId, filter));
    const { count, error } = await (q as any);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
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
  if (table === "partner") {
    const { data, error } = await sb
      .from("organizations").select(select).eq("id", id).eq("kind", "partner").eq("tenant_org_id", orgId).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound();
    return fromPartnerRow(data as T);
  }
  const { data, error } = await sb
    .from(table).select(select).eq("id", id).eq("organization_id", orgId).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound();
  return fromPgRow(data as T);
}

export async function spCreate<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await client();
  if (table === "partner") {
    const { data: row, error } = await sb.from("organizations").insert(toPartnerPayload(orgId, data)).select().single();
    if (error) {
      console.error(`[spCreate] partner:`, error.message);
      throw new Error(error.message);
    }
    return fromPartnerRow(row as T);
  }
  const payload = { ...toPgPayload(data), organization_id: orgId };
  const { data: row, error } = await sb.from(table).insert(payload).select().single();
  if (error) {
    console.error(`[spCreate] ${table}:`, error.message);
    throw new Error(error.message);
  }
  return fromPgRow(row as T);
}

export async function spUpdate<T = Record<string, unknown>>(
  orgId: string,
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  const sb = await client();
  if (table === "partner") {
    const payload = toPartnerPayload(orgId, data);
    delete payload.kind;
    delete payload.parent_org_id;
    delete payload.tenant_org_id;
    const { data: row, error } = await sb
      .from("organizations").update(payload).eq("id", id).eq("kind", "partner").eq("tenant_org_id", orgId).select().single();
    if (error) throw new Error(error.message);
    if (!row) throw notFound();
    return fromPartnerRow(row as T);
  }
  // organization_id is immutable through this path.
  const { organization_id: _drop, company: _drop2, ...safe } = data as Record<string, unknown>;
  const payload = toPgPayload(safe);
  const { data: row, error } = await sb
    .from(table).update(payload).eq("id", id).eq("organization_id", orgId).select().single();
  if (error) throw new Error(error.message);
  if (!row) throw notFound();
  return fromPgRow(row as T);
}

export async function spDelete(orgId: string, table: string, id: string): Promise<void> {
  const sb = await client();
  if (table === "partner") {
    const { error } = await sb.from("organizations").delete().eq("id", id).eq("kind", "partner").eq("tenant_org_id", orgId);
    if (error) throw new Error(error.message);
    return;
  }
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
