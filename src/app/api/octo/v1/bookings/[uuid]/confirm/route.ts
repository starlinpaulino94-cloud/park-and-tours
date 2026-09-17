import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody, assertCanSell } from "@/lib/octo-http";
import { confirmBooking, OctoError } from "@/lib/octo-service";
import { isUuid } from "@/lib/octo";
import { writeAudit } from "@/lib/audit";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/**
 * POST /api/octo/v1/bookings/:uuid/confirm — la retención se convierte en venta.
 *
 * Es el momento en que la reserva deja de poder liberarse sola, así que es
 * también el momento en que la operación tiene que enterarse: sale en el
 * manifiesto, cuenta en el despacho y el cliente recibe su voucher.
 *
 * Confirmar dos veces no es un error: el revendedor reintenta y tiene que
 * recibir la misma reserva, no un rechazo que le haga abrir una incidencia.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "write");
    active = capabilities;
    assertCanSell(ctx);

    const { uuid } = await params;
    if (!isUuid(uuid)) throw new OctoError("INVALID_BOOKING_UUID", "El uuid no es válido.", { uuid });

    const body = await octoBody(req);
    const booking = await confirmBooking(ctx, uuid, {
      resellerReference: typeof body.resellerReference === "string" ? body.resellerReference : null,
      contact: body.contact ?? null,
    });

    await writeAudit({
      companyId: ctx.companyId,
      action: "octo_booking_confirmed",
      entityType: "booking",
      entityId: booking.id,
      description: `Reserva confirmada por un revendedor (OCTO): ${booking.supplierReference ?? booking.uuid}`,
      metadata: { key: ctx.keyId, partner: ctx.partnerId, uuid: booking.uuid },
    });

    // El voucher y el aviso al cliente salen ahora, no en el barrido diario: el
    // huésped puede estar viajando mañana por la mañana.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return octoJson(booking, capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
