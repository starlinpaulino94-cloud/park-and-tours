/**
 * ANALÍTICA: COHORTES, ANTICIPACIÓN Y PREVISIÓN DE OCUPACIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 *
 * El área de Analítica era un índice de enlaces a los informes que ya existen.
 * Todos contestan la misma pregunta con distinto corte: **qué pasó**. Ninguno
 * contesta las dos que de verdad cambian decisiones en una operadora:
 *
 *  · **¿Vuelven?** Un negocio de excursiones vive de la recompra y de la
 *    recomendación, y sin cohortes la única métrica disponible es «vendí más
 *    que el mes pasado» — que también sube comprando más publicidad.
 *  · **¿Va a salir llena?** La decisión de mañana —confirmar el segundo
 *    autobús, soltar cupo, hacer una oferta de última hora— se toma hoy, con
 *    la salida a medio vender. Mirar cuánto lleva vendido no basta: hay que
 *    saber cuánto SUELE llevar vendido a esa misma distancia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CURVA DE ANTICIPACIÓN, QUE ES EL CORAZÓN DE ESTO
 *
 * En turismo la venta no es lineal: una salida a 30 días lleva vendido poco, y a
 * 3 días se llena de golpe. Esa forma —cuánto del total final está vendido a D
 * días vista— es estable por operadora y es lo que permite prever.
 *
 * Se aprende de las salidas YA OCURRIDAS y se aplica a las futuras:
 *
 *      previsión = vendido_hoy ÷ curva[días_que_faltan]
 *
 * Es la técnica de *pickup* de toda la vida, y funciona porque usa los datos de
 * la propia operadora en vez de un supuesto de manual.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO HACE
 *
 * No inventa una previsión cuando no hay historia. Una operadora que arranca
 * tiene dos salidas pasadas, y decir «va a ir al 92 %» con eso sería una cifra
 * con la autoridad de un cálculo y la fiabilidad de una corazonada. Cuando la
 * muestra es corta se dice, y la confianza sale baja.
 *
 * Todo lo de aquí es puro. Quien lee la base es `analytics-service.ts`.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/* ═══════════════════════════════════════════════════════════ cohortes ══ */

export interface PurchaseRow {
  customerId: string;
  /** Cuándo compró, en ISO. */
  at: string;
  amount: number;
}

/** El mes de una fecha, «AAAA-MM». Es la unidad de una cohorte. */
export function monthKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Cuántos meses hay de `from` a `to`. Negativo si `to` es anterior. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty - fy) * 12 + (tm - fm);
}

export interface CohortRow {
  /** El mes de la PRIMERA compra. */
  cohort: string;
  customers: number;
  revenue: number;
  /**
   * Cuántos de esa cohorte volvieron a comprar N meses después.
   * El índice 0 es el propio mes de alta, y por definición son todos.
   */
  returning: number[];
  /** Lo mismo en porcentaje sobre el tamaño de la cohorte. */
  retention: number[];
}

export const DEFAULT_COHORT_MONTHS = 12;

/**
 * Las cohortes de clientes por mes de primera compra.
 *
 * Un cliente pertenece a UNA cohorte para siempre: la del mes en que compró por
 * primera vez. Reasignarlo cuando vuelve —que es el error habitual— haría que la
 * retención saliera siempre perfecta, porque todo el mundo estaría siempre en su
 * primer mes.
 */
export function buildCohorts(rows: PurchaseRow[], span = DEFAULT_COHORT_MONTHS): CohortRow[] {
  // Primera compra de cada cliente.
  const first = new Map<string, string>();
  for (const row of rows) {
    const month = monthKey(row.at);
    if (!month || !row.customerId) continue;
    const current = first.get(row.customerId);
    if (!current || month < current) first.set(row.customerId, month);
  }

  // Meses en los que cada cliente compró (uno por mes, aunque comprara tres
  // veces: la retención mide si VOLVIÓ, no cuánto).
  const active = new Map<string, Set<string>>();
  const revenue = new Map<string, number>();
  for (const row of rows) {
    const month = monthKey(row.at);
    if (!month || !row.customerId) continue;
    const cohort = first.get(row.customerId);
    if (!cohort) continue;
    const set = active.get(row.customerId) ?? new Set<string>();
    set.add(month);
    active.set(row.customerId, set);
    revenue.set(cohort, (revenue.get(cohort) ?? 0) + num(row.amount));
  }

  const byCohort = new Map<string, string[]>();
  for (const [customerId, cohort] of first) {
    const list = byCohort.get(cohort) ?? [];
    list.push(customerId);
    byCohort.set(cohort, list);
  }

  return [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cohort, customers]) => {
      const returning = new Array(span).fill(0) as number[];
      for (const customerId of customers) {
        for (const month of active.get(customerId) ?? []) {
          const offset = monthsBetween(cohort, month);
          if (offset >= 0 && offset < span) returning[offset] += 1;
        }
      }
      const size = customers.length;
      return {
        cohort,
        customers: size,
        revenue: round2(revenue.get(cohort) ?? 0),
        returning,
        retention: returning.map((n) => (size > 0 ? round2((n / size) * 100) : 0)),
      };
    });
}

