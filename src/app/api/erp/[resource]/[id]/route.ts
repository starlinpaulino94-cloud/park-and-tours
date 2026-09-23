import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, tenantFindOne, tenantUpdate, tenantDelete, requireAtLeast, atLeast, TenantError, esDeSocio } from "@/lib/tenant";
import {
  getResource, sanitizePayload, partnerScopeFor, assertCanReadTable,
  ownershipFieldFor, OWNERSHIP_OVERRIDE_ROLE,
} from "@/lib/resources";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { refId } from "@/lib/types";
import type { AppRole } from "@/lib/auth";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { assertPayloadAssignable } from "@/lib/hr-service";
import { sellerCanReadRow, sellerFieldFor, isSellerScoped } from "@/lib/seller-scope";
import { protectedFieldChanges, protectedFieldMessage, hasProtectedFields } from "@/lib/field-write-role";
import { assertSellerUserLinkable } from "@/lib/seller-identity";
import { projectRow } from "@/lib/field-projection";

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

/**
 * El ámbito del vendedor sobre UNA fila (`seller-scope.ts`).
 *
 * El filtro del listado no protege el detalle: `tenantFindOne` solo comprueba
 * la empresa. Sin esto, acotar la lista habría sido cosmético —bastaba con
 * pedir `/api/erp/order/<id>` con el identificador de la venta de un compañero,
 * que aparece en cualquier informe o voucher, para abrirla entera.
 *
 * Es la pareja de `assertPartnerCanRead`, que hace lo mismo para el portal B2B.
 */
function assertSellerCanRead(
  table: string,
  role: AppRole,
  sellerId: string | null | undefined,
  record: Record<string, unknown>
) {
  const field = sellerFieldFor(table);
  const rowSellerId = field ? refId(record[field]) : null;
  if (!sellerCanReadRow(table, role, sellerId, rowSellerId)) {
    throw new TenantError("Este registro es de otro vendedor", 403);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { resource, id } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(_req, `erp:read:${def.table}`, ctx.userId), limit: 240, windowMs: 60_000 });
    assertCanReadTable(ctx, def.table);
    const record = await tenantFindOne<Record<string, unknown>>(ctx.companyId, def.table, id, def.expandOne || def.expand || {});
    if (esDeSocio(ctx)) assertPartnerCanRead(def.table, ctx.partnerId, record);
    assertSellerCanRead(def.table, ctx.role, ctx.sellerId, record);
    // El mismo recorte que el listado y la exportación: abrir la ficha no puede
    // enseñar lo que la lista esconde.
    return ok(projectRow(def.table, ctx, record));
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

    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, `erp:update:${def.table}`, ctx.userId), limit: 90, windowMs: 60_000 });
    // AUD-004: a partner is read-only in the generic ERP (some resources have
    // no writeRole, which would otherwise let any authenticated user write).
    if (esDeSocio(ctx)) throw new TenantError("No tienes permisos para modificar este recurso", 403);
    if (def.writeRole) requireAtLeast(ctx, def.writeRole);
    if (def.module) assertModule(ctx, def.module);

    /**
     * El ámbito del vendedor TAMBIÉN al escribir.
     *
     * Solo en lectura, la mitad del agujero seguía abierta: `order` se escribe
     * con rango de vendedor y entre sus campos editables está `seller`. Es
     * decir, un vendedor podía coger la venta de un compañero y ponerse a sí
     * mismo —reatribuyéndose la comisión— sin haberla podido ni ver.
     */
    if (isSellerScoped(def.table) && ctx.role === "seller") {
      const actual = await tenantFindOne<Record<string, unknown>>(ctx.companyId, def.table, id);
      assertSellerCanRead(def.table, ctx.role, ctx.sellerId, actual);
    }

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

    /**
     * Los campos que mueven dinero de una persona a otra.
     *
     * `order` se edita con rango de vendedor y entre sus campos editables está
     * `seller`; `seller.user` es la llave que decide de quién son las ventas y
     * hoy la escribía cualquier gerente. El rango por RECURSO no distingue
     * entre anotar una nota y cambiar a quién se le paga: eso lo hace
     * `field-write-role.ts`.
     *
     * Se compara contra la fila actual y no contra la presencia del campo: el
     * formulario genérico manda todos sus campos en cada guardado, también los
     * que nadie tocó, así que rechazar por «viene el campo» convertiría
     * cualquier edición en un 403 incomprensible.
     */
    if (hasProtectedFields(def.table)) {
      const actual = await tenantFindOne<Record<string, unknown>>(ctx.companyId, def.table, id);
      const bloqueados = protectedFieldChanges(def.table, ctx.role, payload, actual);
      if (bloqueados.length > 0) throw new TenantError(protectedFieldMessage(bloqueados), 403);
      await assertSellerUserLinkable(ctx.companyId, payload, id);
    }

    // 0051 — la misma guarda que al crear. Sin ella, bastaba con crear el turno
    // vacío y asignarle después la persona para saltarse el bloqueo entero.
    await assertPayloadAssignable(ctx.companyId, def.table, payload);

    const updated = await tenantUpdate(ctx.companyId, def.table, id, payload);

    /**
     * La edición, anotada con QUÉ campos cambiaron.
     *
     * Sin esto, entre un registro creado y el mismo registro borrado no había
     * forma de saber que alguien le cambió el precio, el estado o el titular.
     * Se guardan los nombres de los campos, no los valores: basta para
     * reconstruir la secuencia sin copiar datos del cliente a una tabla
     * inmutable.
     */
    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "record_updated",
      entityType: def.table,
      entityId: id,
      description: `${ctx.email} editó un registro de ${def.table}`,
      metadata: { campos: Object.keys(payload) },
    });
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

    // Un recurso sin campos escribibles es un libro: movimientos de caja, el
    // registro de auditoría, los asientos contables, las líneas de una
    // cotización. Si el CRUD genérico no los deja escribir, tampoco puede
    // dejarlos borrar — borrar un asiento o un movimiento de gift card desde
    // aquí descuadraba el saldo del que son la única explicación, y el total de
    // una cotización dejaba de cuadrar con su desglose. Cada uno de esos
    // recursos tiene su propia acción cuando retirar la fila es legítimo.
    if (!def.writable || def.writable.length === 0) {
      throw new TenantError(
        `${def.table} es un registro derivado: se retira desde su propia acción, no desde el CRUD genérico`,
        403
      );
    }

    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, `erp:delete:${def.table}`, ctx.userId), limit: 30, windowMs: 60_000 });
    if (esDeSocio(ctx)) throw new TenantError("No tienes permisos para eliminar este recurso", 403);
    if (def.module) assertModule(ctx, def.module);
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
