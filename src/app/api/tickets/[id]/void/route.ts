import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CLOSED_TICKET_STATUSES } from "@/lib/tickets";

/**
 * POST /api/tickets/:id/void — anula un pase emitido por error o perdido.
 *
 * Anular es la contrapartida de emitir, y la única salida legítima de un pase
 * que no se va a usar: deja el rastro de quién y por qué, en vez de editar el
 * estado desde el formulario. Un pase ya cerrado no se vuelve a anular.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "tickets:void", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ reason?: string }>(req);
    if (!body.reason?.trim()) {
      throw Object.assign(new Error("Anular un pase necesita un motivo"), { status: 400 });
    }

    const ticket = await tenantFindOne<{ _id: string; status?: string; code?: string; wristband_code?: string }>(
      ctx.companyId, "access_ticket", id
    );
    if (CLOSED_TICKET_STATUSES.has(ticket.status || "")) {
      throw Object.assign(new Error("Este pase ya está cerrado y no se puede anular"), { status: 409 });
    }

    await tenantUpdate(ctx.companyId, "access_ticket", id, { status: "void" });

    const label = ticket.code || ticket.wristband_code || id;
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "access_ticket_voided", entityType: "access_ticket", entityId: id,
      description: `Pase ${label} anulado: ${body.reason}`,
      severity: "warning",
      metadata: { previous_status: ticket.status },
    });

    return ok({ status: "void" });
  } catch (err) {
    return fail(err);
  }
}
