import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeSocio, esAdminDeSocio } from "@/lib/tenant";
import { exigeRangoDeCaja, noPuedeAbrirLaCaja } from "@/lib/caja-identidad";
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

    const payload = await loadCashClose(ctx.companyId, id);

    /**
     * El arqueo de un turno lo mira su dueño (0081).
     *
     * `loadCashClose` acota los movimientos por sesión, así que el arqueo sale
     * limpio; lo que faltaba es que no lo abra cualquiera. Con la caja externa
     * eso sería enseñarle a la operadora cuánto efectivo movió un tour center
     * en su mostrador, y al tour center el de la casa.
     */
    const sesion = payload.session as Record<string, unknown>;
    const actorDeCaja = {
      esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId,
      sellerId: ctx.sellerId, esAdminDeSocio: esAdminDeSocio(ctx),
    };
    /**
     * El rango de siempre, SALVO que la caja sea suya (0083).
     *
     * Las rutas de caja pedían `cashier` y un `seller` está por debajo: el
     * promotor de playa —la persona entera para la que existe el modo «retiene
     * su comisión»— no podía abrir un turno, y sin turno no hay dónde apuntar
     * lo que se queda ni con qué cuadrar al final del día.
     */
    if (exigeRangoDeCaja(sesion, actorDeCaja)) requireAtLeast(ctx, "cashier");

    const impedimento = noPuedeAbrirLaCaja({ ...sesion, status: "active" }, actorDeCaja);
    if (impedimento) throw new TenantError(impedimento, 403);

    // Una sesión abierta se recalcula al abrir el arqueo: el cajero cuenta
    // contra lo que hay ahora, no contra lo que había en el último cobro.
    if (payload.session.status === "open") {
      await recalcCashSession(ctx.companyId, id);
      return ok(await loadCashClose(ctx.companyId, id));
    }
    return ok(payload);
  } catch (err) {
    return fail(err);
  }
}
