import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantUpdate, tenantDelete, requireAtLeast, atLeast, TenantError } from "@/lib/tenant";
import {
  getResource, sanitizePayload, partnerScopeFor, readRoleFor,
  ownershipFieldFor, OWNERSHIP_OVERRIDE_ROLE,
} from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { refId } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

type Params = { params: Promise<{ resource: string; id: string }> };

/**
 * Enforces B2B partner isolation on a single record (AUD-003). `tenantFindOne`
 * only checks `company`, so without this a partner could read another partner's
 * order/commission/etc. by guessing its id.
 */
function assertPartnerCanRead(table: string, partnerId: string | null, record: Record<string, unknown>) {
  const scope = partnerScopeFor(table, partnerId);
  if (scope.kind === "denied") throw new TenantError("No tienes acceso a este recurso", 403);
  if (scope.kind === "own") {
    const value = scope.field === "_id" ? (record._id as string) : refId(record[scope.field]);
    if (value !== scope.partnerId) throw new TenantError("Registro fuera de tu ámbito", 403);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(_req, `erp:read:${def.table}`, ctx.userId), limit: 240, windowMs: 60_000 });
    // AUD-004 follow-up: same read authorization as the list endpoint.
    if (ctx.role !== "partner") {
      const rr = readRoleFor(def.table);
      if (rr) requireAtLeast(ctx, rr);
    }
    const record = await tenantFindOne<Record<string, unknown>>(ctx.companyId, def.table, id, def.expandOne || def.expand || {});
    if (ctx.role === "partner") assertPartnerCanRead(def.table, ctx.partnerId, record);
    return ok(record);
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    assertSameOriginMutation(req);
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);
    if (def.writable.length === 0) throw new TenantError("Este recurso es de solo lectura", 405);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, `erp:update:${def.table}`, ctx.userId), limit: 90, windowMs: 60_000 });
    // AUD-004: a partner is read-only in the generic ERP (some resources have
    // no writeRole, which would otherwise let any authenticated user write).
    if (ctx.role === "partner") throw new TenantError("No tienes permisos para modificar este recurso", 403);
    if (def.writeRole) requireAtLeast(ctx, def.writeRole);

    // Propiedad por fila: la RLS aísla por empresa, no por persona. Sin esto un
    // vendedor podía cerrar o reasignar la tarea de cualquier compañero.
    //
    // Cuesta una lectura extra por escritura para los roles por debajo de
    // manager. Es deliberado: resolverlo dentro del UPDATE ahorraría el viaje
    // pero devolvería "no encontrado" en vez de un 403 explicando por qué, y la
    // lectura es un acceso por clave primaria sobre un índice.
    const ownerField = ownershipFieldFor(def.table);
    if (ownerField && !atLeast(ctx.role, OWNERSHIP_OVERRIDE_ROLE)) {
      const current = await tenantFindOne<Record<string, unknown>>(ctx.companyId, def.table, id);
      if (refId(current[ownerField]) !== ctx.userId) {
        throw new TenantError("Solo puedes modificar registros asignados a ti", 403);
      }
    }

    const body = await readJson(req);
    const payload = sanitizePayload(def, body);
    if (Object.keys(payload).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const updated = await tenantUpdate(ctx.companyId, def.table, id, payload);
    console.log(`[api] ${ctx.email} actualizó ${def.table}/${id}`);
    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    assertSameOriginMutation(req);
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, `erp:delete:${def.table}`, ctx.userId), limit: 30, windowMs: 60_000 });
    if (ctx.role === "partner") throw new TenantError("No tienes permisos para eliminar este recurso", 403);
    requireAtLeast(ctx, def.writeRole === "seller" ? "manager" : def.writeRole || "manager");

    await tenantDelete(ctx.companyId, def.table, id);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "record_deleted", entityType: def.table, entityId: id,
      description: `${ctx.email} eliminó ${def.table}/${id}`,
      severity: "warning",
    });
    return ok({ deleted: true, id });
  } catch (err) {
    return fail(err);
  }
}
