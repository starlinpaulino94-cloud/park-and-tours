import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/backend-logger";

/**
 * EL LÍMITE DE PETICIONES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ DEJÓ DE BASTAR UN MAPA EN MEMORIA
 *
 * El contador vivía en un `Map` del proceso. Sobre un servidor de siempre eso
 * funciona; sobre funciones sin estado —que es donde corre esto— cada instancia
 * tiene su propio mapa, así que el límite real es «lo configurado MULTIPLICADO
 * por el número de instancias». Y ese número lo decide el proveedor según la
 * carga: cuanto más fuerte el ataque, más instancias levanta y más permisivo se
 * vuelve el límite. Exactamente al revés de lo que hace falta.
 *
 * En concreto, y con los límites que ya estaban puestos: «10 intentos de SSO
 * por minuto» no frenaba a quien prueba firmas contra `/sso/membego`, «60
 * consultas de saldo por minuto» no impedía enumerar códigos de gift card, y
 * «3 exportaciones de la empresa por hora» no impedía descargar la base entera
 * en bucle. Las tres son puertas que se pueden empujar sin sesión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS CAPAS, Y LA DE MEMORIA SE QUEDA
 *
 *  1. MEMORIA, primero. Rechaza la ráfaga que cae en esta misma instancia sin
 *     gastar un viaje a la base. Es gratis y absorbe el caso más común.
 *  2. BASE DE DATOS, después. Es el contador de verdad: uno solo para todas las
 *     instancias, incrementado en una sentencia atómica (`rate_limit_hit`).
 *
 * Si la base no responde, la petición NO se abre del todo: se queda con el
 * veredicto de la memoria, que es lo que había antes de 0043. Un limitador
 * caído no puede tumbar el sistema entero, pero tampoco puede desaparecer.
 */

/* ------------------------------------------------------- la decisión pura */

export interface Bucket {
  hits: number;
  resetAt: number;
}

export interface Decision {
  allowed: boolean;
  bucket: Bucket;
  /** Segundos hasta que la ventana se abre. Nunca 0. */
  retryAfter: number;
}

/**
 * Qué pasa con una petición más sobre esta ventana.
 *
 * El tope es «hasta N», no «más de N»: con límite 5, el sexto intento se
 * rechaza. Y la ventana vencida se reinicia en 1, no en 0 —la petición que la
 * reinicia también cuenta—, que es la diferencia entre 5 y 6 intentos por
 * minuto sostenidos.
 */
export function hit(current: Bucket | undefined, now: number, limit: number, windowMs: number): Decision {
  if (!current || current.resetAt <= now) {
    const bucket = { hits: 1, resetAt: now + Math.max(windowMs, 1) };
    return { allowed: 1 <= limit, bucket, retryAfter: retryAfterFrom(bucket.resetAt, now) };
  }
  const bucket = { hits: current.hits + 1, resetAt: current.resetAt };
  return { allowed: bucket.hits <= limit, bucket, retryAfter: retryAfterFrom(bucket.resetAt, now) };
}

/** Nunca 0: un «reintenta en 0 segundos» invita a reintentar al instante. */
export function retryAfterFrom(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export function tooManyRequests(retryAfter: number): Error {
  return Object.assign(new Error("Demasiadas solicitudes. Intenta de nuevo en unos segundos."), {
    status: 429,
    retryAfter,
  });
}

/* ----------------------------------------------------- la capa en memoria */

const buckets = new Map<string, Bucket>();

/** Solo para las pruebas: la memoria persiste entre casos dentro del proceso. */
export function resetLocalBuckets(): void {
  buckets.clear();
}

function hitLocal(key: string, limit: number, windowMs: number): Decision {
  const now = Date.now();
  const decision = hit(buckets.get(key), now, limit, windowMs);
  buckets.set(key, decision.bucket);

  // Limpieza oportunista para que el mapa no crezca sin fin en procesos largos.
  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  return decision;
}

/* --------------------------------------------------------------- la clave */

function clientIp(req: Request): string {
  const headers = req.headers;
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function rateLimitKey(req: Request, scope: string, subject?: string | null): string {
  return `${scope}:${subject || clientIp(req)}`;
}

/* ------------------------------------------------------ el contador común */

interface SharedResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * El contador de la base.
 *
 * Va por el rol de servicio a propósito: la función está vedada a `anon` y a
 * `authenticated` porque, si la pudiera llamar el cliente, inflaría el contador
 * de la clave de OTRA persona hasta dejarla fuera del sistema. Y por eso mismo
 * no puede resolverse por cookies: esto corre también en peticiones SIN sesión
 * —el SSO entrante, el webhook, la consulta de saldo de una gift card—, que son
 * justo las que más falta hace limitar.
 */
async function hitShared(key: string, limit: number, windowMs: number): Promise<SharedResult | null> {
  try {
    const sb = supabaseService();
    const { data, error } = await sb.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return null;
    return { allowed: row.allowed, retryAfter: Math.max(1, Number(row.retry_after) || 1) };
  } catch (err) {
    // Degradar, no abrir: la memoria ya dio su veredicto y ese se respeta.
    // Se registra porque un limitador que falla en silencio es un límite que
    // nadie sabe que dejó de aplicarse.
    logger.warn("rate-limit: el contador compartido no respondió", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  /**
   * Salta el contador compartido.
   *
   * Solo para lo que se llama en bucle dentro de una misma petición, donde el
   * viaje a la base costaría más que el límite que aplica.
   */
  localOnly?: boolean;
}

/**
 * Lanza 429 cuando la clave pasó de su cupo.
 *
 * Es `async` desde 0043. Una llamada sin `await` devolvería una promesa que
 * nadie mira y la petición seguiría de largo —el límite dejaría de existir sin
 * que nada falle a la vista—, así que hay una guarda que exige el `await` en
 * las setenta y cinco llamadas.
 *
 * El inicio de sesión NO pasa por aquí: se hace contra Supabase desde el
 * navegador, así que sus intentos los limita Supabase. Lo que pasa por aquí son
 * las puertas propias de la aplicación.
 */
export async function assertRateLimit({ key, limit, windowMs, localOnly }: RateLimitOptions): Promise<void> {
  const local = hitLocal(key, limit, windowMs);
  if (!local.allowed) throw tooManyRequests(local.retryAfter);
  if (localOnly) return;

  const shared = await hitShared(key, limit, windowMs);
  if (shared && !shared.allowed) throw tooManyRequests(shared.retryAfter);
}
