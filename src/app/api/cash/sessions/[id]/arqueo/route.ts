import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadCashClose } from "@/lib/cash-service";
import { recalcCashSession } from "@/lib/cash";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/cash/sessions/:id/arqueo — lo que hay que contar y lo que ya se contó.
 *
 * Es la misma carga que usa el PDF, para que el papel que se archiva con el
 * efectivo y la pantalla donde se cuenta no puedan discrepar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "cash:arqueo", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    // Una sesión abierta se recalcula al abrir el arqueo: el cajero cuenta
    // contra lo que hay ahora, no contra lo que había en el último cobro.
    const payload = await loadCashClose(ctx.companyId, id);
    if (payload.session.status === "open") {
      await recalcCashSession(ctx.companyId, id);
      return ok(await loadCashClose(ctx.companyId, id));
    }
    return ok(payload);
  } catch (err) {
    return fail(err);
  }
}
