import "server-only";
import {
  MEMBEGO_ERROR_STATUS, REQUIRED_SCOPES, isRetryable, needsFreshToken,
  type EvaluateResult, type MembegoErrorCode, type RedemptionResult,
} from "@/lib/membego-benefits";

/**
 * HABLAR CON LA API DE PLATAFORMA DE MEMBEGO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTE CLIENTE
 *
 * MembeGo expone una API de plataforma (`/api/platform/v1`) con OAuth2 de
 * *client credentials*. Park & Tours está dado de alta como SISTEMA satélite
 * del vertical de excursiones, así que se autentica con su `client_id` y
 * `client_secret` y pide un token con los permisos que necesita.
 *
 * Tres llamadas y nada más:
 *
 *   POST /benefits/evaluate      «¿qué puede consumir este cliente AHORA?»
 *   POST /redemptions            consumir una MEMBRESÍA
 *   POST /promotions/redeem      consumir una PROMOCIÓN
 *
 * Son endpoints distintos porque en MembeGo son cosas distintas: una membresía
 * descuenta un uso de un plan y deja una visita; una promoción consume una
 * compra concreta. Unificarlos aquí obligaría a adivinar cuál toca, y el precio
 * de adivinar mal es consumir el beneficio equivocado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO HACE, Y ES DELIBERADO
 *
 * No cachea elegibilidad. Ni un segundo. Está escrito en la migración 0041 y lo
 * repite la propia documentación de MembeGo: una copia desfasada regala un
 * beneficio ya consumido. Lo único que se guarda entre llamadas es el TOKEN,
 * que no es un dato de negocio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CREDENCIAL ES DEL SISTEMA, NO DE LA EMPRESA
 *
 * `client_id`/`client_secret` identifican a Park & Tours entero y viven en el
 * entorno. La EMPRESA va en el cuerpo de cada llamada (`companyId`), y MembeGo
 * comprueba que este sistema esté habilitado para ella. Guardar una credencial
 * por empresa habría sido poner secretos en la base de datos para resolver algo
 * que el contrato ya resuelve.
 */

export class MembegoApiError extends Error {
  constructor(
    readonly code: MembegoErrorCode,
    message: string,
    readonly requestId: string | null = null,
    readonly reason: string | null = null
  ) {
    super(message);
    this.name = "MembegoApiError";
  }

  /** El estado HTTP con el que contestarle a nuestra propia pantalla. */
  get status(): number {
    return MEMBEGO_ERROR_STATUS[this.code] ?? 502;
  }
}

/** La dirección de MembeGo. Configurable para poder apuntar a su entorno de pruebas. */
function baseUrl(): string {
  return (process.env.MEMBEGO_API_URL || "https://www.membego.com").replace(/\/$/, "");
}

export function platformConfigured(): boolean {
  return Boolean(process.env.MEMBEGO_CLIENT_ID && process.env.MEMBEGO_CLIENT_SECRET);
}

/** Ni el token ni la respuesta pueden tardar más que la paciencia de un cajero. */
const TIMEOUT_MS = 8_000;

/* ═══════════════════════════════════════════════════════════ el token ══ */

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * El token, en memoria del proceso.
 *
 * Pedir uno nuevo en cada llamada añadiría un viaje de ida y vuelta al
 * mostrador —el cajero espera el doble con el cliente delante— y gastaría el
 * límite por IP del endpoint de token, que es deliberadamente estrecho porque
 * ahí se prueban secretos.
 *
 * Se renueva con MARGEN: un token que caduca dentro de treinta segundos es un
 * token que va a caducar a mitad del canje.
 */
let cached: CachedToken | null = null;
const RENEW_MARGIN_MS = 60_000;

export function clearTokenCache(): void {
  cached = null;
}

async function fetchToken(): Promise<string> {
  const clientId = process.env.MEMBEGO_CLIENT_ID || "";
  const clientSecret = process.env.MEMBEGO_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new MembegoApiError("PLATFORM_API_UNCONFIGURED", "Faltan las credenciales de MembeGo en el entorno.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}/api/platform/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        // Los DOS permisos: con solo `benefits:read` la consulta funciona y el
        // canje falla en el mostrador, con el cliente delante.
        scope: REQUIRED_SCOPES.join(" "),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number }
      | { error?: { code?: string; message?: string; requestId?: string } }
      | null;

    if (!res.ok || !body || !("access_token" in body) || !body.access_token) {
      const err = (body as { error?: { code?: string; message?: string; requestId?: string } })?.error;
      throw new MembegoApiError(
        (err?.code as MembegoErrorCode) ?? "INVALID_CLIENT",
        err?.message ?? "MembeGo rechazó las credenciales de este sistema.",
        err?.requestId ?? null
      );
    }

    const seconds = Number(body.expires_in ?? 0) > 0 ? Number(body.expires_in) : 600;
    cached = { token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
    return cached.token;
  } catch (err) {
    if (err instanceof MembegoApiError) throw err;
    throw new MembegoApiError("INTERNAL_ERROR", "No se pudo contactar con MembeGo para autenticarse.");
  } finally {
    clearTimeout(timer);
  }
}

