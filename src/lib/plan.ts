import type { ModuleKey } from "@/lib/types";

/**
 * El plan, como decisión pura.
 *
 * Aquí se resuelve lo único que convierte esta plataforma en un producto que se
 * cobra: si una empresa puede seguir escribiendo, cuánto le queda de cada
 * límite y qué módulos tiene contratados. Sin base de datos y sin sesión, para
 * que la regla se pueda probar entera —incluidas las fronteras, que es donde
 * este tipo de código falla— y para que la misma respuesta valga en una ruta de
 * API, en un aviso del panel y en la pantalla del plan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS PRINCIPIOS QUE NO SE NEGOCIAN
 *
 * 1. NUNCA SE BLOQUEA LA LECTURA. Una empresa que no paga pierde la capacidad
 *    de crear, no el acceso a lo suyo. Sus reservas, su caja y su contabilidad
 *    son datos de su negocio, a veces con obligación fiscal de conservarlos;
 *    secuestrarlos como palanca de cobro es indefendible, y además convierte
 *    cada impago en una urgencia de soporte.
 *
 * 2. SIN INFORMACIÓN NO SE BLOQUEA. `subscription_status` en NULL, plan sin
 *    asignar o límite en NULL significan «no hay dato», y el dato ausente cae
 *    del lado de dejar trabajar. Es lo contrario del criterio habitual de
 *    seguridad —donde la duda cierra la puerta—, y es deliberado: aquí el falso
 *    positivo no filtra nada, solo le corta la operación a una empresa que sí
 *    paga, con el mostrador lleno. La puerta se cierra con un estado explícito.
 */

/** Estados que escribe el webhook de Stripe y admite el check de 0042. */
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "suspended";

/** Los límites del plan. NULL / undefined = ILIMITADO, nunca cero. */
export interface PlanLimits {
  max_users?: number | null;
  max_bookings_month?: number | null;
  max_products?: number | null;
  max_storage_mb?: number | null;
}

export interface PlanSnapshot extends PlanLimits {
  code?: string | null;
  name?: string | null;
  trial_days?: number | null;
  modules_enabled?: string[] | null;
  is_premium?: boolean | null;
}

/** Lo que se sabe de la suscripción de una organización. */
export interface SubscriptionInput {
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  next_billing_at?: string | null;
}

/**
 * Días de gracia tras un cobro fallido antes de cerrar la escritura.
 *
 * Un cobro falla por una tarjeta vencida mucho más a menudo que por una
 * decisión de no pagar. Cerrar el mismo minuto castiga un trámite bancario
 * como si fuera una deuda; siete días es tiempo para que el aviso llegue,
 * alguien actualice la tarjeta y Stripe reintente, y es corto para que no se
 * convierta en un mes gratis.
 */
export const GRACE_DAYS_PAST_DUE = 7;

/** Umbral del aviso de «se te acaba la prueba». */
export const TRIAL_WARNING_DAYS = 3;

export type BlockReason = "trial_expired" | "past_due" | "cancelled" | "suspended";

export interface SubscriptionState {
  status: SubscriptionStatus | "unknown";
  /** ¿Puede esta empresa CREAR y MODIFICAR? La lectura nunca se bloquea. */
  canWrite: boolean;
  /** Motivo del bloqueo, para el mensaje y para la bitácora. */
  reason: BlockReason | null;
  /** Días completos que quedan de prueba (0 = vence hoy; null = sin prueba). */
  trialDaysLeft: number | null;
  /** Días de gracia que quedan tras un cobro fallido (null = no aplica). */
  graceDaysLeft: number | null;
  /** True cuando conviene avisar sin bloquear todavía. */
  warn: boolean;
}

const DAY_MS = 86_400_000;

/** Días completos entre dos instantes; negativo si la fecha ya pasó. */
function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now.getTime()) / DAY_MS);
}

/**
 * El estado de la suscripción y su consecuencia.
 *
 * `trial` con `trial_ends_at` en el pasado NO es «trial»: es una prueba vencida
 * que nadie convirtió, y es el caso que hoy no existía porque la columna donde
 * se apunta el vencimiento tampoco existía.
 */