/**
 * La tasa de recompra: qué parte de los clientes compró más de una vez.
 *
 * Es el número de una línea que resume la salud del negocio. Se mide sobre
 * clientes, no sobre ventas: diez ventas de diez personas distintas y diez
 * ventas de una sola persona son negocios completamente distintos.
 */
export function repeatRate(rows: PurchaseRow[]): number {
  const months = new Map<string, Set<string>>();
  for (const row of rows) {
    const month = monthKey(row.at);
    if (!month || !row.customerId) continue;
    const set = months.get(row.customerId) ?? new Set<string>();
    set.add(month);
    months.set(row.customerId, set);
  }
  if (months.size === 0) return 0;
  let repeated = 0;
  for (const set of months.values()) if (set.size > 1) repeated += 1;
  return round2((repeated / months.size) * 100);
}

/** Cuánto vale de media un cliente, sumando todo lo que ha comprado. */
export function averageCustomerValue(rows: PurchaseRow[]): number {
  const byCustomer = new Map<string, number>();
  for (const row of rows) {
    if (!row.customerId) continue;
    byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? 0) + num(row.amount));
  }
  if (byCustomer.size === 0) return 0;
  let total = 0;
  for (const value of byCustomer.values()) total += value;
  return round2(total / byCustomer.size);
}

/* ═════════════════════════════════════════════ curva de anticipación ══ */

export interface PaceRow {
  /** Cuándo se reservó. */
  bookedAt: string;
  /** Para cuándo. */
  travelAt: string;
  seats: number;
}

