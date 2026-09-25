import "server-only";
import { requireAtLeast, tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { recalculateDeparture } from "@/lib/availability";
import { cancelBookingCosts } from "@/lib/supplier-settlement-service";
import { settleBookingStock } from "@/lib/stock-commitment-service";
import { releaseBookingAllotment } from "@/lib/allotment-service";
import { devolverAlMonedero, monedaDelMonederoDe } from "@/lib/monedero-service";
import { offerFreedSeats } from "@/lib/waitlist-service";
import { reverseForOrder } from "@/lib/membego-redemption-service";
import { syncOrderTotals } from "@/lib/booking-service";
import { settleCommissionsOnCancel } from "@/lib/commission-adjust-service";
import { postPayment } from "@/lib/ledger-events";
import { writeAudit } from "@/lib/audit";
import { notifyBookingCancelled } from "@/lib/messaging/events";
import { notify } from "@/lib/notify-service";
import { parseJson } from "@/lib/format";
import { BOOKING_TERMINAL_STATES, isTerminalBookingStatus } from "@/lib/types";
import type { Booking, CancellationPolicy, CancellationTier, Product } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * CANCELAR UNA RESERVA, PASE LO QUE PASE DESPUÉS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO VIVE EN LA RUTA
 *
 * Cancelar no es cambiar un estado: es aplicar la política de reembolso, soltar
 * la plaza de la salida, anular las comisiones, cancelar el devengo del
 * proveedor, liberar las existencias apartadas, devolver las plazas al cupo del
 * socio, cancelar las recogidas, invalidar el voucher, registrar el reembolso
 * en caja y en el libro, y avisar al cliente y al gerente. Trece cosas.
 *
 * Mientras esto vivió dentro de `POST /api/bookings/:id/cancel`, la única forma
 * de cancelar era que un humano pulsara el botón. En cuanto apareció el segundo
 * origen —una OTA cancelando por el conector OCTO— la alternativa era copiar
 * las trece o quedarse con una cancelación a medias: la reserva figuraría
 * cancelada y la plaza seguiría ocupada, la comisión seguiría devengada y el
 * cupo del socio seguiría gastado.
 *
 * Por eso vive aquí: una sola cancelación para todos los orígenes.
 *
 * Lo que NO está aquí, y es deliberado: la comprobación de origen, el límite de
 * peticiones y el rango que hace falta para forzar un reembolso distinto al de
 * la política. Eso es autorización de la petición y depende de quién llama, así
 * que lo decide cada ruta.
 */

export interface CancelOptions {
  /** Lo que se le dice al cliente y queda en la auditoría. */
  reason?: string | null;
  /**
   * Reembolso distinto al que manda la política. Decisión de gestión: la ruta
   * de mostrador exige rango de manager antes de pasarlo.
   */
  refundOverride?: number | null;
}

export interface CancelResult {
  refund: number;
  refundPct: number;
  policyName: string;
  commissionsVoided: number;
  /**
   * Comisiones YA PAGADAS cuya venta se cayó (0059): no se anulan, se ajustan.
   * `commissionClawback` es lo que hay que recuperar en la próxima liquidación
   * — quien cancela tiene que verlo, no enterarse un mes después.
   */
  commissionsAdjusted: number;
  commissionClawback: number;
  pickupsCancelled: number;
  supplierCostsCancelled: number;
}

/**
 * Los estados desde los que ya no se puede cancelar: cancelar dos veces
 * reembolsa dos veces. La lista vive en `types.ts` porque `syncOrderTotals`
 * necesita exactamente la misma, y tenerla escrita dos veces fue justo lo que
 * hizo que le reclamáramos el saldo a un cliente que había cancelado.
 */
export const TERMINAL_STATES: readonly string[] = BOOKING_TERMINAL_STATES;

export async function cancelBookingFully(
  ctx: TenantContext & { companyId: string },
  booking: Booking,
  options: CancelOptions = {}
): Promise<CancelResult> {
  const id = String(booking._id);

  /**
   * LA REGLA SE COMPRUEBA AQUÍ, QUE ES DONDE ESTÁ ESCRITA.
   *
   * `TERMINAL_STATES` declara justo arriba que cancelar dos veces reembolsa dos
   * veces, pero la comprobación vivía en cada llamador. Los dos de hoy —la ruta
   * de mostrador y el conector OCTO— la hacen. El tercero tendría que
   * acordarse, y este módulo existe precisamente para que quien llame no tenga
   * que acordarse de nada: su cabecera dice que hay UNA sola cancelación para
   * todos los orígenes.
   *
   * Si alguien se la salta, sale un segundo pago de reembolso por la misma
   * reserva, las plazas vuelven al cupo del socio por partida doble y el
   * cobrado de la orden se va en negativo. Se comprobó: el dinero salía dos
   * veces.
   *
   * Y dentro de esta misma función los COMPONENTES de un paquete ya estaban
   * protegidos (más abajo). La cabecera no.
   */
  if (isTerminalBookingStatus(booking.status)) {
    throw Object.assign(
      new Error("Esta reserva ya estaba cancelada; cancelarla otra vez devolvería el dinero dos veces"),
      { status: 409, code: "ALREADY_CANCELLED" }
    );
  }

  // ---- refund according to the applicable policy ------------------------
  const product = typeof booking.product === "object" ? (booking.product as Product) : null;
  const policyId = refId(product?.cancellation_policy);
  let refundPct = 0;
  let policyName = "Sin política definida";

  if (policyId) {
    const policy = (await tenantQuery<CancellationPolicy>(ctx.companyId, "cancellation_policy", {
      _filter: { _id: policyId }, _limit: 1,
    }))[0];
    if (policy) {
      policyName = policy.name || policyName;
      const tiers = parseJson<CancellationTier[]>(policy.tiers, []);
      const travel = booking.travel_date ? new Date(booking.travel_date) : null;
      const hoursBefore = travel ? (travel.getTime() - Date.now()) / 3_600_000 : Number.POSITIVE_INFINITY;
      const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);
      for (const tier of sorted) {
        if (hoursBefore >= tier.hours_before) { refundPct = tier.refund_pct; break; }
      }
    }
  }

  const total = booking.total_amount ?? 0;
  const paid = booking.paid_amount ?? 0;
  const policyRefund = Math.round(((total * refundPct) / 100 + Number.EPSILON) * 100) / 100;
  const refund = options.refundOverride != null
    ? Math.max(0, Math.min(options.refundOverride, paid))
    : Math.min(policyRefund, paid);

  // Se comprueba aquí y no en la ruta a propósito: ahora que la cancelación es
  // llamable desde varios orígenes, un reembolso distinto al de la política
  // tiene que exigir rango de gestión venga de donde venga.
  if (options.refundOverride != null) requireAtLeast(ctx, "manager");

  await tenantUpdate(ctx.companyId, "booking", id, {
    status: refund > 0 ? (refund >= paid ? "refunded" : "partially_refunded") : "cancelled",
    cancelled_at: new Date().toISOString(),
    cancel_reason: options.reason || "Cancelada por el usuario",
    refund_amount: refund,
    balance_amount: 0,
  });

  // ---- recogidas ---------------------------------------------------------
  // La recogida de una reserva cancelada seguía en «pendiente» y en su ruta:
  // el conductor pasaba igual por el hotel a buscar a alguien que canceló, y
  // el cupo del vehículo seguía contándolo. Nadie lo notaba hasta el lobby.
  const pickupsToCancel = await tenantQuery<{ _id: string }>(ctx.companyId, "pickup", {
    // Los estados reales de `pickup` (0011): pendiente, confirmada, recogida,
    // no-show y cancelada. Una ya recogida no se toca: eso ya ocurrió.
    _filter: { booking: id, status: { nin: ["cancelled", "picked_up"] } }, _limit: 20,
  });
  for (const pickup of pickupsToCancel) {
    await tenantUpdate(ctx.companyId, "pickup", pickup._id, { status: "cancelled", route: null });
  }

  /**
   * CANCELAR UN PAQUETE CANCELA SUS ACTIVIDADES (0061).
   *
   * Sin esto, cancelar la cabecera dejaría tres reservas vivas ocupando plazas
   * en tres salidas, con importe cero y sin nadie que las reclame: el
   * manifiesto del autobús llevaría a cuatro personas que no van a subir.
   *
   * Se hace ANTES de tocar la cabecera para que cada componente libere su cupo
   * por el mismo camino que cualquier otra reserva — el que ya sabe devolver
   * plazas a su cupo de socio y soltar sus existencias.
   */
  const components = await tenantQuery<Booking>(ctx.companyId, "booking", {
    _filter: { bundle_booking: id }, _limit: 50,
  });
  for (const component of components) {
    if (isTerminalBookingStatus(component.status)) continue;
    /**
     * Sin `refundOverride`, y no por descuido.
     *
     * Un componente vale cero, así que el prorrateo de los pagos le asigna cero
     * cobrado y la política le calcula un reembolso de cero por su cuenta.
     * Forzarlo a cero a mano tendría además un efecto que no se ve: la ruta
     * exige rango de gerencia para cualquier reembolso forzado, y un vendedor
     * cancelando su propio paquete se encontraría con un «no tienes permiso»
     * que no viene de ninguna decisión suya.
     */
    await cancelBookingFully(ctx, component, {
      ...options,
      reason: `Paquete ${booking.booking_number ?? id} cancelado`,
    });
  }

  // ---- las comisiones (0059) --------------------------------------------
  //
  // Antes esto anulaba las `pending` y `approved` y NO TOCABA las `settled` ni
  // las `paid`. O sea: el dinero había salido, la venta se caía, y no quedaba
  // ni rastro de que hubiera que recuperarlo — la liquidación del mes siguiente
  // cuadraba con una venta que ya no existe.
  //
  // Ahora una comisión cuyo dinero salió se AJUSTA en negativo y conserva su
  // estado: sigue diciendo que se pagó, porque se pagó, y el ajuste dice que se
  // descontó. Las dos cifras a la vista.
  const commissionOutcome = await settleCommissionsOnCancel(
    ctx, id, String(booking.booking_number ?? id)
  );

  // ---- cancelar el devengo del proveedor (0040) --------------------------
  // Una reserva cancelada no le debe nada al transportista ni al restaurante.
  // Un servicio YA liquidado no se toca: ese dinero salió, y lo que procede
  // entonces es un ajuste en la liquidación, no borrar el devengo.
  const cancelledCosts = await cancelBookingCosts(
    ctx.companyId, id, `Reserva ${booking.booking_number ?? id} cancelada`
  );

  // ---- soltar las existencias apartadas (0052) --------------------------
  // Los almuerzos que esta reserva tenía apartados vuelven a estar
  // disponibles. No sale movimiento: nunca salieron del almacén.
  //
  // Si ya se habían CONSUMIDO —la reserva se canceló después del embarque—
  // no se liberan: esas unidades salieron de verdad, y volver a sumarlas sin
  // rastro descuadraría el almacén. `settleBookingStock` lo distingue y lo
  // devuelve como problema para que quede en el log.
  try {
    const almacen = await settleBookingStock(ctx.companyId, id, "release", ctx.userId);
    for (const problema of almacen.problems) console.warn(`[cancel] almacén: ${problema}`);
  } catch (err) {
    console.error("[cancel] no se pudieron liberar las existencias apartadas:", err);
  }

  // ---- devolver el beneficio de MembeGo (0057) --------------------------
  // Si esta venta llevaba un beneficio canjeado, el cliente tiene que
  // recuperarlo: perdió un uso por una venta que no llegó a existir.
  //
  // Nunca tumba la cancelación. Que MembeGo no conteste no puede dejar la
  // reserva a medio cancelar —con la plaza ocupada y el cliente avisado de
  // nada—, así que el fallo queda en la auditoría para resolverlo a mano.
  const ordenDeLaReserva = refId(booking.order);
  if (ordenDeLaReserva) {
    try {
      // Con el identificador de ESTA reserva: la orden puede llevar tres
      // excursiones y solo se cae una. Sin él, cancelar la del jueves devolvía
      // el beneficio aplicado a la del sábado, que sigue en pie.
      const devoluciones = await reverseForOrder(
        ctx.companyId, ordenDeLaReserva,
        options.reason || "Reserva cancelada", ctx.userId, id
      );
      for (const devolucion of devoluciones) {
        if (!devolucion.reversed) console.warn(`[cancel] beneficio MembeGo: ${devolucion.message}`);
      }
    } catch (err) {
      console.error("[cancel] no se pudo devolver el beneficio de MembeGo:", err);
    }
  }

  // ---- devolver las plazas al cupo del socio (0054) ---------------------
  // A SU cupo y por SUS plazas, las que la reserva guardó: si el contrato
  // cambió de temporada entre la venta y la cancelación, devolverlas al cupo
  // vigente le regalaría plazas a la temporada nueva.
  const plazasDevueltas = await releaseBookingAllotment(
    ctx.companyId, booking as { allotment?: unknown; allotment_seats?: number | null }
  );
  if (plazasDevueltas > 0) {
    console.log(`[cancel] ${plazasDevueltas} plazas devueltas al cupo del socio`);
  }

  // ---- invalidate vouchers ----------------------------------------------
  const vouchers = await tenantQuery<{ _id: string }>(ctx.companyId, "voucher", {
    _filter: { booking: id, status: "valid" }, _limit: 10,
  });
  for (const v of vouchers) {
    await tenantUpdate(ctx.companyId, "voucher", v._id, { status: "cancelled" });
  }

  // ---- release the seat --------------------------------------------------
  const departureId = refId(booking.departure);
  if (departureId) await recalculateDeparture(ctx.companyId, departureId);

  /**
   * LA PLAZA QUE SE ACABA DE SOLTAR LE TOCA AL SIGUIENTE DE LA COLA (0066).
   *
   * Aquí y no en un reloj nocturno. Es la misma lección que ya estaba escrita
   * para el cupo de las OTA: lo que importa no es barrer, es reaccionar al
   * hecho. Una plaza que se libera el sábado por la mañana para una excursión
   * del domingo no puede esperar al cron de las tres de la madrugada.
   *
   * Dentro de un intento y sin relanzar, como los avisos: que la lista de
   * espera falle no puede dejar a medias una cancelación que el cliente ya
   * tiene confirmada y cuyo dinero ya se devolvió.
   */
  if (departureId) {
    try {
      const oferta = await offerFreedSeats(ctx, departureId);
      for (const problema of oferta.problems) console.warn(`[cancel] lista de espera: ${problema}`);
    } catch (err) {
      console.error("[cancel] no se pudo ofrecer la plaza a la lista de espera:", err);
    }
  }

  const orderId = refId(booking.order);

  // ---- refund payment record --------------------------------------------
  // AUD (over-refund): the refund payment must be created BEFORE syncOrderTotals
  // so the order's paid_total reflects it. Otherwise the order kept a stale
  // paid_total and a second refund could pass the payments API's cap.
  if (refund > 0) {
    const refundPayment = await tenantCreate<{ _id?: string }>(ctx.companyId, "payment", {
      order: orderId,
      booking: id,
      customer: refId(booking.customer),
      user: ctx.userId,
      reference: `REF-${booking.booking_number}`,
      payment_type: "refund",
      method: "cash",
      status: "completed",
      amount: refund,
      currency: booking.currency || "usd",
      paid_at: new Date().toISOString(),
      notes: `Reembolso por cancelación (${policyName}, ${refundPct}%)`,
    });
    // Double-entry ledger (AUD-F15), best-effort.
    const refundPaymentId = refundPayment._id;
    if (refundPaymentId) {
      await postPayment(ctx.companyId, {
        paymentId: refundPaymentId,
        orderId,
        amount: refund,
        method: "cash",
        currency: booking.currency || "usd",
        isRefund: true,
        userId: ctx.userId,
      });
    }
  }

  // Now recompute the order totals — after the refund exists, so paid_total
  // and balance account for it.
  if (orderId) await syncOrderTotals(ctx.companyId, orderId);

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId,
    action: "booking_cancelled", entityType: "booking", entityId: id,
    description: `Reserva ${booking.booking_number} cancelada. Reembolso ${refund} (${refundPct}% — ${policyName})`,
    severity: "warning",
    metadata: { refund, refundPct, policyName, reason: options.reason, supplier_costs_cancelled: cancelledCosts },
  });

  // El cliente tiene que saberlo antes de presentarse en el lobby.
  try {
    await notifyBookingCancelled(
      ctx.company, ctx.companyId, booking,
      options.reason || "Cancelada por la agencia", ctx.userId
    );
  } catch (err) {
    console.error("[cancel] no se pudo encolar el aviso de cancelación:", err);
  }

  // El aviso interno: una cancelación libera cupo y casi siempre mueve
  // dinero, así que el gerente se entera sin tener que entrar a mirar.
  await notify({
    companyId: ctx.companyId,
    event: "booking_cancelled",
    entityType: "booking",
    entityId: booking._id,
    vars: {
      referencia: booking.booking_number,
      motivo: options.reason || null,
    },
  });

  /**
   * Y al tour center, si la venta era suya.
   *
   * Es el aviso que más le cuesta no tener: la reserva desaparece de su portal
   * y él no sabe por qué, mientras el turista sí que se ha enterado —al cliente
   * se le avisa desde siempre—. El socio quedaba como el último en saberlo de
   * una venta que hizo él.
   */
  const [ordenDeLaVenta] = orderId
    ? await tenantQuery<{ partner?: unknown }>(ctx.companyId, "order", { _filter: { _id: orderId }, _limit: 1 })
    : [];
  const socioDeLaVenta = refId(ordenDeLaVenta?.partner as never);

  /**
   * ---- devolver al monedero prepago lo que esta reserva gastó (0080) -----
   *
   * Por el importe de ESTA reserva, no por el total de la orden: cancelar una
   * de tres no devuelve las tres.
   *
   * Y solo si aquella venta llegó a descontar. Se mira el libro —¿hay un
   * consumo de esta orden?— en vez de fiarse del modo de pago de HOY: un socio
   * que pasó de prepago a crédito entre la venta y la cancelación recibiría un
   * abono por una venta que nunca le descontó, o al revés, se quedaría sin su
   * devolución. Lo que manda es lo que pasó, no lo que se pacta ahora.
   */
  if (socioDeLaVenta && orderId) {
    const consumos = await tenantQuery<{ currency?: string | null }>(
      ctx.companyId, "partner_wallet_movement",
      { _filter: { order_id: orderId, movement_type: "consumption" }, _limit: 1 }
    );
    const consumo = consumos[0];
    if (consumo) {
      await devolverAlMonedero(
        ctx.companyId,
        {
          partnerId: socioDeLaVenta,
          tipo: "refund",
          // Lo que esta reserva costó, no lo que se le reembolsa al cliente:
          // la penalización de cancelación es cosa del cliente, y descontarla
          // aquí le cobraría al socio una penalización dos veces.
          importe: Number(booking.total_amount ?? 0),
          moneda: consumo.currency || booking.currency || "usd",
          orderId,
          bookingId: id,
          nota: `Cancelación de ${booking.booking_number}`,
          userId: ctx.userId,
        },
        /**
         * La moneda DEL MONEDERO. Antes se pasaba la del propio consumo, así que
         * la comprobación se comparaba consigo misma y una fila vieja en la
         * moneda equivocada engendraba su devolución igual de equivocada.
         *
         * Si no coinciden, `apuntarMovimiento` la rechaza y `devolverAlMonedero`
         * lo deja dicho en la consola sin tumbar la cancelación: escribir otra
         * fila torcida empeoraría el descuadre, y la operadora puede reponer ese
         * saldo a mano por la pantalla de recargas, que sí usa la moneda buena.
         */
        (await monedaDelMonederoDe(ctx.companyId, socioDeLaVenta))
          ?? consumo.currency
          ?? booking.currency
          ?? "usd"
      );
    }
  }

  if (socioDeLaVenta) {
    await notify({
      companyId: ctx.companyId,
      partnerId: socioDeLaVenta,
      event: "partner_booking_cancelled",
      entityType: "booking",
      entityId: booking._id,
      vars: {
        referencia: booking.booking_number,
        motivo: options.reason || null,
      },
    });
  }

  console.log(`[cancel] reserva ${booking.booking_number} cancelada · reembolso ${refund}`);
  // La cancelación ya está registrada y la plaza liberada. El aviso al cliente
  // sale ahora: tiene que saberlo antes de presentarse en el lobby, y el
  // barrido diario podría llegar después de la hora de recogida.

  return {
    refund,
    refundPct,
    policyName,
    commissionsVoided: commissionOutcome.voided,
    commissionsAdjusted: commissionOutcome.adjusted,
    commissionClawback: commissionOutcome.clawback,
    pickupsCancelled: pickupsToCancel.length,
    supplierCostsCancelled: cancelledCosts,
  };
}