export function subscriptionState(
  input: SubscriptionInput | null | undefined,
  now: Date = new Date()
): SubscriptionState {
  const raw = (input?.subscription_status || "").trim();
  const trialDaysLeft = daysUntil(input?.trial_ends_at, now);

  const base: SubscriptionState = {
    status: "unknown",
    canWrite: true,
    reason: null,
    trialDaysLeft: null,
    graceDaysLeft: null,
    warn: false,
  };

  // Sin estado no se bloquea (principio 2). Tampoco se avisa: no hay nada que
  // contarle al usuario sobre una suscripción de la que no se sabe nada.
  if (!raw) return base;

  switch (raw as SubscriptionStatus) {
    case "active":
      return { ...base, status: "active" };

    case "trial": {
      // Sin fecha de fin, la prueba no vence: es el estado de una empresa dada
      // de alta antes de que existiera la columna, y no se le corta nada.
      if (trialDaysLeft === null) return { ...base, status: "trial" };
      if (trialDaysLeft < 0) {
        return {
          ...base,
          status: "trial",
          canWrite: false,
          reason: "trial_expired",
          trialDaysLeft,
          warn: true,
        };
      }
      return {
        ...base,
        status: "trial",
        trialDaysLeft,
        warn: trialDaysLeft <= TRIAL_WARNING_DAYS,
      };
    }

    case "past_due": {
      // La gracia se cuenta desde el cobro que falló. Sin esa fecha se concede
      // la gracia completa en vez de bloquear: no saber cuándo falló no es
      // prueba de que fuera hace tiempo.
      const since = daysUntil(input?.next_billing_at, now);
      const graceDaysLeft = since === null ? GRACE_DAYS_PAST_DUE : GRACE_DAYS_PAST_DUE + since;
      if (graceDaysLeft <= 0) {
        return { ...base, status: "past_due", canWrite: false, reason: "past_due", graceDaysLeft, warn: true };
      }
      return { ...base, status: "past_due", graceDaysLeft, warn: true };
    }

    case "cancelled":
      return { ...base, status: "cancelled", canWrite: false, reason: "cancelled", warn: true };

    case "suspended":
      return { ...base, status: "suspended", canWrite: false, reason: "suspended", warn: true };

    default:
      // Un valor que el check de 0042 no admite solo puede llegar de datos
      // heredados. No se bloquea; se informa como desconocido.
      return base;
  }
}

/** Lo que se le dice al usuario. Concreto y con la salida a mano. */
export function blockMessage(reason: BlockReason): string {
  switch (reason) {
    case "trial_expired":
      return "Tu periodo de prueba terminó. Elige un plan para seguir registrando operaciones; " +
        "tus datos siguen aquí y puedes consultarlos y exportarlos.";
    case "past_due":
      return "No pudimos cobrar tu suscripción. Actualiza tu método de pago para seguir " +
        "registrando operaciones; la consulta y la exportación siguen disponibles.";
    case "cancelled":
      return "Tu suscripción está cancelada. Reactívala para seguir registrando operaciones; " +
        "tus datos siguen disponibles para consultar y exportar.";
    case "suspended":
      return "Tu cuenta está suspendida. Contacta con soporte para reactivarla; " +
        "mientras tanto puedes consultar y exportar tus datos.";
  }
}

/* --------------------------------------------------------------- límites */

/** Las métricas con techo. La clave es la columna del plan que la acota. */
export type LimitMetric = "max_users" | "max_bookings_month" | "max_products" | "max_storage_mb";

export interface LimitCheck {
  metric: LimitMetric;
  /** null = ilimitado. */
  limit: number | null;
  used: number;
  /** ¿Cabe UNA más? */
  allowed: boolean;
  /** Cuántas caben todavía (null = ilimitado). */
  remaining: number | null;
  /** Porcentaje consumido, 0–100 (null = ilimitado). Para los medidores. */
  percent: number | null;
  /** True a partir del 80 %: el momento de avisar, no de bloquear. */
  warn: boolean;
}

/**
 * ¿Cabe una más?
 *
 * La comparación es `used >= limit`, no `used > limit`: con el límite en 3 y
 * tres usuarios creados, el cuarto NO entra. Escribir `>` aquí regala
 * exactamente una unidad en cada plan de cada empresa, y es el error que
 * cualquiera comete una vez.
 */
