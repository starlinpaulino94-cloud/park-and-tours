import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { cancelBookingFully, TERMINAL_STATES } from "@/lib/booking-cancel-service";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Booking } from "@/lib/types";

/**
 * POST /api/bookings/:id/cancel
 *
 * La cancelación de mostrador. Todo lo que hay que hacer al cancelar —la
 * política de reembolso, la plaza, las comisiones, el devengo del proveedor,
 * las existencias, el cupo del socio, las recogidas, el voucher, el asiento
 * contable y los avisos— vive en `booking-cancel-service`, porque desde el
 * conector OCTO también se cancela y una cancelación a medias sería peor que
 * ninguna: la reserva figuraría cancelada con la plaza todavía ocupada.
 *
 * Aquí queda lo que SÍ es de esta ruta: que la petición venga de nuestra propia
 * página, el límite por usuario y el rango mínimo para cancelar.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "bookings:cancel", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ reason?: string; refund_override?: number }>(req);
    const booking = await tenantFindOne<Booking>(ctx.companyId, "booking", id, { product: true, departure: true });

    // AUD-B03: se bloquean TODOS los estados terminales, no solo "cancelled".
    // Un primer reembolso deja la reserva en "refunded"/"partially_refunded",
    // que antes pasaba esta guarda y dejaba emitir un SEGUNDO reembolso. Un
    // doble clic en el diálogo de cancelar daba exactamente en ese fallo.
    if (booking.status && TERMINAL_STATES.includes(booking.status)) {
      throw Object.assign(
        new Error("La reserva ya fue cancelada o reembolsada"),
        { status: 409 }
      );
    }

    const result = await cancelBookingFully(ctx, booking, {
      reason: body.reason,
      refundOverride: body.refund_override,
    });

    // El aviso al cliente sale ahora: tiene que saberlo antes de presentarse en
    // el lobby, y el barrido diario podría llegar después de la hora de recogida.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok({
      cancelled: true,
      refund: result.refund,
      refund_pct: result.refundPct,
      policy: result.policyName,
      commissions_voided: result.commissionsVoided,
      // 0059 — las que YA SE PAGARON no se anulan: se ajustan en negativo, y
      // quien cancela tiene que ver cuánto hay que recuperar. Enterarse un mes
      // después, en la liquidación, es enterarse tarde.
      commissions_adjusted: result.commissionsAdjusted,
      commission_clawback: result.commissionClawback,
      pickups_cancelled: result.pickupsCancelled,
    });
  } catch (err) {
    return fail(err);
  }
}
