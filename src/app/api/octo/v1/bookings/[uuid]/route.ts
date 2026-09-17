import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody } from "@/lib/octo-http";
import { getBooking, extendBooking, OctoError } from "@/lib/octo-service";
import { isUuid } from "@/lib/octo";

/** GET /api/octo/v1/bookings/:uuid — el estado de una reserva. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    active = capabilities;
    const { uuid } = await params;
    if (!isUuid(uuid)) throw new OctoError("INVALID_BOOKING_UUID", "El uuid no es válido.", { uuid });
    return octoJson(await getBooking(ctx, uuid), capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}

/**
 * PATCH /api/octo/v1/bookings/:uuid — modificar una reserva retenida.
 *
 * Lo único que se admite cambiar es el plazo de la retención. Cambiar producto,
 * fecha o viajeros con la plaza ya apartada sería una reserva distinta con el
 * cupo de la anterior: el camino correcto es cancelar y reservar de nuevo, que
 * pasa por las comprobaciones de capacidad y de cupo del socio.
 *
 * Se contesta con el código del estándar y con el motivo, para que el
 * revendedor sepa qué hacer en vez de reintentar lo mismo.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "write");
    active = capabilities;
    const { uuid } = await params;
    if (!isUuid(uuid)) throw new OctoError("INVALID_BOOKING_UUID", "El uuid no es válido.", { uuid });

    const body = await octoBody(req);
    const cambios = ["productId", "optionId", "availabilityId", "unitItems"].filter((k) => body[k] != null);
    if (cambios.length > 0) {
      throw new OctoError(
        "UNPROCESSABLE_ENTITY",
        `No se puede cambiar ${cambios.join(", ")} sobre una plaza ya apartada: cancela y vuelve a reservar.`,
        { uuid }
      );
    }

    const minutes = Number(body.expirationMinutes ?? NaN);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new OctoError("BAD_REQUEST", "Lo único modificable aquí es expirationMinutes.", { uuid });
    }
    return octoJson(await extendBooking(ctx, uuid, minutes), capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
