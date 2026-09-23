import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { assertSellerOwnsRow } from "@/lib/seller-scope";
import { notify } from "@/lib/notify-service";
import { usuarioDeVendedor } from "@/lib/seller-identity";
import { refId } from "@/lib/types";
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
    // Cancelar ANULA la comisión de quien vendió: sin esta guarda, un vendedor
    // podía borrarle el mes a un compañero con una sola llamada, y el rango
    // por sí solo no lo impide porque cancelar es trabajo de vendedor.
    assertSellerOwnsRow("booking", ctx, booking as unknown as Record<string, unknown>, "Esta reserva");

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

    /**
     * Y al vendedor, que acaba de perder la comisión de esa reserva.
     *
     * Sin este aviso se entera el día de la liquidación, cuando ya no es una
     * información sino una discusión. Va a la PERSONA y no a la audiencia de
     * rol —repartido por rol, cada vendedor recibiría las cancelaciones de sus
     * compañeros—, y solo cuando la cancelación le tocó de verdad el bolsillo.
     *
     * No se avisa a quien cancela de su propia cancelación: ya lo sabe, acaba
     * de hacerlo.
     */
    const vendedorDeLaReserva = refId(booking.seller as never);
    if (vendedorDeLaReserva && (result.commissionsVoided > 0 || result.commissionsAdjusted > 0)) {
      const userId = await usuarioDeVendedor(ctx.companyId, vendedorDeLaReserva);
      if (userId && userId !== ctx.userId) {
        await notify({
          companyId: ctx.companyId,
          userId,
          event: "booking_cancelled_for_seller",
          entityType: "booking",
          entityId: booking._id,
          vars: {
            referencia: booking.booking_number ?? "",
            monto: booking.total_amount ?? 0,
            moneda: booking.currency ?? "usd",
          },
        });
      }
    }

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