/** Días naturales de antelación. Nunca negativo: reservar el mismo día es 0. */
export function leadDays(bookedAt: string, travelAt: string): number {
  const from = new Date(bookedAt);
  const to = new Date(travelAt);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Los tramos de antelación.
 *
 * No son regulares a propósito: entre 0 y 3 días pasa casi todo en una
 * operadora de destino —el turista reserva desde el hotel—, y un tramo de «0 a
 * 30» escondería justo la parte que hay que gestionar.
 */
export const LEAD_BUCKETS = [0, 1, 2, 3, 7, 14, 30, 60, 90] as const;

export interface LeadBucket {
  from: number;
  to: number | null;
  label: string;
  bookings: number;
  seats: number;
  share: number;
}

export function leadDistribution(rows: PaceRow[]): LeadBucket[] {
  const buckets: LeadBucket[] = LEAD_BUCKETS.map((from, index) => {
    const next = LEAD_BUCKETS[index + 1];
    const to = next === undefined ? null : next - 1;
    return {
      from,
      to,
      label: to === null ? `${from}+ días` : from === to ? `${from} día${from === 1 ? "" : "s"}` : `${from}–${to} días`,
      bookings: 0,
      seats: 0,
      share: 0,
    };
  });

  let totalSeats = 0;
  for (const row of rows) {
    const days = leadDays(row.bookedAt, row.travelAt);
    let index = 0;
    for (let i = 0; i < LEAD_BUCKETS.length; i++) if (days >= LEAD_BUCKETS[i]) index = i;
    buckets[index].bookings += 1;
    buckets[index].seats += Math.max(0, Math.floor(num(row.seats)));
    totalSeats += Math.max(0, Math.floor(num(row.seats)));
  }

  for (const bucket of buckets) {
    bucket.share = totalSeats > 0 ? round2((bucket.seats / totalSeats) * 100) : 0;
  }
  return buckets;
}

/** Hasta cuántos días vista aprende la curva. Más allá, la venta es anecdótica. */
export const CURVE_HORIZON = 90;

export interface PickupCurve {
  /**
   * `share[d]` = qué parte del total final ya estaba vendida a `d` días vista.
   * Va de 1 (a 0 días está todo) hacia abajo según se aleja.
   */
  share: number[];
  /** De cuántas salidas pasadas se aprendió. Es lo que sostiene la confianza. */
  sample: number;
}

export interface PastDeparture {
  /** Las reservas de esa salida: cuándo se hicieron y por cuántas plazas. */
  bookings: { bookedAt: string; seats: number }[];
  travelAt: string;
  finalSeats: number;
}

/**
 * Aprende la curva de la propia operadora.
 *
 * Para cada salida pasada se reconstruye cuánto llevaba vendido a cada día
 * vista, y se promedia entre salidas. Promediar por SALIDA y no por plaza es
 * deliberado: si no, una sola salida grande impondría su forma a todas las
 * demás.
 */
export function learnCurve(departures: PastDeparture[], horizon = CURVE_HORIZON): PickupCurve {
  const totals = new Array(horizon + 1).fill(0) as number[];
  let sample = 0;

  for (const departure of departures) {
    const final = Math.max(0, Math.floor(num(departure.finalSeats)));
    // Una salida sin ventas no enseña nada sobre el ritmo de venta.
    if (final <= 0 || departure.bookings.length === 0) continue;

    // Acumulado por día vista: a `d` días, cuántas plazas había ya vendidas.
    const sold = new Array(horizon + 1).fill(0) as number[];
    for (const booking of departure.bookings) {
      const days = Math.min(horizon, leadDays(booking.bookedAt, departure.travelAt));
      // Esa reserva ya estaba hecha desde ese día hacia adelante (días menores).
      for (let d = days; d >= 0; d--) sold[d] += Math.max(0, Math.floor(num(booking.seats)));
    }

    for (let d = 0; d <= horizon; d++) totals[d] += Math.min(1, sold[d] / final);
    sample += 1;
  }

  if (sample === 0) return { share: [], sample: 0 };

  // La curva sale monótona SOLA, y conviene saber por qué: cada reserva suma en
  // todos los días desde el suyo hacia el día de la salida, así que la serie de
  // cada salida ya es no creciente, y el promedio de series no crecientes lo
  // sigue siendo.
  //
  // Se dice aquí porque la tentación es añadir un ajuste defensivo «por si
  // acaso» — y un ajuste que no puede dispararse nunca es código que nadie
  // puede probar y que el día que importe estará mal.
  const share = totals.map((sum) => round2(sum / sample));
  return { share, sample };
}

/** Cuántas salidas hacen falta para fiarse de la curva. */
export const MIN_CURVE_SAMPLE = 8;
/** Por debajo de esta parte vendida, dividir dispara cualquier previsión. */
export const MIN_CURVE_SHARE = 0.05;

export type Confidence = "high" | "medium" | "low" | "none";

export interface Forecast {
  expectedSeats: number;
  expectedPct: number;
  confidence: Confidence;
  /** Por qué no se puede prever, cuando no se puede. */
  note: string | null;
}

export interface ForecastInput {
  soldSeats: number;
  capacity: number;
  daysOut: number;
  curve: PickupCurve;
}

/**
 * Previsión de ocupación de una salida futura.
 *
 *      previsión = vendido_hoy ÷ curva[días_que_faltan]
 *
 * Con los dos frenos que la hacen utilizable:
 *
 *  · Si la muestra es corta, se dice que la confianza es baja en vez de
 *    presentar una corazonada con cara de cálculo.
 *  · Si a esa distancia la curva dice que normalmente hay vendido casi nada,
 *    NO se divide. A 80 días con el 2 % vendido, dividir entre 0,02 convierte
 *    dos plazas en cien.
 */
export function forecastOccupancy(input: ForecastInput): Forecast {
  const capacity = Math.max(0, Math.floor(num(input.capacity)));
  const sold = Math.max(0, Math.floor(num(input.soldSeats)));
  const daysOut = Math.max(0, Math.floor(num(input.daysOut)));

  if (capacity <= 0) {
    return { expectedSeats: sold, expectedPct: 0, confidence: "none", note: "La salida no tiene capacidad declarada." };
  }
  if (input.curve.sample === 0 || input.curve.share.length === 0) {
    return {
      expectedSeats: sold,
      expectedPct: round2((sold / capacity) * 100),
      confidence: "none",
      note: "Todavía no hay salidas pasadas suficientes para aprender el ritmo de venta.",
    };
  }

  const index = Math.min(daysOut, input.curve.share.length - 1);
  const share = input.curve.share[index];

  if (!(share >= MIN_CURVE_SHARE)) {
    return {
      expectedSeats: sold,
      expectedPct: round2((sold / capacity) * 100),
      confidence: "none",
      note: "Queda demasiado tiempo: a esta distancia la venta todavía no dice nada.",
    };
  }

  const expected = Math.min(capacity, Math.round(sold / share));
  const confidence: Confidence =
    input.curve.sample >= MIN_CURVE_SAMPLE * 3 && daysOut <= 30 ? "high" :
    input.curve.sample >= MIN_CURVE_SAMPLE ? "medium" : "low";

  return {
    expectedSeats: expected,
    expectedPct: round2((expected / capacity) * 100),
    confidence,
    note: confidence === "low"
      ? `Solo hay ${input.curve.sample} salida(s) pasada(s) de las que aprender: tómalo como un indicio.`
      : null,
  };
}

/* ═══════════════════════════════════════════════════════════ alertas ══ */

export type AlertKind = "low_occupancy" | "almost_full" | "no_pickup" | "over_capacity";
export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertThresholds {
  /** Por debajo de esta previsión, la salida está en riesgo. */
  lowPct: number;
  /** Por encima, conviene mover recursos o abrir otro vehículo. */
  highPct: number;
  /** Días vista a partir de los cuales ya no vale la pena avisar de nada. */
  horizonDays: number;
  /** Días vista por debajo de los cuales una salida sin ventas es grave. */
  urgentDays: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  lowPct: 50,
  highPct: 90,
  horizonDays: 21,
  urgentDays: 3,
};

export interface DepartureSnapshot {
  id: string;
  product: string;
  travelAt: string;
  capacity: number;
  soldSeats: number;
  daysOut: number;
}

export interface Alert {
  kind: AlertKind;
  severity: AlertSeverity;
  departureId: string;
  product: string;
  travelAt: string;
  message: string;
  expectedPct: number;
  confidence: Confidence;
}

/**
 * Las alertas de ocupación.
 *
 * Una alerta que no lleva a una acción es ruido, y el ruido hace que se dejen de
 * mirar las que sí importan. Por eso:
 *
 *  · Solo se avisa dentro del horizonte en el que todavía se puede hacer algo.
 *    Una salida a cuatro meses no admite ninguna decisión hoy.
 *  · Una previsión sin confianza NO genera alerta de ocupación baja. Decirle a
 *    alguien «cancela el autobús» basándose en dos salidas pasadas es peor que
 *    no decirle nada.
 *  · Lo que sí se avisa siempre es lo que no necesita previsión: cero ventas a
 *    tres días, y la sobreventa.
 */
export function departureAlerts(
  departures: DepartureSnapshot[],
  curve: PickupCurve,
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): Alert[] {
  const alerts: Alert[] = [];

  for (const departure of departures) {
    if (departure.daysOut > thresholds.horizonDays) continue;
    const forecast = forecastOccupancy({
      soldSeats: departure.soldSeats,
      capacity: departure.capacity,
      daysOut: departure.daysOut,
      curve,
    });

    const base = {
      departureId: departure.id,
      product: departure.product,
      travelAt: departure.travelAt,
      expectedPct: forecast.expectedPct,
      confidence: forecast.confidence,
    };

    // La sobreventa no necesita previsión ni confianza: ya pasó.
    if (departure.capacity > 0 && departure.soldSeats > departure.capacity) {
      alerts.push({
        ...base, kind: "over_capacity", severity: "critical",
        message: `Sobreventa: ${departure.soldSeats} plazas vendidas sobre ${departure.capacity}.`,
      });
      continue;
    }

    // Cero ventas a pocos días tampoco: es un hecho, no un pronóstico.
    if (departure.soldSeats === 0 && departure.daysOut <= thresholds.urgentDays) {
      alerts.push({
        ...base, kind: "no_pickup", severity: "warning",
        message: `Sin ninguna reserva y sale en ${departure.daysOut} día(s).`,
      });
      continue;
    }

    if (forecast.confidence === "none") continue;

    if (forecast.expectedPct < thresholds.lowPct) {
      alerts.push({
        ...base, kind: "low_occupancy",
        severity: departure.daysOut <= thresholds.urgentDays ? "warning" : "info",
        message: `Va camino del ${forecast.expectedPct} % de ocupación.`,
      });
    } else if (forecast.expectedPct >= thresholds.highPct) {
      alerts.push({
        ...base, kind: "almost_full", severity: "info",
        message: `Va camino de llenarse (${forecast.expectedPct} %): conviene asegurar vehículo y guía.`,
      });
    }
  }

  // Lo más grave y lo más próximo, primero: una lista ordenada por id es una
  // lista que nadie termina de leer.
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return a.travelAt < b.travelAt ? -1 : a.travelAt > b.travelAt ? 1 : 0;
  });
}
