/**
 * BENEFICIOS DE MEMBEGO EN EL MOSTRADOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE TOCA
 *
 * La migración 0041 dejó escrito, hace dos olas, por qué la elegibilidad no se
 * copia:
 *
 *   «La ELEGIBILIDAD no se copia a propósito: el contrato lo prohíbe porque
 *    decide dinero y una copia desfasada regala un beneficio ya consumido.»
 *
 * Sigue igual. Aquí NO hay ninguna regla que decida si un cliente tiene derecho
 * a algo: eso lo contesta MembeGo en el momento (`POST /benefits/evaluate`) y
 * lo consume MembeGo (`POST /redemptions`). Lo de este archivo es el otro lado:
 * traducir lo que MembeGo contesta a lo que la venta necesita —cuánto se rebaja
 * y de qué línea— y decidir cuándo NO se puede ni intentar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS TIPOS SON DE `@membego/contracts`, Y AQUÍ VAN COPIADOS
 *
 * MembeGo publica el vocabulario en un paquete propio (`@membego/contracts`)
 * precisamente para que los satélites no lo copien: «copiar funciona el primer
 * día y falla el tercer mes».
 *
 * Ese paquete NO está publicado en npm todavía, así que aquí va la copia — y
 * con ella la deuda, escrita para que no se olvide: **el día que se publique,
 * esto se sustituye por la dependencia.** Mientras tanto, una guarda de
 * contrato comprueba que los códigos de error que este código sabe distinguir
 * sigan siendo los del acuerdo.
 *
 * Todo lo de aquí es puro. Quien habla con MembeGo es `membego-platform.ts` y
 * quien escribe en la base es `membego-redemption-service.ts`.
 */

/* ═══════════════════════════════════════ el vocabulario del contrato ══ */

/** Códigos de error de la API de plataforma (espejo de `@membego/contracts`). */
export const MEMBEGO_ERROR_STATUS = {
  INVALID_REQUEST: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 400,
  IDEMPOTENCY_IN_PROGRESS: 409,
  INVALID_CLIENT: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  INSUFFICIENT_SCOPE: 403,
  COMPANY_NOT_ENTITLED: 403,
  API_KEY_NOT_SUPPORTED: 403,
  NOT_FOUND: 404,
  BENEFIT_NOT_ELIGIBLE: 422,
  REDEMPTION_CONFLICT: 409,
  SSO_TOKEN_INVALID: 401,
  SSO_TOKEN_ALREADY_USED: 409,
  QUOTA_EXCEEDED: 403,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PLATFORM_API_UNCONFIGURED: 503,
} as const;

export type MembegoErrorCode = keyof typeof MEMBEGO_ERROR_STATUS;

/**
 * ¿Merece la pena reintentar?
 *
 * Un 4xx no se reintenta —salvo el 429— porque reintentar algo que el servidor
 * rechazó por su contenido solo gasta cuota y retrasa el error real.
 */
export function isRetryable(code: MembegoErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "INTERNAL_ERROR" || code === "IDEMPOTENCY_IN_PROGRESS";
}

/** «Pide un token nuevo y vuelve a intentarlo». */
export function needsFreshToken(code: MembegoErrorCode): boolean {
  return code === "TOKEN_EXPIRED" || code === "INVALID_TOKEN";
}

/** Los permisos que hace falta pedir al emitir el token. */
export const REQUIRED_SCOPES = ["benefits:read", "benefits:redeem"] as const;

export type BenefitType = "MEMBERSHIP" | "PROMOTION";

export interface BenefitEffect {
  kind: "FREE" | "PERCENT" | "AMOUNT" | "NONE";
  /** Solo en PERCENT: de 0 a 100. */
  value?: number;
  /** Solo en AMOUNT: en la unidad mínima de la moneda (2 550 = 25,50). */
  amountCents?: number;
  label: string;
}

export interface EvaluatedBenefit {
  type: BenefitType;
  id: string;
  nombre: string;
  eligible: boolean;
  usesLeft: number;
  expiresAt: string | null;
  reason: string | null;
  coverage: unknown | null;
  /** Solo en promociones: qué le hace a la factura. */
  effect?: BenefitEffect;
}

export interface EvaluateResult {
  customerId: string;
  companyId: string;
  eligible: boolean;
  benefits: EvaluatedBenefit[];
  evaluatedAt: string;
  reserved: false;
}

export interface RedemptionResult {
  redemptionId: string;
  visitId: string;
  codigo: string;
  ticketNumero: string;
  customerId: string;
  companyId: string;
  servicio: string;
  usesLeft: number | null;
  unlimited: boolean;
  redeemedAt: string;
}

/* ══════════════════════════════════════════════ leer la evaluación ══ */

/**
 * Los beneficios que se le pueden ofrecer AHORA al cliente que está delante.
 *
 * Se filtra por `eligible`, que lo decide MembeGo. Un beneficio no elegible
 * igual se enseña —con su motivo— porque el cajero necesita poder decirle al
 * cliente «se te venció el 3 de agosto» en vez de que simplemente no aparezca
 * y parezca que el sistema no lo ve.
 */