async function token(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;
  return fetchToken();
}

/* ═══════════════════════════════════════════════════════ las llamadas ══ */

interface CallOptions {
  path: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
  /** Interno: evita que un reintento por token nuevo se reintente para siempre. */
  retriedToken?: boolean;
  retriedOnce?: boolean;
}

async function call<T>(options: CallOptions): Promise<T> {
  const access = await token(options.retriedToken === true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/platform/v1${options.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access}`,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw new MembegoApiError("INTERNAL_ERROR", "MembeGo no respondió a tiempo.");
  } finally {
    clearTimeout(timer);
  }

  const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (res.ok) return payload as T;

  const error = (payload?.error ?? {}) as { code?: string; message?: string; requestId?: string; reason?: string };
  const code = (error.code as MembegoErrorCode) ?? "INTERNAL_ERROR";
  const requestId = error.requestId ?? res.headers.get("x-request-id");

  // Un token caducado se renueva UNA vez y se reintenta. Sin esto, el primer
  // canje después de diez minutos de calma fallaría siempre.
  if (needsFreshToken(code) && options.retriedToken !== true) {
    clearTokenCache();
    return call<T>({ ...options, retriedToken: true });
  }

  // Y lo reintentable se reintenta UNA vez. Más veces con un cliente delante no
  // ayuda: a la segunda hay que decirle algo a la persona.
  if (isRetryable(code) && options.retriedOnce !== true) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return call<T>({ ...options, retriedOnce: true });
  }

  throw new MembegoApiError(
    code,
    error.message ?? "MembeGo rechazó la operación.",
    requestId,
    error.reason ?? null
  );
}

/**
 * «¿Qué puede consumir este cliente AHORA MISMO, en esta empresa?»
 *
 * Es un POST que no escribe y que no reserva nada: entre evaluar y canjear, el
 * beneficio puede consumirse en otra sucursal. Por eso el canje vuelve a
 * decidir y no se fía de esta respuesta.
 */
export async function evaluateBenefits(
  membegoCompanyId: string,
  membegoClienteId: string
): Promise<EvaluateResult> {
  return call<EvaluateResult>({
    path: "/benefits/evaluate",
    body: { companyId: membegoCompanyId, customerId: membegoClienteId },
  });
}

export interface RedeemMembershipInput {
  membegoCompanyId: string;
  membershipId: string;
  servicio: string;
  notas?: string | null;
  idempotencyKey: string;
}

/** Consumir una MEMBRESÍA: descuenta un uso del plan y deja una visita. */
export async function redeemMembership(input: RedeemMembershipInput): Promise<RedemptionResult> {
  return call<RedemptionResult>({
    path: "/redemptions",
    body: {
      companyId: input.membegoCompanyId,
      membershipId: input.membershipId,
      servicio: input.servicio,
      notas: input.notas ?? null,
    },
    idempotencyKey: input.idempotencyKey,
  });
}

export interface RedeemPromotionInput {
  membegoCompanyId: string;
  promotionId: string;
  servicio: string;
  /** La venta de aquí, para que MembeGo pueda casarla con la suya. */
  externalId?: string | null;
  idempotencyKey: string;
}

export interface PromotionRedemptionResult {
  redemptionId: string;
  promotion: string;
  usesLeft: number;
  consumed: boolean;
  redeemedAt: string;
}

/** Consumir una PROMOCIÓN: gasta un uso de la compra promocional del cliente. */
export async function redeemPromotion(input: RedeemPromotionInput): Promise<PromotionRedemptionResult> {
  return call<PromotionRedemptionResult>({
    path: "/promotions/redeem",
    body: {
      companyId: input.membegoCompanyId,
      promotionId: input.promotionId,
      servicio: input.servicio,
      externalId: input.externalId ?? null,
    },
    idempotencyKey: input.idempotencyKey,
  });
}

export interface ReversalResult {
  visitId: string;
  membershipId: string;
  customerId: string;
  companyId: string;
  usesLeft: number | null;
  applied: boolean;
  reversedAt: string;
}

/**
 * Devolver un canje de MEMBRESÍA.
 *
 * El motivo es OBLIGATORIO por contrato, y con razón: «una reversa sin motivo
 * es un descuadre que nadie puede explicar tres meses después».
 *
 * No existe el equivalente para promociones. Eso NO se disimula: el dominio lo
 * dice (`reversalBlocker` → `"promotion"`) y la venta anulada deja el aviso
 * para que alguien lo devuelva desde el panel de MembeGo.
 */
export async function reverseRedemption(
  membegoCompanyId: string,
  redemptionId: string,
  reason: string
): Promise<ReversalResult> {
  return call<ReversalResult>({
    path: `/redemptions/${encodeURIComponent(redemptionId)}/reverse`,
    body: { companyId: membegoCompanyId, reason },
  });
}
