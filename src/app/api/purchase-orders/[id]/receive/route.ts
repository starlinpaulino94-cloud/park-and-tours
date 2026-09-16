import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { receivePurchaseOrder, purchaseOrderState } from "@/lib/purchasing-service";
import type { ReceiptRequestLine } from "@/lib/purchasing";

/**
 * Recibir mercancía contra una orden de compra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO ES LO QUE FALTABA ENTRE COMPRAR Y TENER
 *
 * La orden de compra existe desde 0013 y recibirla no movía una sola unidad:
 * se marcaba como recibida a mano y después alguien registraba un ajuste de
 * inventario a ojo. Lo comprado y lo que hay en el estante nacían separados, y
 * la diferencia solo aparecía en el conteo físico de fin de mes.
 *
 * GET devuelve el estado —qué falta por llegar de cada línea— y POST registra
 * una recepción, que puede ser parcial: una orden que llega en tres camiones
 * son tres recepciones contra la misma orden.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Lectura: `requireTenant`, no `requireTenantWrite`. Una suscripción vencida
    // bloquea registrar la entrada, nunca consultar qué falta por llegar.
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "po:state", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const state = await purchaseOrderState(ctx.companyId, id);
    return ok({
      status: state.order.status,
      code: state.order.code,
      currency: state.order.currency,
      warehouse: state.order.warehouse,
      supplier: state.order.supplier,
      receiptCount: state.order.receipt_count ?? 0,
      lines: state.states,
      pending: state.pending,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "po:receive", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");
    assertModule(ctx, "operations");

    const body = await readJson<{
      lines?: ReceiptRequestLine[];
      allow_over?: boolean;
      warehouse?: string;
      reference?: string;
    }>(req);

    const result = await receivePurchaseOrder(
      ctx.companyId, ctx.userId, id,
      Array.isArray(body.lines) ? body.lines.slice(0, 500) : [],
      { allowOver: body.allow_over === true, warehouse: body.warehouse ?? null, reference: body.reference ?? null }
    );

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "purchase_order_received", entityType: "purchase_order", entityId: id,
      description:
        `Recepción de ${result.received.length} líneas por ${result.totalCost}; la orden queda ${result.status}` +
        (body.allow_over ? " (con exceso confirmado)" : ""),
      severity: body.allow_over ? "warning" : "info",
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
