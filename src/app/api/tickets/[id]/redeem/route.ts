import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  applyRedemption, redeemBlocker, remainingEntries,
  BLOCK_MESSAGE, FORCEABLE_BLOCKS, type RedeemableTicket,
} from "@/lib/tickets";

interface AccessTicketRow extends RedeemableTicket {
  _id: string;
  code?: string;
  wristband_code?: string;
  holder_name?: string;
  ticket_type?: string;
}

/**
 * POST /api/tickets/:id/redeem — valida un pase en puerta y descuenta una entrada.
 *
 * `status`, `entries_used` y `redeemed_at` salieron del CRUD genérico: editarlos
 * a mano desde el formulario permitía revivir un pase ya redimido o poner el
 * contador a cero, que es rearmar una entrada ya usada. El mismo criterio que
 * con `voucher.status` (AUD-B02/B14) y `departure.status` (AUD-B02/B16).
 *
 * Un pase vencido puede forzarse con rango de gestión y motivo obligatorio, y
 * queda auditado como advertencia. Un pase anulado, transferido, agotado o que
 * todavía no empieza su vigencia NO se fuerza: ahí no hay excepción que valga.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "tickets:redeem", ctx.userId), limit: 240, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ force?: boolean; reason?: string; notes?: string }>(req);
    const ticket = await tenantFindOne<AccessTicketRow>(ctx.companyId, "access_ticket", id);
    const now = new Date();

    const blocker = redeemBlocker(ticket, now);
    if (blocker) {
      if (!body.force || !FORCEABLE_BLOCKS.has(blocker)) {
        throw Object.assign(new Error(BLOCK_MESSAGE[blocker]), { status: 409 });
      }
      // Forzar es una excepción de gestión, no un atajo del cajero.
      requireAtLeast(ctx, "manager");
      if (!body.reason?.trim()) {
        throw Object.assign(new Error("Forzar un pase vencido necesita un motivo"), { status: 400 });
      }
    }

    const result = applyRedemption(ticket, now);
    await tenantUpdate(ctx.companyId, "access_ticket", id, {
      status: result.status,
      entries_used: result.entries_used,
      ...(result.redeemed_at ? { redeemed_at: result.redeemed_at } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });

    const label = ticket.code || ticket.wristband_code || id;
    const left = result.remaining === null ? "ilimitadas" : String(result.remaining);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: blocker ? "access_ticket_redeemed_forced" : "access_ticket_redeemed",
      entityType: "access_ticket", entityId: id,
      description: `Pase ${label} validado (entradas restantes: ${left})${blocker ? ` — forzado: ${body.reason}` : ""}`,
      severity: blocker ? "warning" : "info",
      metadata: { entries_used: result.entries_used, remaining: result.remaining, forced_block: blocker || undefined },
    });

    return ok({
      status: result.status,
      entries_used: result.entries_used,
      remaining: result.remaining,
      forced: Boolean(blocker),
    });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/tickets/:id/redeem — estado de validación del pase, sin consumirlo. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "tickets:redeem:check", ctx.userId), limit: 240, windowMs: 60_000 });

    const ticket = await tenantFindOne<AccessTicketRow>(ctx.companyId, "access_ticket", id);
    const blocker = redeemBlocker(ticket, new Date());
    return ok({
      blocker,
      message: blocker ? BLOCK_MESSAGE[blocker] : null,
      forceable: blocker ? FORCEABLE_BLOCKS.has(blocker) : false,
      remaining: remainingEntries(ticket),
    });
  } catch (err) {
    return fail(err);
  }
}
