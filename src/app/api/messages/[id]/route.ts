import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { dispatchQueue, type MessageRow } from "@/lib/messaging/outbox";

/**
 * POST /api/messages/:id — reintenta o cancela un mensaje.
 *
 * Reintentar es la razón de que la bandeja exista: un correo que falló porque el
 * cliente no tenía dirección se arregla corrigiendo la ficha y volviendo a
 * pulsar, sin que nadie tenga que reconstruir el texto a mano.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "messages:action", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ action?: string; to_address?: string }>(req);
    const message = await tenantFindOne<MessageRow>(ctx.companyId, "message", id);

    if (body.action === "cancel") {
      if (message.status === "sent") {
        throw Object.assign(new Error("Ese mensaje ya salió: no se puede cancelar"), { status: 409 });
      }
      await tenantUpdate(ctx.companyId, "message", id, { status: "cancelled" });
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "message_cancelled", entityType: "message", entityId: id,
        description: `Mensaje ${message.template_key ?? ""} cancelado antes de salir`,
        severity: "warning",
      });
      return ok({ status: "cancelled" });
    }

    if (body.action !== "retry") {
      throw Object.assign(new Error("La acción solo puede ser reintentar o cancelar"), { status: 400 });
    }
    if (message.status === "sent") {
      throw Object.assign(new Error("Ese mensaje ya se entregó"), { status: 409 });
    }

    await tenantUpdate(ctx.companyId, "message", id, {
      status: "queued",
      scheduled_at: new Date().toISOString(),
      // El contador vuelve a cero: el reintento lo pide una persona que ya
      // corrigió el motivo del fallo, no es el quinto intento automático.
      attempts: 0,
      last_error: null,
      ...(body.to_address?.trim() ? { to_address: body.to_address.trim() } : {}),
    });

    const delivered = await dispatchQueue(ctx.company, ctx.companyId, 5);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "message_retried", entityType: "message", entityId: id,
      description: `Reintento de ${message.template_key ?? "mensaje"} hacia ${body.to_address || message.to_address}`,
    });

    return ok({ status: "queued", delivered });
  } catch (err) {
    return fail(err);
  }
}
