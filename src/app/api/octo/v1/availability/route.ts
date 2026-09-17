import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody } from "@/lib/octo-http";
import { octoAvailability, OctoError } from "@/lib/octo-service";
import { isLocalDate } from "@/lib/octo";

/**
 * POST /api/octo/v1/availability — las fechas y horas con plaza.
 *
 * Es POST y no GET porque el estándar lo define así: el cuerpo lleva la mezcla
 * de viajeros, y el precio depende de ella (tramos por cantidad, tarifa del
 * socio). Meterlo en la barra de direcciones dejaría el precio de un grupo
 * cacheado como si fuera el de una persona.
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

    const availabilityIds = Array.isArray(body.availabilityIds)
      ? body.availabilityIds.filter((id): id is string => typeof id === "string").slice(0, 100)
      : undefined;
    const units = Array.isArray(body.units)
      ? body.units
          .filter((u): u is { id: string; quantity: number } =>
            !!u && typeof u === "object" && typeof (u as { id?: unknown }).id === "string")
          .map((u) => ({ id: String(u.id), quantity: Math.max(0, Math.floor(Number(u.quantity) || 0)) }))
      : undefined;

    const data = await octoAvailability(ctx, {
      productId, optionId,
      localDateStart: (body.localDateStart as string) ?? null,
      localDateEnd: (body.localDateEnd as string) ?? null,
      availabilityIds, units,
    });
    return octoJson(data, capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
