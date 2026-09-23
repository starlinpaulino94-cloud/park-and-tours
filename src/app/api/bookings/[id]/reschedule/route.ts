import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { assertSellerOwnsRow } from "@/lib/seller-scope";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recalculateDeparture } from "@/lib/availability";
import {
  rescheduleBlocker, reschedulePatch, isForceable,
  RESCHEDULE_BLOCK_MESSAGE, DEFAULT_CUTOFF_HOURS,
} from "@/lib/reschedule";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { notifyBookingRescheduled } from "@/lib/messaging/events";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";
import type { Booking, Departure } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * POST /api/bookings/:id/reschedule — mover una reserva de fecha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO REEMPLAZA
 *
 * Hasta ahora cambiar la fecha solo se podía haciendo cancelar + vender otra
 * vez. Eso anula el voucher que el cliente tiene en la mano, regenera las
 * comisiones con el precio de hoy en vez del que se vendió, le manda un aviso de
 * CANCELACIÓN a quien no canceló nada y deja dos reservas sin relación entre sí.
 * En una operadora esto pasa todas las semanas —llueve, le mueven el vuelo—, y
 * cuando la única salida es tan mala, el cambio se acaba arreglando por WhatsApp
 * y el manifiesto del día miente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE MUEVE Y QUÉ NO
 *
 *  · SE MUEVE la plaza: la reserva apunta a la salida nueva y las dos salidas
 *    recalculan su ocupación. Sin recalcular las DOS, la de origen se queda con
 *    el cupo tomado y se vende de menos el resto del mes.
 *  · SE SUELTA la ruta de recogida: apuntaba a una ruta del día anterior, así
 *    que en la lista del conductor de mañana seguiría apareciendo este cliente.
 *  · NO SE TOCAN las comisiones ni el precio: es la MISMA venta. Regenerarlas
 *    cambiaría lo que cobra el vendedor por una venta que ya hizo.
 *  · NO CAMBIA el número de reserva ni el código del voucher. El documento se
 *    imprime con la fecha nueva; cambiar el código solo conseguiría invalidar el
 *    papel que el cliente ya tiene.
 *
 * Las reglas de si se puede o no están en `reschedule.ts`, que es puro: lo
 * imposible (otro producto, sin cupo, fecha pasada) no lo levanta ningún rol, y
 * lo de política (el plazo de cambios y el número de veces) lo levanta un
 * gerente dejando rastro.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "bookings:reschedule", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ departure_id?: string; reason?: string; force?: boolean; notify?: boolean }>(req);
    const targetId = (body.departure_id || "").trim();
    if (!targetId) throw new TenantError("Elige la salida a la que se mueve", 400);
    // El motivo no es burocracia: es lo único que permite ver después si se mueve
    // por el clima, por el proveedor o por un vendedor que vendió mal.
    const reason = (body.reason || "").trim();
    if (!reason) throw new TenantError("Indica por qué se reprograma", 400);

    const booking = await tenantFindOne<Booking>(ctx.companyId, "booking", id, { product: true, departure: true });
    if (!booking) throw new TenantError("La reserva no existe", 404);
    // La misma guarda que en cancelar: mover la salida de la reserva de un
    // compañero le cambia el manifiesto, la recogida y el voucher que su
    // cliente tiene en la mano.
    assertSellerOwnsRow("booking", ctx, booking as unknown as Record<string, unknown>, "Esta reserva");

    const target = await tenantFindOne<Departure>(ctx.companyId, "departure", targetId);
    if (!target) throw new TenantError("La salida elegida no existe", 404);

    // La ocupación de la salida destino, recalculada ahora mismo: decidir con
    // los contadores guardados aceptaría una reserva en una salida que se llenó
    // hace un minuto.
    const targetState = await recalculateDeparture(ctx.companyId, targetId);
    const originId = refId(booking.departure as never);

    const originCutoff = typeof booking.departure === "object" && booking.departure
      ? (booking.departure as Departure).cutoff_hours
      : null;

    const blocker = rescheduleBlocker(
      {
        status: booking.status,
        checkin_status: booking.checkin_status,
        travel_date: booking.travel_date,
        pax_total: booking.pax_total,
        reschedule_count: (booking as { reschedule_count?: number }).reschedule_count,
        productId: refId(booking.product as never),
        departureId: originId,
      },
      {
        id: targetId,
        productId: refId(target.product as never),
        departure_at: target.departure_at,
        status: targetState.status,
        // Sin cupo declarado no hay techo que comprobar.
        availableSeats: targetState.capacity > 0 ? targetState.availablePax : null,
      },
      new Date(),
      originCutoff ?? DEFAULT_CUTOFF_HOURS
    );

    const forced = Boolean(blocker && body.force && isForceable(blocker));
    if (blocker && !forced) {
      // El motivo viaja en `code`, que es lo que el sobre de error conserva
      // (`serializeError` solo lleva mensaje, código y detalles). Con él, la
      // pantalla sabe —usando la misma lista pura— si ofrecer «forzar».
      throw Object.assign(new Error(RESCHEDULE_BLOCK_MESSAGE[blocker]), {
        status: 409,
        code: blocker,
      });
    }
    // Levantar un límite de política es una decisión de gestión, no del
    // vendedor que quiere contentar al cliente que tiene delante.
    if (forced) requireAtLeast(ctx, "manager");

    const patch = reschedulePatch(
      {
        reschedule_count: (booking as { reschedule_count?: number }).reschedule_count,
        departureId: originId,
      },
      { id: targetId, departure_at: target.departure_at },
      reason
    );
    await tenantUpdate(ctx.companyId, "booking", id, patch);

    // Las DOS salidas: la de origen suelta la plaza y la de destino la toma.
    if (originId && originId !== targetId) {
      await recalculateDeparture(ctx.companyId, originId).catch((err) =>
        console.error("[reschedule] no se pudo recalcular la salida de origen:", err)
      );
    }
    await recalculateDeparture(ctx.companyId, targetId).catch((err) =>
      console.error("[reschedule] no se pudo recalcular la salida destino:", err)
    );

    // La recogida se suelta de su ruta: esa ruta es del día anterior, y dejarla
    // puesta mantiene al cliente en la lista del conductor de mañana.
    const pickups = await tenantQuery<{ _id: string; route?: unknown }>(ctx.companyId, "pickup", {
      _filter: { booking: id }, _limit: 20,
    });
    for (const pickup of pickups) {
      await tenantUpdate(ctx.companyId, "pickup", pickup._id, { route: null, status: "pending" });
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "booking_rescheduled",
      entityType: "booking", entityId: id,
      description:
        `Reserva ${booking.booking_number} movida al ${String(target.departure_at || "").slice(0, 10)}` +
        ` — ${reason}` + (forced ? ` (forzada: ${blocker})` : ""),
      severity: forced ? "warning" : "info",
      metadata: {
        from: originId, to: targetId, reason,
        forced_block: forced ? blocker : undefined,
        reschedule_count: patch.reschedule_count,
        pickups_released: pickups.length,
      },
    });

    await notify({
      companyId: ctx.companyId,
      event: "booking_rescheduled",
      entityType: "booking",
      entityId: id,
      // La fecha en la semilla: mover la misma reserva dos veces son dos avisos,
      // porque son dos hechos distintos que operaciones tiene que ver.
      dedupeSeed: String(target.departure_at || "").slice(0, 10),
      vars: {
        referencia: booking.booking_number,
        fecha: String(target.departure_at || "").slice(0, 10),
        motivo: reason,
      },
    });

    // Y al cliente, salvo que se pida lo contrario: quien no se entera de que su
    // excursión se movió se presenta en el lobby el día que no es.
    if (body.notify !== false) {
      try {
        await notifyBookingRescheduled(ctx.company, ctx.companyId, booking, {
          departure: target,
          reason,
          userId: ctx.userId,
        });
      } catch (err) {
        console.error("[reschedule] no se pudo encolar el aviso al cliente:", err);
      }
    }

    console.log(`[reschedule] reserva ${booking.booking_number} · ${originId} → ${targetId}`);
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok({
      rescheduled: true,
      departure: targetId,
      travel_date: target.departure_at,
      reschedule_count: patch.reschedule_count,
      forced,
      pickups_released: pickups.length,
    });
  } catch (err) {
    return fail(err);
  }
}