export function limitCheck(
  metric: LimitMetric,
  limits: PlanLimits | null | undefined,
  used: number,
  /** Cuántas se quieren crear de golpe (importaciones, reservas de grupo). */
  wanted = 1
): LimitCheck {
  const raw = limits?.[metric];
  const limit = typeof raw === "number" ? raw : null;
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;

  if (limit === null) {
    return { metric, limit: null, used: safeUsed, allowed: true, remaining: null, percent: null, warn: false };
  }

  const remaining = Math.max(0, limit - safeUsed);
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((safeUsed / limit) * 100));
  return {
    metric,
    limit,
    used: safeUsed,
    allowed: safeUsed + wanted <= limit,
    remaining,
    percent,
    warn: percent >= 80,
  };
}

const METRIC_LABEL: Record<LimitMetric, { one: string; many: string }> = {
  max_users: { one: "usuario", many: "usuarios" },
  max_bookings_month: { one: "reserva este mes", many: "reservas este mes" },
  max_products: { one: "producto", many: "productos" },
  max_storage_mb: { one: "MB de almacenamiento", many: "MB de almacenamiento" },
};

/** El mensaje del límite alcanzado: qué se llenó, cuánto cabía y qué hacer. */
export function limitMessage(check: LimitCheck, planName?: string | null): string {
  const label = METRIC_LABEL[check.metric];
  const plan = planName ? `del plan ${planName}` : "de tu plan";
  return (
    `Alcanzaste el límite ${plan}: ${check.limit} ${check.limit === 1 ? label.one : label.many}. ` +
    `Sube de plan para seguir, o libera espacio si ya no necesitas algo de lo que tienes.`
  );
}

/* --------------------------------------------------------------- módulos */

/**
 * ¿Está este módulo contratado?
 *
 * La lista vacía o ausente significa «sin restricción declarada» y no «ningún
 * módulo»: así se comportaba `moduleEnabled` en `tenant.ts` desde el principio,
 * y cambiarlo ahora dejaría a oscuras a toda empresa cuya lista esté vacía —que
 * hoy son todas las que no pasaron por el alta nueva—.
 */
export function moduleAllowed(modules: string[] | null | undefined, moduleKey: ModuleKey): boolean {
  if (!modules || modules.length === 0) return true;
  return modules.includes(moduleKey);
}

export function moduleMessage(moduleKey: ModuleKey, planName?: string | null): string {
  const plan = planName ? `El plan ${planName}` : "Tu plan";
  return `${plan} no incluye este módulo. Cámbialo de plan para activarlo.`;
}

/* ------------------------------------------------------------ el resumen */

export interface PlanUsage {
  users: number;
  bookingsThisMonth: number;
  products: number;
  storageMb: number;
}

export interface PlanStatus {
  plan: PlanSnapshot | null;
  subscription: SubscriptionState;
  limits: LimitCheck[];
  modules: { key: ModuleKey; enabled: boolean }[];
  usage: PlanUsage;
}

const ALL_MODULES: ModuleKey[] = [
  "bookings", "crm", "commissions", "settlements", "payments", "cash_pos",
  "transport", "pickups", "operations", "b2b_portal", "accounting", "reports", "audit",
];

/**
 * Arma el estado completo para la pantalla y para los avisos, con la misma
 * aritmética que usan las guardas: si el medidor dice 3 de 3, la próxima
 * creación se rechaza. Dos cálculos distintos para la misma pregunta es cómo se
 * llega a una pantalla que promete lo que la API niega.
 */
export function planStatus(
  plan: PlanSnapshot | null,
  subscription: SubscriptionInput | null,
  usage: PlanUsage,
  now: Date = new Date()
): PlanStatus {
  return {
    plan,
    subscription: subscriptionState(subscription, now),
    limits: [
      limitCheck("max_users", plan, usage.users),
      limitCheck("max_bookings_month", plan, usage.bookingsThisMonth),
      limitCheck("max_products", plan, usage.products),
      limitCheck("max_storage_mb", plan, usage.storageMb),
    ],
    modules: ALL_MODULES.map((key) => ({
      key,
      enabled: moduleAllowed(plan?.modules_enabled, key),
    })),
    usage,
  };
}

/** Primer día del mes en curso, en UTC: el origen de la cuenta mensual. */
export function monthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
