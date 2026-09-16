import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { assertRateLimit } from "@/lib/rate-limit";
import {
  tokenFromHeaders, parseToken, checkKey,
  KEY_PROBLEM_MESSAGE, KEY_PROBLEM_STATUS,
  type ApiScope, type StoredKey,
} from "@/lib/api-keys";
import type { Company } from "@/lib/types";

/**
 * AUTENTICAR UNA PETICIÓN DE OTRO SISTEMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO NO ES UNA SESIÓN
 *
 * No hay cookies, no hay usuario y no hay navegador: hay un servidor de una
 * agencia llamando desde otro país. Por eso:
 *
 *  · El inquilino sale de LA LLAVE, no de una sesión. Nada de lo que venga en
 *    el cuerpo puede cambiar de qué empresa es la reserva.
 *  · El límite de peticiones es POR LLAVE y no por IP: un socio que integra mal
 *    y llama mil veces por minuto no puede agotarle el cupo a los demás
 *    socios que comparten salida a internet.
 *  · Se anota el último uso. Es lo que permite contestar «esa llave no se usa
 *    desde marzo» cuando alguien pregunta si puede revocarla — y sin eso, las
 *    llaves no se revocan nunca por si acaso.
 */

export class ApiAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export interface ApiCaller {
  keyId: string;
  companyId: string;
  scope: ApiScope;
  partnerId: string | null;
  company: Company | null;
}

/**
 * Resuelve quién llama, o lanza con el código que corresponde.
 *
 * `needed` es lo que la ruta va a hacer: una llave de solo lectura consulta
 * disponibilidad y no crea reservas.
 */
export async function requireApiKey(req: Request, needed: ApiScope): Promise<ApiCaller> {
  const raw = tokenFromHeaders(req.headers);
  if (!raw) throw new ApiAuthError(KEY_PROBLEM_MESSAGE.missing, KEY_PROBLEM_STATUS.missing);

  const parsed = parseToken(raw);
  if (!parsed) throw new ApiAuthError(KEY_PROBLEM_MESSAGE.malformed, KEY_PROBLEM_STATUS.malformed);

  const sb = supabaseService();
  const { data: stored } = await sb
    .from("api_key")
    .select("id, organization_id, secret_hash, scope, partner_id, revoked_at")
    .eq("prefix", parsed.prefix)
    .maybeSingle();

  const verdict = checkKey(stored as StoredKey | null, parsed.secret, needed);
  if (verdict.ok === false) {
    throw new ApiAuthError(KEY_PROBLEM_MESSAGE[verdict.problem], KEY_PROBLEM_STATUS[verdict.problem]);
  }

  // Por llave: el socio que integra mal no puede agotarle el cupo a los demás.
  await assertRateLimit({ key: `api:${verdict.key.id}`, limit: 600, windowMs: 60_000 });

  // El último uso se anota sin esperar: si esa escritura falla o tarda, la
  // petición del socio no tiene por qué enterarse.
  void sb.from("api_key").update({ last_used_at: new Date().toISOString() }).eq("id", verdict.key.id);

  const { data: org } = await sb
    .from("organizations")
    .select("id, name, currency, subscription_status, trial_ends_at, plan_id, modules_enabled, status")
    .eq("id", verdict.key.organization_id)
    .maybeSingle();

  if (!org || (org.status && org.status !== "active")) {
    throw new ApiAuthError("Esta cuenta no está activa.", 403);
  }

  return {
    keyId: verdict.key.id,
    companyId: verdict.key.organization_id,
    scope: verdict.key.scope,
    partnerId: verdict.key.partner_id ?? null,
    company: {
      _id: org.id,
      name: org.name,
      base_currency: org.currency,
      subscription_status: org.subscription_status,
      trial_ends_at: org.trial_ends_at,
      plan: org.plan_id,
      modules_enabled: org.modules_enabled,
    } as Company,
  };
}

/** La respuesta de error de la API pública: sobre estable y sin detalles internos. */
export function apiError(err: unknown) {
  const status = err instanceof ApiAuthError ? err.status : (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Error inesperado";
  // Un 500 no cuenta por dentro: el socio no puede arreglar nada con el detalle
  // y el detalle es justo lo que no conviene publicar.
  return Response.json(
    { error: { message: status >= 500 ? "Error interno" : message, status } },
    { status }
  );
}
