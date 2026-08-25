import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, tenantCreate, tenantCount, requireAtLeast, TenantError } from "@/lib/tenant";
import { getResource, sanitizePayload, partnerScopeFor, readRoleFor, allowedFilterFields } from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { decidableFilter } from "@/lib/approvals";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveUserNames } from "@/lib/user-directory";

const USER_REF_FIELDS = new Set([
  "approved_by", "assigned_to", "created_by", "impersonated_by", "manager", "owner",
  "performed_by", "reported_by", "requested_by", "second_approver", "user",
]);
const RELATION_RESOURCE: Record<string, string> = {
  assigned_seller: "seller",
  driver: "staff",
  guide: "staff",
  ledger_account: "ledger_account",
  modality: "product_modality",
  parent: "ledger_account",
  parent_partner: "partner",
  pickup_hotel: "hotel",
  product_modality: "product_modality",
  rule: "commission_rule",
  route: "pickup_route",
};

function refId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const row = value as { _id?: unknown; id?: unknown };
    return typeof row._id === "string" ? row._id : typeof row.id === "string" ? row.id : null;
  }
  return null;
}

async function resolveUserRefs<T extends Record<string, unknown>>(rows: T[], expand?: Record<string, unknown>): Promise<T[]> {
  const fields = Object.keys(expand || {}).filter((field) => USER_REF_FIELDS.has(field));
  if (fields.length === 0 || rows.length === 0) return rows;

  const ids = rows.flatMap((row) => fields.map((field) => refId(row[field])));
  const names = await resolveUserNames(ids);
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const id = refId(row[field]);
      if (id) out[field] = { _id: id, name: names.get(id) || "Usuario sin nombre registrado" };
    }
    return out as T;
  });
}

function relationResource(field: string): string | null {
  if (USER_REF_FIELDS.has(field)) return null;
  return RELATION_RESOURCE[field] || (getResource(field) ? field : null);
}

function labelFor(row: Record<string, unknown>): string | undefined {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return fullName || String(
    row.name || row.commercial_name || row.full_name || row.title || row.code || row.order_number ||
    row.booking_number || row.document_number || row.reference || ""
  ).trim() || undefined;
}

async function resolvePublicRefs<T extends Record<string, unknown>>(
  orgId: string,
  rows: T[],
  expand?: Record<string, unknown>
): Promise<T[]> {
  const fields = Object.keys(expand || {}).filter((field) => relationResource(field));
  if (fields.length === 0 || rows.length === 0) return rows;

  const resolved = new Map<string, Map<string, Record<string, unknown>>>();
  for (const field of fields) {
    const resource = relationResource(field);
    if (!resource) continue;

    const ids = Array.from(new Set(rows.map((row) => refId(row[field])).filter((id): id is string => Boolean(id))));
    if (ids.length === 0) continue;

    try {
      const related = await tenantQuery<Record<string, unknown>>(orgId, resource, {
        _filter: { _id: { in: ids } },
        _limit: Math.min(ids.length, 500),
      });
      resolved.set(field, new Map(related.map((item) => [String(item._id || item.id), item])));
    } catch (err) {
      console.error(`[api/erp] no se pudo resolver la referencia ${field}:`, err);
    }
  }

  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const id = refId(row[field]);
      const related = id ? resolved.get(field)?.get(id) : null;
      if (id && related) out[field] = { ...related, name: labelFor(related) || related.name || id };
    }
    return out as T;
  });
}

async function resolveRefs<T extends Record<string, unknown>>(
  orgId: string,
  rows: T[],
  expand?: Record<string, unknown>
): Promise<T[]> {
  return resolveUserRefs(await resolvePublicRefs(orgId, rows, expand), expand);
}

