import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { supabaseServer } from "@/lib/supabase/server";
import { applyQuery, applyFilter, type QueryShape } from "@/lib/supabase/query-translator";
import { aliasField, aliasesFor, DEFAULT_FIELD_ALIASES } from "@/lib/supabase/query-translator";
import {
  splitPartnerInput, mergePartnerRow, resolveRelationshipType,
} from "@/lib/partners";

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

/**
 * Inverso del mapa de alias, de UNA columna a TODOS sus nombres legacy.
 *
 * `hotel_id` se lee como `hotel` en `pickup` y como `pickup_hotel` en `booking`:
 * con un inverso uno-a-uno el último gana y el otro campo llega vacío a la UI.
 * Poblar los dos cuesta una clave más en el objeto y nunca pisa un valor real,
 * porque solo se rellena lo que no venía ya en la fila.
 */
const PG_TO_LEGACY = Object.entries(DEFAULT_FIELD_ALIASES).reduce<Record<string, string[]>>(
  (acc, [legacy, pg]) => {
    if (legacy === pg) return acc;
    (acc[pg] ||= []).push(legacy);
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

function toPgPayload(
  data: Record<string, unknown>,
  aliases: Record<string, string> = DEFAULT_FIELD_ALIASES
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (["_id", "id", "createdAt", "updatedAt", "created_at", "updated_at"].includes(key)) continue;
    out[aliasField(key, aliases)] = refValue(value);
  }
  return out;
}

/**
 * Fila de `organization_relationships` de un partner, si existe.
 *
 * Se ordena por antigüedad para que la lectura sea estable: la tabla admite
 * varias relaciones por pareja (su clave única incluye el tipo) y la aplicación
 * trabaja con una sola.
 */
async function partnerRelationship(
  sb: Awaited<ReturnType<typeof client>>,
  orgId: string,
  partnerId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await sb
    .from("organization_relationships")
    .select("*")
    .eq("from_org_id", orgId)
    .eq("to_org_id", partnerId)
    .order("created_at", { ascending: true })
    .limit(1);
  return (data?.[0] as Record<string, unknown>) ?? null;
}

/** Las relaciones de varios partners de una vez, indexadas por partner. */
async function partnerRelationships(
  sb: Awaited<ReturnType<typeof client>>,
  orgId: string,
  partnerIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (partnerIds.length === 0) return out;
  const { data } = await sb
    .from("organization_relationships")
    .select("*")
    .eq("from_org_id", orgId)
    .in("to_org_id", partnerIds)
    .order("created_at", { ascending: true });
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const key = String(row.to_org_id);
    if (!out.has(key)) out.set(key, row);
  }
  return out;
}

/**
 * Guarda las condiciones comerciales del partner en su relación.
 *
 * `relationship_type` es obligatorio, así que una edición que no toca el tipo lo
 * hereda de la fila existente o de `metadata`. Si no hay nada que guardar y
 * tampoco existía relación, no se crea una vacía.
 */
async function savePartnerRelationship(
  sb: Awaited<ReturnType<typeof client>>,
  orgId: string,
  partnerId: string,
  relationship: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<void> {
  const existing = await partnerRelationship(sb, orgId, partnerId);
  const { relationship_type: incomingType, ...rest } = relationship;
  if (!existing && Object.keys(rest).length === 0 && incomingType === undefined) return;

  const payload = {
    ...rest,
    relationship_type: resolveRelationshipType(incomingType, existing ?? undefined, metadata),
  };

  const { error } = existing
    ? await sb.from("organization_relationships").update(payload).eq("id", existing.id as string)
    : await sb.from("organization_relationships").insert({
        ...payload, from_org_id: orgId, to_org_id: partnerId,
      });
  if (error) {
    console.error("[partner] no se pudo guardar la relación comercial:", error.message);
    throw new Error(error.message);
  }
}

function fromPgRow<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => fromPgRow(item)) as T;
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...input };
  for (const [key, raw] of Object.entries(input)) {
    const normalised = fromPgRow(raw);
    out[key] = normalised;
    for (const legacy of PG_TO_LEGACY[key] || []) {
      if (out[legacy] === undefined) out[legacy] = normalised;
    }
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
    const rows = (data ?? []) as Record<string, unknown>[];
    const relationships = await partnerRelationships(sb, orgId, rows.map((r) => String(r.id)));
    return rows.map((row) => mergePartnerRow(fromPgRow(row), relationships.get(String(row.id)))) as T[];
  }
  const scopedOpts: QueryShape = { ...options, _filter: scoped(orgId, options._filter) };
  const q = applyQuery(sb.from(table).select(select) as any, scopedOpts, aliasesFor(table));
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
  const q = applyFilter(base, scoped(orgId, filter), aliasesFor(table));
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
    const relationship = await partnerRelationship(sb, orgId, id);
    return mergePartnerRow(fromPgRow(data as unknown as Record<string, unknown>), relationship) as T;
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
    const split = splitPartnerInput(data);
    const { data: row, error } = await sb.from("organizations").insert({
      ...split.org,
      kind: "partner",
      // Una subagencia cuelga de su agencia matriz; el resto, del inquilino.
      parent_org_id: split.parentPartnerId || orgId,
      tenant_org_id: orgId,
      name: String(split.org.name || split.org.legal_name || split.metadata.commercial_name || "Partner"),
      metadata: split.metadata,
    }).select().single();
    if (error) {
      console.error(`[spCreate] partner:`, error.message);
      throw new Error(error.message);
    }
    const created = row as Record<string, unknown>;
    await savePartnerRelationship(sb, orgId, String(created.id), split.relationship, split.metadata);
    const relationship = await partnerRelationship(sb, orgId, String(created.id));
    return mergePartnerRow(fromPgRow(created), relationship) as T;
  }
  const payload = { ...toPgPayload(data, aliasesFor(table)), organization_id: orgId };
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
    const split = splitPartnerInput(data);

    // `metadata` se fusiona con lo GUARDADO, no con lo que trae el formulario:
    // al serializarse, una clave ausente desaparece del JSON, así que editar
    // solo el crédito borraba el nombre comercial y el contacto del partner.
    const current = await sb
      .from("organizations").select("metadata")
      .eq("id", id).eq("kind", "partner").eq("tenant_org_id", orgId).limit(1).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw notFound();
    const stored = (current.data as { metadata?: unknown }).metadata;
    const metadata = {
      ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}),
      ...split.metadata,
    };

    const payload: Record<string, unknown> = { ...split.org, metadata };
    if (split.parentPartnerId) payload.parent_org_id = split.parentPartnerId;

    const { data: row, error } = await sb
      .from("organizations").update(payload).eq("id", id).eq("kind", "partner").eq("tenant_org_id", orgId).select().single();
    if (error) throw new Error(error.message);
    if (!row) throw notFound();

    await savePartnerRelationship(sb, orgId, id, split.relationship, metadata);
    const relationship = await partnerRelationship(sb, orgId, id);
    return mergePartnerRow(fromPgRow(row as Record<string, unknown>), relationship) as T;
  }
  // organization_id is immutable through this path.
  const { organization_id: _drop, company: _drop2, ...safe } = data as Record<string, unknown>;
  const payload = toPgPayload(safe, aliasesFor(table));
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
