import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, tenantCreate, tenantCount, requireAtLeast, TenantError } from "@/lib/tenant";
import { getResource, sanitizePayload, partnerScopeFor, readRoleFor, allowedFilterFields } from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { decidableFilter } from "@/lib/approvals";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

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
      const rows = await tenantQuery(ctx.companyId, def.table, {
        ...(def.expand || {}),
        _filter: filter,
        _sort: sort,
        _limit: limit + 1,
        _offset: offset,
      });
      const pageRows = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const elapsed = Date.now() - started;
      if (process.env.NODE_ENV !== "production" && elapsed > 800) {
        console.warn(`[api/erp] ${resourceName} sin total tardó ${elapsed}ms`);
      }
      return ok(pageRows, { total: offset + pageRows.length + (hasMore ? 1 : 0) });
    }

    const [rows, total] = await Promise.all([
      tenantQuery(ctx.companyId, def.table, {
        ...(def.expand || {}),
        _filter: filter,
        _sort: sort,
        _limit: limit,
        _offset: offset,
      }),
      tenantCount(ctx.companyId, def.table, filter),
    ]);

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
