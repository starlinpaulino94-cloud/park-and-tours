import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, tenantQuery, tenantCreate, tenantCount, requireAtLeast, TenantError } from "@/lib/tenant";
import { getResource, sanitizePayload, readRoleFor } from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule, assertWithinLimit } from "@/lib/plan-service";
import { notificationForCreate } from "@/lib/notify";
import { notify } from "@/lib/notify-service";
import { buildListFilter, buildListSort } from "@/lib/erp-query";

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
    await assertRateLimit({ key: rateLimitKey(req, `erp:list:${def.table}`, ctx.userId), limit: 180, windowMs: 60_000 });

    // AUD-004 follow-up: read authorization for sensitive resources. El ámbito
    // del partner lo aplica `buildListFilter` (su rango fallaría aquí).
    if (ctx.role !== "partner") {
      const rr = readRoleFor(def.table);
      if (rr) requireAtLeast(ctx, rr);
    }

    const sp = req.nextUrl.searchParams;
    const maxLimit = sp.get("bulk") === "true" ? 500 : 200;
    const limit = Math.min(Number(sp.get("limit") || 50), maxLimit);
    const offset = Number(sp.get("offset") || 0);
    const includeTotal = sp.get("includeTotal") !== "false";

    // El filtro y el orden se arman en `erp-query.ts`, compartidos con la
    // exportación: si cada uno tuviera el suyo, el archivo exportado acabaría
    // trayendo filas distintas de las que la pantalla enseña.
    const filter = buildListFilter(def, ctx, sp);
    const sort = buildListSort(def, sp);
    if (filter._none) return ok([], { total: 0 });

    if (!includeTotal) {
      const rows = await tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
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
      tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
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

    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, `erp:create:${def.table}`, ctx.userId), limit: 60, windowMs: 60_000 });
    // AUD-004: partners are read-only in the generic ERP.
    if (ctx.role === "partner") throw new TenantError("No tienes permisos para crear este recurso", 403);
    if (def.writeRole) requireAtLeast(ctx, def.writeRole);
    // El plan, después del rol y antes de escribir: el módulo acota lo que se
    // puede CREAR (leer lo ya registrado nunca se bloquea), y el catálogo tiene
    // techo en los planes con límite.
    if (def.module) assertModule(ctx, def.module);
    if (def.table === "product") await assertWithinLimit(ctx, "max_products");

    const body = await readJson(req);
    const payload = sanitizePayload(def, body);
    if (Object.keys(payload).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const created = await tenantCreate(ctx.companyId, def.table, payload);

    // Lo que se registra por una pantalla genérica también puede merecer un
    // aviso: un incidente del parque no tiene ruta propia donde colgarlo. Qué
    // avisa y qué no lo decide `notify.ts`, que devuelve null para casi todo.
    const aviso = notificationForCreate(def.table, created as Record<string, unknown>);
    if (aviso) {
      await notify({
        companyId: ctx.companyId,
        event: aviso.event,
        entityType: aviso.entityType,
        entityId: aviso.entityId,
        vars: aviso.vars,
      });
    }

    console.log(`[api] ${ctx.email} creó ${def.table}`);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
