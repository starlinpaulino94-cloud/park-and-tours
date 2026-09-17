import "server-only";
import { requireApiKey, ApiAuthError } from "@/lib/api-auth";
import { subscriptionState } from "@/lib/plan";
import { OversellError } from "@/lib/availability";
import { OctoError, type OctoContext } from "@/lib/octo-service";
import {
  OCTO_ERROR_STATUS, SUPPORTED_CAPABILITIES, octoErrorBody, parseCapabilities,
  type OctoErrorCode,
} from "@/lib/octo";
import type { ApiScope } from "@/lib/api-keys";

/**
 * LA CAPA HTTP DEL CONECTOR OCTO.
 *
 * Existe para que las once rutas del estándar no repitan once veces la
 * autenticación, la negociación de capacidades y —sobre todo— la traducción de
 * errores.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA TRADUCCIÓN DE ERRORES ES LO IMPORTANTE DE ESTE ARCHIVO
 *
 * El revendedor RAMIFICA sobre el código de error. `INVALID_AVAILABILITY_ID` le
 * dice «vuelve a pedir disponibilidad»; `UNPROCESSABLE_ENTITY` le dice «avisa a
 * un humano»; un 500 le dice «reintenta». Devolver el código equivocado hace
 * que el otro lado actúe con confianza sobre una conclusión falsa: reintentar
 * mil veces algo que nunca va a funcionar, o dar por perdida una reserva que sí
 * existía.
 *
 * Por eso aquí los errores de DENTRO —el cupo agotado, la sobreventa, el plan
 * vencido— se traducen a un código del estándar en vez de escaparse con su
 * forma propia, que el revendedor no sabe leer.
 */

export interface OctoRequest {
  ctx: OctoContext;
  capabilities: string[];
}

/**
 * Resuelve quién llama y qué capacidades pidió.
 *
 * El inquilino sale de la LLAVE y nunca del cuerpo: una petición que pudiera
 * decir de qué empresa es la reserva sería una llave que vende en nombre de
 * cualquiera.
 */
export async function octoRequest(req: Request, needed: ApiScope): Promise<OctoRequest> {
  const caller = await requireApiKey(req, needed);

  // El estándar admite la cabecera y, para quien no pueda mandarla, el
  // parámetro. Aceptar solo la cabecera deja fuera a integraciones reales.
  const url = new URL(req.url);
  const raw = req.headers.get("octo-capabilities") ?? url.searchParams.get("_capabilities");
  const capabilities = parseCapabilities(raw);

  return {
    ctx: {
      companyId: caller.companyId,
      company: caller.company,
      partnerId: caller.partnerId,
      keyId: caller.keyId,
      capabilities,
    },
    capabilities,
  };
}

/**
 * Una escritura exige además que la cuenta de la operadora admita operaciones.
 *
 * Se comprueba aparte de la llave porque son dos cosas distintas: la llave
 * puede ser válida y la suscripción estar vencida. El revendedor recibe
 * FORBIDDEN, que es lo que el estándar tiene para «tu acceso no alcanza», con
 * un mensaje que deja claro que no es su llave.
 */
export function assertCanSell(ctx: OctoContext): void {
  const state = subscriptionState(ctx.company);
  if (!state.canWrite) {
    throw new OctoError("FORBIDDEN", "La cuenta de esta operadora no admite reservas nuevas ahora mismo.");
  }
}

/** La cabecera que el estándar exige en TODA respuesta: qué capacidades quedaron activas. */
function headersFor(capabilities: string[]): HeadersInit {
  return {
    "Octo-Capabilities": capabilities.join(", "),
    "Available-Capabilities": SUPPORTED_CAPABILITIES.join(", "),
    "Cache-Control": "no-store",
  };
}

export function octoJson(data: unknown, capabilities: string[], status = 200): Response {
  return Response.json(data, { status, headers: headersFor(capabilities) });
}

/**
 * Traduce cualquier fallo al vocabulario del estándar.
 *
 * Los casos que importan y por qué se mapean así:
 *
 *  · Cupo del socio agotado o sobreventa → UNPROCESSABLE_ENTITY. La petición
 *    era correcta; lo que no hay es plaza. Devolver BAD_REQUEST haría que el
 *    revendedor buscara un error en su JSON que no existe.
 *  · Llave ausente o inválida → UNAUTHORIZED / FORBIDDEN según el caso, que es
 *    la diferencia entre «identifícate» y «ya sé quién eres y no te alcanza».
 *  · Cualquier otra cosa → INTERNAL_SERVER_ERROR sin detalle. El detalle no le
 *    sirve al revendedor y es justo lo que no conviene publicar.
 */
export function octoFail(err: unknown, capabilities: string[] = []): Response {
  if (err instanceof OctoError) {
    return Response.json(
      octoErrorBody(err.code, err.message, err.pointer),
      { status: OCTO_ERROR_STATUS[err.code], headers: headersFor(capabilities) }
    );
  }

  if (err instanceof ApiAuthError) {
    const code: OctoErrorCode = err.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
    return Response.json(
      octoErrorBody(code, err.message),
      { status: OCTO_ERROR_STATUS[code], headers: headersFor(capabilities) }
    );
  }

  if (err instanceof OversellError) {
    return Response.json(
      octoErrorBody("UNPROCESSABLE_ENTITY", err.message),
      { status: 422, headers: headersFor(capabilities) }
    );
  }

  // El cupo contratado del socio llega como un error con estado 409 desde
  // `assertAllotment`. Para el estándar eso es «no se puede procesar», no un
  // conflicto de HTTP que el revendedor no sabría interpretar.
  const status = (err as { status?: number })?.status;
  if (status === 409 || status === 422) {
    const message = err instanceof Error ? err.message : "No hay plazas disponibles.";
    return Response.json(
      octoErrorBody("UNPROCESSABLE_ENTITY", message),
      { status: 422, headers: headersFor(capabilities) }
    );
  }
  if (status === 402) {
    return Response.json(
      octoErrorBody("FORBIDDEN", err instanceof Error ? err.message : "Acceso no disponible."),
      { status: 403, headers: headersFor(capabilities) }
    );
  }
  if (status === 404) {
    return Response.json(
      octoErrorBody("BAD_REQUEST", err instanceof Error ? err.message : "No encontrado."),
      { status: 400, headers: headersFor(capabilities) }
    );
  }

  console.error("[octo] fallo no previsto:", err);
  return Response.json(
    octoErrorBody("INTERNAL_SERVER_ERROR", "Error interno."),
    { status: 500, headers: headersFor(capabilities) }
  );
}

/** El cuerpo de la petición, o un BAD_REQUEST con el vocabulario del estándar. */
export async function octoBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") throw new Error("no es un objeto");
    return parsed as Record<string, unknown>;
  } catch {
    throw new OctoError("BAD_REQUEST", "El cuerpo de la petición tiene que ser un objeto JSON.");
  }
}