export function offerable(result: EvaluateResult | null): EvaluatedBenefit[] {
  return (result?.benefits ?? []).filter((b) => b.eligible === true);
}

export function notOfferable(result: EvaluateResult | null): EvaluatedBenefit[] {
  return (result?.benefits ?? []).filter((b) => b.eligible !== true);
}

/** El motivo, en lenguaje de mostrador. */
export const REASON_MESSAGE: Record<string, string> = {
  EXPIRED: "La membresía o la promoción venció.",
  NO_USES_LEFT: "Ya no le quedan usos.",
  DAY_NOT_ALLOWED: "Hoy no es un día válido para este beneficio.",
  TIME_NOT_ALLOWED: "A esta hora no se puede usar este beneficio.",
  ALREADY_CONSUMED: "Ya se consumió.",
  NOT_ACTIVE: "No está activo.",
  VEHICLE_LEVEL_ABOVE_PLAN: "El plan no cubre este servicio.",
  VEHICLE_NOT_IN_MEMBERSHIP: "El servicio no está incluido en la membresía.",
};

export function reasonMessage(reason: string | null | undefined): string {
  if (!reason) return "No se puede usar ahora mismo.";
  return REASON_MESSAGE[reason] ?? "No se puede usar ahora mismo.";
}

/**
 * Una respuesta de evaluación caduca en cuanto se contesta.
 *
 * MembeGo manda `evaluatedAt` exactamente para esto: «un satélite que la guarde
 * y la use media hora después tiene delante la fecha que lo desmiente». Aquí se
 * usa para no dejar canjear sobre una pantalla que el cajero abrió antes de
 * irse a almorzar.
 */
export const EVALUATION_TTL_SECONDS = 180;

export function evaluationIsStale(
  evaluatedAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!evaluatedAt) return true;
  const at = new Date(evaluatedAt).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > EVALUATION_TTL_SECONDS * 1000;
}

/* ══════════════════════════════════════════════════ el descuento ══ */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Cuánto rebaja el beneficio sobre el importe de UNA línea.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA LÍNEA Y NO LA VENTA ENTERA
 *
 * En MembeGo un uso es UN servicio: `usesLeft` baja de uno en uno. Aplicar un
 * «20 %» a una venta de cuatro excursiones consumiría un uso y descontaría
 * cuatro servicios, que es regalar tres.
 *
 * Por eso el beneficio se aplica a una línea, la que elija el cajero, y por
 * defecto la MÁS CARA — que es lo que cualquiera haría a mano y lo que el
 * cliente espera de «tienes una gratis».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NUNCA DEJA LA LÍNEA EN NEGATIVO
 *
 * Un beneficio de 1 000 sobre una línea de 600 descuenta 600, no 1 000. Sin ese
 * tope, la venta saldría con un importe negativo que el arqueo cuadraría
 * restando de la caja del día.
 */
export function discountFor(effect: BenefitEffect | null | undefined, lineTotal: number): number {
  const total = Math.max(0, Number(lineTotal) || 0);
  if (!effect || total <= 0) return 0;

  switch (effect.kind) {
    case "FREE":
      return round2(total);
    case "PERCENT": {
      const pct = Math.max(0, Math.min(100, Number(effect.value) || 0));
      return round2(Math.min(total, (total * pct) / 100));
    }
    case "AMOUNT": {
      // MembeGo cuenta el dinero en la unidad mínima de la moneda: 2 550 son
      // 25,50. Tratarlo como pesos descontaría veinticinco veces de más.
      const amount = Math.max(0, Number(effect.amountCents) || 0) / 100;
      return round2(Math.min(total, amount));
    }
    default:
      return 0;
  }
}

/**
 * Una membresía no trae efecto monetario: cubre el servicio.
 *
 * MembeGo solo calcula `effect` para las promociones. Una membresía dice «este
 * cliente tiene derecho a un servicio incluido», y en una operadora eso es la
 * línea gratis. Inventar un porcentaje para ella sería decidir aquí lo que el
 * acuerdo con el cliente no dice.
 */
export function effectOf(benefit: EvaluatedBenefit): BenefitEffect {
  if (benefit.effect) return benefit.effect;
  if (benefit.type === "MEMBERSHIP") {
    return { kind: "FREE", label: "Incluido en la membresía" };
  }
  return { kind: "NONE", label: benefit.nombre || "Beneficio" };
}

export interface LineLike {
  id: string;
  label: string;
  total: number;
}

/** La línea por defecto: la más cara de las que siguen vivas. */
export function defaultLine(lines: LineLike[]): LineLike | null {
  const alive = lines.filter((l) => Number(l.total) > 0);
  if (alive.length === 0) return null;
  return alive.reduce((best, line) => (Number(line.total) > Number(best.total) ? line : best));
}

/* ═══════════════════════════════════════════════════ los bloqueos ══ */

export type RedeemBlock =
  | "not_configured"
  | "not_linked"
  | "no_customer"
  | "no_benefit"
  | "not_eligible"
  | "stale"
  | "no_line"
  | "already_redeemed"
  | "order_closed";

