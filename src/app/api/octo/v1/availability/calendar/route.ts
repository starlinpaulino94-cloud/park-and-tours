import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody } from "@/lib/octo-http";
import { octoCalendar, OctoError } from "@/lib/octo-service";
import { isLocalDate } from "@/lib/octo";

/**
 * POST /api/octo/v1/availability/calendar — un día por fila.
 *
 * Es lo que el revendedor pinta en el calendario ANTES de que el cliente elija
 * hora: pedir el detalle de cada salida para pintar un mes entero sería una
 * petición por día y todos los meses del año.
 */
export async function POST(req: NextRequest) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    active = capabilities;
    const body = await octoBody(req);

    const productId = String(body.productId ?? "");
    const optionId = String(body.optionId ?? "");
    if (!productId) throw new OctoError("INVALID_PRODUCT_ID", "Falta productId.");
    if (!optionId) throw new OctoError("INVALID_OPTION_ID", "Falta optionId.", { productId });

    for (const key of ["localDateStart", "localDateEnd"] as const) {
      if (body[key] != null && !isLocalDate(body[key])) {
        throw new OctoError("BAD_REQUEST", `${key} tiene que ser una fecha AAAA-MM-DD.`, { productId, optionId });
      }
    }

    const units = Array.isArray(body.units)
      ? body.units
          .filter((u): u is { id: string; quantity: number } =>
            !!u && typeof u === "object" && typeof (u as { id?: unknown }).id === "string")
          .map((u) => ({ id: String(u.id), quantity: Math.max(0, Math.floor(Number(u.quantity) || 0)) }))
      : undefined;

    const data = await octoCalendar(ctx, {
      productId, optionId,
      localDateStart: (body.localDateStart as string) ?? null,
      localDateEnd: (body.localDateEnd as string) ?? null,
      units,
    });
    return octoJson(data, capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
