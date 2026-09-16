import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { voidInvoice } from "@/lib/invoice-service";

/**
 * POST /api/invoices/:id/void — anula emitiendo su nota de crédito.
 *
 * Un comprobante emitido no se borra: el cliente ya lo tiene y probablemente ya
 * está en su declaración, y borrarlo deja un hueco en la secuencia que hay que
 * justificar. Se anula con una nota de crédito que lo referencia, que es lo que
 * la DGII espera ver.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertModule(ctx, "accounting");
    assertRateLimit({ key: rateLimitKey(req, "invoices:void", ctx.userId), limit: 30, windowMs: 60_000 });
    // Anular consume otro número de la secuencia y deja rastro fiscal: es una
    // decisión de gestión, no del cajero que se equivocó.
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ reason?: string }>(req);
    const result = await voidInvoice(ctx, id, body.reason || "");
    return ok({ credit_note: result.creditNote._id, ncf: result.ncf });
  } catch (err) {
    return fail(err);
  }
}