export const REDEEM_BLOCK_MESSAGE: Record<RedeemBlock, string> = {
  not_configured: "La conexión con MembeGo no está configurada en este servidor.",
  not_linked: "Esta empresa todavía no está vinculada con MembeGo.",
  no_customer: "Ese cliente no está identificado en MembeGo.",
  no_benefit: "Elige el beneficio que se va a canjear.",
  not_eligible: "MembeGo dice que ese beneficio no se puede usar ahora.",
  stale: "La consulta de beneficios caducó: vuelve a comprobarlos antes de canjear.",
  no_line: "No hay ninguna línea de la venta sobre la que aplicar el beneficio.",
  already_redeemed: "Esta venta ya tiene un beneficio aplicado.",
  order_closed: "La venta ya está cerrada: un beneficio se canjea sobre una venta viva.",
};

export interface RedeemContext {
  configured: boolean;
  linked: boolean;
  membegoClienteId: string | null;
  benefit: EvaluatedBenefit | null;
  evaluatedAt: string | null;
  lines: LineLike[];
  alreadyRedeemed: boolean;
  orderStatus: string | null;
  now?: Date;
}

/** Los estados de venta sobre los que ya no se canjea. */
const CLOSED_ORDER = new Set(["cancelled", "refunded", "completed"]);

/**
 * ¿Se puede canjear? Y si no, por qué.
 *
 * El orden importa: primero lo que es de configuración (que el cajero no puede
 * arreglar y tiene que escalar), después lo que sí puede arreglar él.
 */
export function redeemBlocker(ctx: RedeemContext): RedeemBlock | null {
  if (!ctx.configured) return "not_configured";
  if (!ctx.linked) return "not_linked";
  if (!ctx.membegoClienteId) return "no_customer";
  if (ctx.alreadyRedeemed) return "already_redeemed";
  if (ctx.orderStatus && CLOSED_ORDER.has(ctx.orderStatus)) return "order_closed";
  if (!ctx.benefit) return "no_benefit";
  if (ctx.benefit.eligible !== true) return "not_eligible";
  if (evaluationIsStale(ctx.evaluatedAt, ctx.now)) return "stale";
  if (!defaultLine(ctx.lines)) return "no_line";
  return null;
}

/* ══════════════════════════════════════════════════ idempotencia ══ */

/**
 * La clave con la que se pide el canje.
 *
 * Deriva de la VENTA y del BENEFICIO, no de un aleatorio: el doble clic del
 * cajero y el reintento del navegador generan exactamente la misma clave, así
 * que MembeGo devuelve el primer canje en vez de consumir un segundo uso. Un
 * uuid nuevo por intento haría lo contrario, que es el fallo que la clave
 * existe para evitar.
 */
export function idempotencyKeyFor(orderId: string, benefitId: string): string {
  return `pt:${orderId}:${benefitId}`.slice(0, 120);
}

/**
 * El «servicio» que se le dice a MembeGo que se prestó.
 *
 * Va el nombre del producto y no un literal fijo: ese texto sale en el ticket
 * del cliente y en el historial de MembeGo, y «Servicio» a secas convierte su
 * historial en una lista de nada.
 */
export function serviceLabel(productName: string | null | undefined, fallback = "Excursión"): string {
  const name = (productName ?? "").trim();
  return (name === "" ? fallback : name).slice(0, 120);
}

/* ══════════════════════════════════════════════════════ la reversa ══ */

export type ReversalBlock = "not_applied" | "no_remote_id" | "already_reversed" | "promotion";

export const REVERSAL_BLOCK_MESSAGE: Record<ReversalBlock, string> = {
  not_applied: "Ese canje no llegó a aplicarse.",
  no_remote_id: "MembeGo no devolvió identificador de canje: hay que revertirlo desde su panel.",
  already_reversed: "Ese canje ya se revirtió.",
  /**
   * La API de MembeGo revierte canjes de MEMBRESÍA (`POST
   * /redemptions/{id}/reverse`) y no tiene el equivalente para promociones.
   *
   * Callarlo sería lo peor: la venta se anularía, el sistema diría «listo» y el
   * cliente se quedaría con un uso gastado por una venta que no existió. Se
   * dice, y queda en el aviso para que alguien lo devuelva a mano.
   */
  promotion: "Una promoción se devuelve desde el panel de MembeGo: su API no admite reversa.",
};

export function reversalBlocker(row: {
  status?: string | null;
  redemption_id?: string | null;
  benefit_type?: string | null;
}): ReversalBlock | null {
  if (row.status === "reversed") return "already_reversed";
  if (row.status !== "applied") return "not_applied";
  if (!row.redemption_id) return "no_remote_id";
  if (row.benefit_type === "PROMOTION") return "promotion";
  return null;
}

/**
 * ¿Hay que devolverle el descuento a la venta al revertir?
 *
 * Sí cuando la venta sigue viva: se revirtió el beneficio y el importe tiene
 * que volver a subir. No cuando la venta se está cancelando entera, porque
 * entonces la línea desaparece y volver a subirla antes inflaría el reembolso.
 */
export function shouldRestoreLine(orderStatus: string | null | undefined): boolean {
  return !CLOSED_ORDER.has((orderStatus ?? "").toLowerCase());
}
