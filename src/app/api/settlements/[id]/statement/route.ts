import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadSupplierStatement } from "@/lib/supplier-settlement-service";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/settlements/:id/statement — el estado de cuenta de la liquidación.
 *
 * Misma carga que el PDF que se le manda al proveedor, para que el papel con el
 * que discute y lo que el sistema va a pagar no puedan decir cosas distintas.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "settlements:statement", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");
    return ok(await loadSupplierStatement(ctx.companyId, id));
  } catch (err) {
    return fail(err);
  }
}
