import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { estaVetado, motivoValido, MENSAJE_SIN_MOTIVO, VETADO, type ClienteVetable } from "@/lib/lista-negra";

/**
 * PUT /api/customers/:id/lista-negra — bloquear o desbloquear a un cliente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE HACE DESDE LA FICHA
 *
 * `status` está entre los campos editables del cliente y el formulario del
 * directorio lo ofrece en un desplegable. Por ahí se podía bloquear a una
 * persona con un clic, sin motivo y sin que constara quién fue — y el CRUD
 * genérico lo cierra desde esta entrega justamente para que la única forma sea
 * esta.
 *
 * Aquí el motivo es obligatorio. No es burocracia: el caso real es que el
 * cliente aparece en el mostrador, el cajero ve «bloqueado» y tiene que decidir
 * en treinta segundos con la persona delante. Sin el motivo, o lo levanta —y el
 * bloqueo no valía nada— o lo sostiene sin saber por qué, que es peor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y NO LO DECIDE QUIEN VENDE
 *
 * `manager`. Bloquear a un cliente es una decisión comercial de la operadora, y
 * el rango de vender lo tiene también el vendedor de un tour center (5.1): sin
 * este rango, el empleado de una agencia podía vetarle un cliente a la empresa
 * que le da el producto.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "customer:lista-negra", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ blocked?: boolean; reason?: string }>(req);
    const bloquear = body.blocked === true;

    const cliente = await tenantFindOne<ClienteVetable & Record<string, unknown>>(
      ctx.companyId, "customer", id
    );
    const nombre = [cliente.first_name, cliente.last_name].filter(Boolean).join(" ") || "el cliente";

    // Ni bloquear al bloqueado ni levantar lo que no está: contestar «hecho»
    // sobre algo que no se hizo deja a quien lo pidió creyendo otra cosa.
    if (bloquear === estaVetado(cliente)) {
      throw new TenantError(
        bloquear ? "Ese cliente ya está en la lista negra" : "Ese cliente no está en la lista negra",
        409
      );
    }

    const motivo = String(body.reason ?? "").trim();
    if (bloquear && !motivoValido(motivo)) throw new TenantError(MENSAJE_SIN_MOTIVO, 400);

    /**
     * Al levantar el bloqueo, el motivo se BORRA.
     *
     * Dejarlo dejaría una ficha activa con un texto que dice por qué está
     * bloqueada: el siguiente que la abra se queda sin saber si lo está o no.
     * Lo que queda del episodio es la bitácora, que es donde se reconstruye el
     * pasado — y ahí quedan los dos movimientos con sus dos motivos.
     */
    await tenantUpdate(ctx.companyId, "customer", id, bloquear
      ? { status: VETADO, blocked_reason: motivo, blocked_at: new Date().toISOString(), blocked_by: ctx.userId }
      : { status: "active", blocked_reason: null, blocked_at: null, blocked_by: null });

    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: bloquear ? "customer_blacklisted" : "customer_unblacklisted",
      entityType: "customer",
      entityId: id,
      severity: "warning",
      description: bloquear
        ? `${nombre} entró en la lista negra: ${motivo}`
        : `${nombre} salió de la lista negra${motivo ? `: ${motivo}` : ""}`,
      metadata: { reason: motivo || null, previous: cliente.blocked_reason ?? null },
    });

    return ok({ blocked: bloquear, reason: bloquear ? motivo : null });
  } catch (err) {
    return fail(err);
  }
}
