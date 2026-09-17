import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody } from "@/lib/octo-http";
import { extendBooking, OctoError } from "@/lib/octo-service";
import { isUuid, DEFAULT_HOLD_MINUTES } from "@/lib/octo";

/**
 * POST /api/octo/v1/bookings/:uuid/extend — prorrogar la retención.
 *
 * Existe porque el revendedor la necesita —el cliente está pagando con tarjeta
 * y el cobro tarda— y porque sin ella la alternativa es cancelar y volver a
 * reservar, que suelta la plaza en medio y puede perderla con el cliente
 * delante.
 *
 * El plazo se recorta al máximo que la operadora acepta: lo pedido no manda,
 * porque el estándar permite pedir una semana y eso sería regalar el
 * inventario.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "write");
    active = capabilities;
    const { uuid } = await params;
    if (!isUuid(uuid)) throw new OctoError("INVALID_BOOKING_UUID", "El uuid no es válido.", { uuid });

    const body = await octoBody(req).catch(() => ({}) as Record<string, unknown>);
    const asked = Number(body.expirationMinutes ?? DEFAULT_HOLD_MINUTES);
    return octoJson(await extendBooking(ctx, uuid, asked), capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
