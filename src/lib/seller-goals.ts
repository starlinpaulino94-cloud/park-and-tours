/**
 * METAS COMERCIALES Y BONOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA META QUE HABÍA
 *
 * `seller.monthly_goal` es un número. Un solo número, sin unidad declarada
 * —¿pesos? ¿pasajeros? ¿ventas?— y sin más periodo que «el mes».
 *
 * Lo que una operadora pone de verdad en una reunión de lunes:
 *
 *   «Este mes, el equipo de playa: 40 ventas y 150 pasajeros.»
 *   «Los hoteles: 30 clientes nuevos captados, el resto me da igual.»
 *   «Rafael, en la excursión a Saona, 20 reservas de aquí al 15.»
 *
 * Ninguna de las tres cabe en un número.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO SE PINTA LO QUE LA META DICE
 *
 * Las cinco dimensiones son independientes y todas pueden ir vacías. Una meta
 * de pasajeros NO debe enseñar una barra de ingresos en cero: esa barra no
 * significa nada y hace que el vendedor lea que va fatal en algo que nadie le
 * pidió. Vacío es «esta meta no habla de eso», que no es cero.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BONO NO ES UNA COMISIÓN
 *
 * Una comisión nace de una venta concreta y se rastrea hasta su reserva. Un
 * bono nace de HABER LLEGADO a algo y no tiene reserva detrás. Y un premio en
 * especie —dos pases, una noche de hotel— tiene valor pero NO se transfiere:
 * sumarlo al total a pagar haría que la operadora transfiriera dinero por algo
 * que ya regaló.
 *
 * Todo lo de aquí es puro.
 */

// ── El periodo ──────────────────────────────────────────────────────────────

export const GOAL_PERIODS = ["daily", "weekly", "monthly", "range"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const PERIOD_LABEL: Record<GoalPeriod, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
  range: "Entre dos fechas",
};

export function normalizePeriod(value: unknown): GoalPeriod {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (GOAL_PERIODS as readonly string[]).includes(v) ? (v as GoalPeriod) : "monthly";
}

export interface DateRange {
  from: string;
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Las fechas que cubre la meta.
 *
 * La semana empieza el LUNES, no el domingo. En una operadora dominicana el
 * fin de semana es el pico de ventas: cortar la semana en mitad del sábado
 * partiría el dato que más importa en dos semanas distintas.
 */
export function rangeOf(
  goal: { period?: string | null; period_from?: string | null; period_to?: string | null },
  now: Date = new Date()
): DateRange {
  const period = normalizePeriod(goal.period);

  if (period === "range") {
    // Un rango sin fechas no acota nada. Se cae al mes, que al menos es algo
    // que se puede medir, en vez de devolver un rango vacío que no cumpliría
    // nadie.
    if (goal.period_from && goal.period_to) {
      return { from: goal.period_from.slice(0, 10), to: goal.period_to.slice(0, 10) };
    }
  }

  if (period === "daily") return { from: iso(now), to: iso(now) };

  if (period === "weekly") {
    const day = now.getUTCDay();          // 0 = domingo
    const backToMonday = (day + 6) % 7;   // lunes → 0, domingo → 6
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - backToMonday));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    return { from: iso(monday), to: iso(sunday) };
  }

  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Día 0 del mes siguiente es el último del actual, y acierta en febrero y en
  // los bisiestos sin tabla de días.
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: iso(first), to: iso(last) };
}

/** ¿Esta fecha cae dentro de la meta? */
export function coversDate(range: DateRange, when: unknown): boolean {
  if (typeof when !== "string" || !when) return false;
  const day = when.slice(0, 10);
  return day >= range.from && day <= range.to;
}

// ── Las cinco dimensiones ───────────────────────────────────────────────────

