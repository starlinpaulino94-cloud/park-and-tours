import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody, assertCanSell } from "@/lib/octo-http";
import { listBookings, reserve, OctoError } from "@/lib/octo-service";
import { readReservation, octoErrorBody, OCTO_ERROR_STATUS } from "@/lib/octo";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";

/**
 * GET /api/octo/v1/bookings — buscar por referencia.
 *
 * Es el endpoint de la conciliación: la OTA manda su número de pedido y quiere
 * saber si aquí existe. Sin él, la única forma de resolver un «esta reserva no
 * aparece» es que alguien la busque a mano.
 */
export async function GET(req: NextRequest) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    active = capabilities;
    const url = new URL(req.url);
    const data = await listBookings(ctx, {
      resellerReference: url.searchParams.get("resellerReference"),
      supplierReference: url.searchParams.get("supplierReference"),
    });
    return octoJson(data, capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}

/**
 * POST /api/octo/v1/bookings — RESERVAR: retener la plaza sin cobrar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE EL REVENDEDOR NO DECIDE
 *
 * El precio, el cupo, la moneda y la empresa. Se aceptan los datos que solo él
 * conoce —quién viaja, cuántos, qué día— y todo lo que tiene valor económico lo
 * calcula el servidor con el mismo motor que el mostrador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA IDEMPOTENCIA VA POR EL UUID DEL ESTÁNDAR
 *
 * Aquí no hace falta cabecera `Idempotency-Key` como en `/api/v1/bookings`: el
 * propio estándar define que el `uuid` de la reserva lo pone el revendedor y
 * que repetirlo devuelve la misma reserva. El reintento se resuelve ANTES de
 * escribir nada, que es lo que impide que una conexión caída a medio camino
 * aparte las mismas tres plazas dos veces.
 */
export async function POST(req: NextRequest) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "write");
    active = capabilities;
    assertCanSell(ctx);

    const parsed = readReservation(await octoBody(req));
    if (parsed.ok === false) {
      return Response.json(
        octoErrorBody(parsed.problem.code, parsed.problem.message, parsed.problem.pointer),
        { status: OCTO_ERROR_STATUS[parsed.problem.code], headers: { "Octo-Capabilities": capabilities.join(", ") } }
      );
    }

    const { booking, repeated } = await reserve(ctx, parsed.input);

    // Un reintento no vuelve a auditar ni a avisar: el gerente recibiría tres
    // notificaciones de la misma reserva y dejaría de mirarlas.
    if (!repeated) {
      await writeAudit({
        companyId: ctx.companyId,
        action: "octo_booking_reserved",
        entityType: "booking",
        entityId: booking.id,
        description: `Reserva retenida por un revendedor (OCTO): ${booking.supplierReference ?? booking.uuid}`,
        metadata: {
          key: ctx.keyId, partner: ctx.partnerId, uuid: booking.uuid,
          reseller_reference: booking.resellerReference, expires_at: booking.utcExpiresAt,
        },
      });

      await notify({
        companyId: ctx.companyId,
        event: "booking_created",
        entityType: "booking",
        entityId: booking.id,
        dedupeSeed: booking.uuid,
        vars: {
          referencia: booking.supplierReference,
          producto: booking.productId,
          fecha: booking.availability?.localDateTimeStart ?? null,
          pax: booking.unitItems.length,
          cliente: `${booking.contact.fullName ?? "Cliente"} (OTA)`,
        },
      });
    }

    return octoJson(booking, capabilities, repeated ? 200 : 201);
  } catch (err) {
    return octoFail(err, active);
  }
}

void OctoError;
