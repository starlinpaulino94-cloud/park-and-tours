import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, tenantQuery, tenantCreate, tenantCount, requireAtLeast, TenantError } from "@/lib/tenant";
import { getResource, sanitizePayload, readRoleFor } from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule, assertWithinLimit } from "@/lib/plan-service";
import { writeAudit } from "@/lib/audit";
import { notificationForCreate } from "@/lib/notify";
import { notify } from "@/lib/notify-service";
import { buildListFilter, buildListSort } from "@/lib/erp-query";
import { projectRows } from "@/lib/field-projection";
import { branchStampFor } from "@/lib/branch-scope";
import { sellerStampFor } from "@/lib/seller-scope";
import { protectedFieldChanges, protectedFieldMessage } from "@/lib/field-write-role";
import { assertSellerUserLinkable } from "@/lib/seller-identity";
import { assertPayloadAssignable } from "@/lib/hr-service";

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
    /**
     * Y antes de salir, el recorte de columnas (`field-projection.ts`).
     *
     * Va en los TRES sitios que sirven filas —listado, detalle y exportación—
     * y no en uno: el exportador no sabe recortar por su cuenta, y un archivo
     * con el coste de cada excursión mientras la pantalla no lo enseña es el
     * fallo que nadie revisa porque «lo exportó el sistema».
     */
      return ok(projectRows(def.table, ctx, pageRows), { total: offset + pageRows.length + (hasMore ? 1 : 0) });
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
    return ok(projectRows(def.table, ctx, rows), { total });
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
    // La sucursal de quien crea se sella aquí, antes de limpiar el payload: así
    // lo que registra el vendedor de un tour center nace en su tour center. Si
    // eligió otra explícitamente, se respeta —un gerente puede registrar algo
    // para otra sucursal, y pisarle el dato sería un error silencioso.
    const payload = sanitizePayload(def, branchStampFor(def.table, ctx.branchId, body as Record<string, unknown>));
    if (Object.keys(payload).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    /**
     * Campos que cambian a quién se le paga: se comprueban ANTES de sellar.
     *
     * Al crear no hay valor anterior con el que comparar, así que cualquier
     * valor no vacío cuenta como cambio: nacer con el vendedor de otro es lo
     * mismo que reasignárselo un segundo después.
     */
    const bloqueados = protectedFieldChanges(def.table, ctx.role, payload, null);
    if (bloqueados.length > 0) throw new TenantError(protectedFieldMessage(bloqueados), 403);

    // Y lo que registra un vendedor nace a su nombre, igual que nace en su
    // sucursal. Va DESPUÉS de la comprobación para que el sello propio no se
    // lea como un intento de cambiar el campo.
    const sellado = sellerStampFor(def.table, ctx, payload);

    // La llave de identidad, validada contra la base: que la cuenta sea de esta
    // empresa y que no esté ya en otra ficha.
    await assertSellerUserLinkable(ctx.companyId, sellado);

    // 0051 — asignar trabajo a quien tiene una certificación obligatoria
    // vencida se para AQUÍ. La pantalla puede pintarlo en rojo; lo que impide
    // que el guía suba al bote es esta línea, porque por aquí pasan el turno,
    // el recurso de la salida y la ruta de recogida.
    await assertPayloadAssignable(ctx.companyId, def.table, sellado);

    const created = await tenantCreate(ctx.companyId, def.table, sellado);

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

    /**
     * La creación por pantalla genérica TAMBIÉN queda en la bitácora.
     *
     * El borrado se anotaba desde el principio y la edición no; crear tampoco.
     * O sea que la mayor parte de lo que se registra a diario —un cliente, un
     * proveedor, un activo, un gasto— no dejaba rastro de quién lo hizo. Un
     * registro de auditoría con huecos no sirve para lo que existe: reconstruir
     * qué pasó. Se anotan los campos enviados, no sus valores, para no duplicar
     * datos personales en una tabla que nadie puede borrar.
     */
    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "record_created",
      entityType: def.table,
      entityId: (created as Record<string, unknown>)?._id as string | undefined,
      description: `${ctx.email} creó un registro en ${def.table}`,
      metadata: { campos: Object.keys(sellado) },
    });

    console.log(`[api] ${ctx.email} creó ${def.table}`);
    return ok(created);
  } catch (err) {
    return fail(err);
  }
}