export const GOAL_METRICS = ["signups", "bookings", "sales", "pax", "revenue"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const METRIC_LABEL: Record<GoalMetric, string> = {
  signups: "Clientes captados",
  bookings: "Reservas",
  sales: "Ventas cerradas",
  pax: "Pasajeros",
  revenue: "Ingresos",
};

/** Cuáles son dinero: cambia cómo se formatean y si se pueden sumar entre monedas. */
export const MONEY_METRICS = new Set<GoalMetric>(["revenue"]);

const TARGET_FIELD: Record<GoalMetric, string> = {
  signups: "target_signups",
  bookings: "target_bookings",
  sales: "target_sales",
  pax: "target_pax",
  revenue: "target_revenue",
};

export interface GoalRow {
  _id?: string;
  name?: string | null;
  period?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  target_signups?: number | null;
  target_bookings?: number | null;
  target_sales?: number | null;
  target_pax?: number | null;
  target_revenue?: number | null;
  currency?: string | null;
  reward?: string | null;
  status?: string | null;
}

export interface Actuals {
  signups?: number;
  bookings?: number;
  sales?: number;
  pax?: number;
  revenue?: number;
}

export interface ProgressLine {
  metric: GoalMetric;
  label: string;
  target: number;
  actual: number;
  /** Porcentaje TOPADO a 100: pasarse está bien, pero la barra no se sale. */
  pct: number;
  /** Lo real sin topar, para poder decir «160 %» en el texto. */
  rawPct: number;
  met: boolean;
  isMoney: boolean;
  /** Lo que falta. Cero cuando ya se cumplió. */
  remaining: number;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * El progreso, línea por línea, SOLO de lo que la meta declara.
 *
 * Una meta de pasajeros no pinta una barra de ingresos en cero, porque esa
 * barra no significa nada y hace que el vendedor lea que va fatal en algo que
 * nadie le pidió.
 */
export function progressOf(goal: GoalRow, actuals: Actuals): ProgressLine[] {
  const lines: ProgressLine[] = [];

  for (const metric of GOAL_METRICS) {
    const target = num((goal as Record<string, unknown>)[TARGET_FIELD[metric]]);
    if (target <= 0) continue;

    const actual = num(actuals[metric]);
    const rawPct = Math.round((actual / target) * 1000) / 10;
    lines.push({
      metric,
      label: METRIC_LABEL[metric],
      target,
      actual,
      pct: Math.min(100, Math.round(rawPct)),
      rawPct,
      met: actual >= target,
      isMoney: MONEY_METRICS.has(metric),
      remaining: Math.max(0, Math.round((target - actual) * 100) / 100),
    });
  }

  return lines;
}

/**
 * ¿La meta está cumplida?
 *
 * TODAS sus dimensiones, no una cualquiera. «40 ventas y 150 pasajeros» es una
 * sola meta con dos condiciones: dar por buena la primera y pagar el premio
 * sería regalarlo a medias.
 *
 * Una meta sin ninguna dimensión declarada NO está cumplida — no se puede
 * cumplir algo que no se pidió, y devolver `true` pagaría premios por nada.
 */
export function isAchieved(lines: ProgressLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.met);
}

/** Cuánto le queda de media, para ordenar el tablero por «quién está más cerca». */
export function overallPct(lines: ProgressLine[]): number | null {
  if (lines.length === 0) return null;
  return Math.round(lines.reduce((sum, l) => sum + l.pct, 0) / lines.length);
}

/**
 * La condición congelada que se guarda con el bono.
 *
 * Sin ella, dentro de seis meses «Bono de septiembre · 100 USD» no se puede
 * defender ante nadie: la meta puede haberse editado o borrado, y lo que se
 * cumplió aquel día no.
 */
export function achievementSnapshot(goal: GoalRow, lines: ProgressLine[], range: DateRange) {
  return {
    goal_id: goal._id ?? null,
    goal_name: goal.name ?? null,
    period: normalizePeriod(goal.period),
    from: range.from,
    to: range.to,
    metrics: lines.map((l) => ({ metric: l.metric, target: l.target, reached: l.actual })),
    captured_at: new Date().toISOString(),
  };
}

// ── Los bonos ───────────────────────────────────────────────────────────────

export const PAYOUT_KINDS = ["cash", "in_kind"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

export const PAYOUT_KIND_LABEL: Record<PayoutKind, string> = {
  cash: "En efectivo (se transfiere)",
  in_kind: "En especie (ya entregado)",
};

export function normalizePayoutKind(value: unknown): PayoutKind {
  // El defecto es `cash` porque es lo que casi siempre es. Equivocarse hacia
  // `in_kind` sería peor: dejaría de transferirse dinero que sí se debía.
  return value === "in_kind" ? "in_kind" : "cash";
}

export const BONUS_STATES = ["pending", "approved", "settled", "paid", "cancelled"] as const;
export type BonusState = (typeof BONUS_STATES)[number];

/** Los estados en los que el bono todavía cuenta para pagar. */
export const PAYABLE_BONUS = new Set<BonusState>(["approved", "settled"]);

export interface BonusRow {
  amount?: number | null;
  payout_kind?: string | null;
  status?: string | null;
}

export interface BonusTotals {
  /** Lo que sale del banco. */
  cash: number;
  /** El valor de lo ya entregado: cuenta para el expediente, no se transfiere. */
  inKind: number;
  count: number;
}

/**
 * Lo que suman unos bonos, separando lo que se transfiere de lo que no.
 *
 * Es la razón de ser de `payout_kind`: sumar un pase regalado al total a pagar
 * haría que la operadora transfiriera dinero por algo que ya entregó.
 */
export function bonusTotals(bonuses: BonusRow[] | null | undefined): BonusTotals {
  let cash = 0;
  let inKind = 0;
  let count = 0;

  for (const bonus of bonuses ?? []) {
    const state = (bonus.status || "pending") as BonusState;
    if (!PAYABLE_BONUS.has(state)) continue;
    count += 1;
    const amount = num(bonus.amount);
    if (normalizePayoutKind(bonus.payout_kind) === "in_kind") inKind += amount;
    else cash += amount;
  }

  return {
    cash: Math.round(cash * 100) / 100,
    inKind: Math.round(inKind * 100) / 100,
    count,
  };
}

/**
 * El total que se le transfiere de verdad al vendedor.
 *
 * Las comisiones (su NETO tras ajustes, no su importe) más los bonos en
 * efectivo. Lo que está en especie no entra, y esa es toda la cuestión.
 */
export function payableTotal(commissionNet: number, totals: BonusTotals): number {
  return Math.round((num(commissionNet) + totals.cash) * 100) / 100;
}

/** Qué le falta a un bono para poder guardarse. */
export function bonusBlocker(input: {
  sellerId?: unknown;
  description?: unknown;
  amount?: unknown;
  payoutKind?: unknown;
}): string | null {
  if (typeof input.sellerId !== "string" || !input.sellerId) {
    return "Elige a quién se le da el bono.";
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length < 3) {
    // Un bono sin descripción no se puede explicar en una liquidación, y la
    // liquidación es donde alguien lo va a leer.
    return "Escribe de qué es el bono: es lo que se lee en la liquidación.";
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return "El importe del bono no es válido.";
  }
  if (normalizePayoutKind(input.payoutKind) === "in_kind" && amount <= 0) {
    // Un premio en especie sin valor declarado no se puede poner en el
    // expediente ni en la declaración de la operadora.
    return "Un premio en especie también tiene un valor: ponlo, aunque no se transfiera.";
  }
  return null;
}