/** Generic tenant-scoped list endpoint: GET /api/erp/:resource */
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const started = Date.now();
  let resourceName = "unknown";
  try {
    const { resource } = await params;
    resourceName = resource;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, `erp:list:${def.table}`, ctx.userId), limit: 180, windowMs: 60_000 });

    // AUD-004 follow-up: read authorization for sensitive resources. Partners
    // are handled by `partnerScopeFor` below (their rank would misfire here).
    if (ctx.role !== "partner") {
      const rr = readRoleFor(def.table);
      if (rr) requireAtLeast(ctx, rr);
    }

    const sp = req.nextUrl.searchParams;
    const maxLimit = sp.get("bulk") === "true" ? 500 : 200;
    const limit = Math.min(Number(sp.get("limit") || 50), maxLimit);
    const offset = Number(sp.get("offset") || 0);
    const q = sp.get("q")?.trim();
    const includeTotal = sp.get("includeTotal") !== "false";

    const filter: Record<string, unknown> = {};

    // Explicit equality filters (filter.<field>=value), restricted to an
    // allowlist (AUD-S06 follow-up). Unknown fields are ignored, not rejected.
    const filterable = allowedFilterFields(def);
    for (const [key, value] of sp.entries()) {
      if (!key.startsWith("filter.")) continue;
      const field = key.slice(7);
      if (!value || !filterable.has(field)) continue;
      filter[field] = value.includes(",") ? { in: value.split(",") } : value;
    }

    // Date range on any field: from/to + dateField
    const dateField = sp.get("dateField");
    const from = sp.get("from");
    const to = sp.get("to");
    if (dateField && (from || to)) {
      const range: Record<string, string> = {};
      if (from) range.gte = new Date(from).toISOString();
      if (to) range.lte = new Date(to).toISOString();
      filter[dateField] = range;
    }

    // Aprobaciones: el ámbito "solo las que puedo decidir" reutiliza la MISMA
    // función de dominio que la tarjeta de "Mi día" y el badge del menú, en vez
    // de reescribir las reglas de permiso en la pantalla.
    if (def.table === "approval_request" && sp.get("filter.scope") === "decidable") {
      const decidable = decidableFilter(ctx);
      if (!decidable) return ok([], { total: 0 });
      Object.assign(filter, decidable);
    }

    if (q && def.search.length > 0) {
      // AUD-S06: escape regex metacharacters so a crafted `q` cannot cause
      // catastrophic backtracking (ReDoS) or match unintended records.
      const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter._or = def.search.map((field) => ({ [field]: { regex: safeQ, options: "i" } }));
    }

    // A B2B portal user only ever sees their own partner's data (AUD-002).
    // Deny-by-default: any table not explicitly partner-owned or shared is 403.
    if (ctx.role === "partner") {
      const scope = partnerScopeFor(def.table, ctx.partnerId);
      if (scope.kind === "denied") {
        throw new TenantError("No tienes acceso a este recurso", 403);
      }
      if (scope.kind === "own") {
        filter[scope.field] = scope.partnerId;
      }
    }

    const sortParam = sp.get("sort");
    const sort = sortParam
      ? { [sortParam.replace(/^-/, "")]: sortParam.startsWith("-") ? "desc" : "asc" }
      : def.sort || { createdAt: "desc" };

    if (!includeTotal) {
      const rows = await tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
        ...(def.expand || {}),
        _filter: filter,
        _sort: sort,
        _limit: limit + 1,
        _offset: offset,
      });
      const pageRows = await resolveRefs(ctx.companyId, rows.slice(0, limit), def.expand);
      const hasMore = rows.length > limit;
      const elapsed = Date.now() - started;
      if (process.env.NODE_ENV !== "production" && elapsed > 800) {
        console.warn(`[api/erp] ${resourceName} sin total tardó ${elapsed}ms`);
      }
      return ok(pageRows, { total: offset + pageRows.length + (hasMore ? 1 : 0) });
    }

    const [rawRows, total] = await Promise.all([
      tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
        ...(def.expand || {}),
        _filter: filter,
        _sort: sort,
        _limit: limit,
        _offset: offset,
      }),
      tenantCount(ctx.companyId, def.table, filter),
    ]);
    const rows = await resolveRefs(ctx.companyId, rawRows, def.expand);

    const elapsed = Date.now() - started;
    if (process.env.NODE_ENV !== "production" && elapsed > 800) {
      console.warn(`[api/erp] ${resourceName} con total tardó ${elapsed}ms`);
    }
    return ok(rows, { total });
  } catch (err) {
    const elapsed = Date.now() - started;
    if (process.env.NODE_ENV !== "production" && elapsed > 800) {
      console.warn(`[api/erp] ${resourceName} falló tras ${elapsed}ms`);
    }
    return fail(err);
  }
}

/** Generic tenant-scoped create endpoint: POST /api/erp/:resource */
export async function POST(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { resource } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);
    if (def.writable.length === 0) throw new TenantError("Este recurso es de solo lectura", 405);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, `erp:create:${def.table}`, ctx.userId), limit: 60, windowMs: 60_000 });
    // AUD-004: partners are read-only in the generic ERP.
    if (ctx.role === "partner") throw new TenantError("No tienes permisos para crear este recurso", 403);
    if (def.writeRole) requireAtLeast(ctx, def.writeRole);

    const body = await readJson(req);
    const payload = sanitizePayload(def, body);
    if (Object.keys(payload).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const created = await tenantCreate(ctx.companyId, def.table, payload);
    console.log(`[api] ${ctx.email} creó ${def.table}`);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
