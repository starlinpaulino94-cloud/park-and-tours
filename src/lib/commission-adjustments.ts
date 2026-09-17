/**
 * CORREGIR UNA COMISIÓN SIN REESCRIBIR LA HISTORIA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * Cancelar una reserva ponía sus comisiones `pending` y `approved` en
 * `cancelled`, y a las `settled` y `paid` **no las tocaba**. O sea: el dinero
 * salió, la venta se cayó, y en el sistema no quedaba ni rastro de que hubiera
 * que recuperarlo. La liquidación del mes siguiente cuadraba con una venta que
 * ya no existe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN AJUSTE Y NO UNA EDICIÓN
 *
 * Bajar el importe de la comisión a cero deja el histórico diciendo que siempre
 * fue cero. Un ajuste con signo deja LAS DOS CIFRAS a la vista: lo que se pagó
 * y lo que se descuenta, con su motivo y su fecha. Es la única forma de que la
 * liquidación de hace seis semanas se pueda defender.
 *
 * Es la misma regla que el resto del sistema: nunca borrar, siempre anotar. Un
 * pago anulado es un movimiento nuevo; un devengo cancelado deja su rastro; una
 * atribución no se edita.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL NETO NUNCA ES NEGATIVO
 *
 * Si los ajustes se comen más que el importe, el neto se queda en cero. Una
 * comisión no se convierte en una deuda del vendedor: lo que se le haya pagado
 * de más se persigue por otra vía —la siguiente liquidación, una conversación—
 * y no dejando un número en rojo que la pantalla de liquidaciones sumaría como
 * si fuera cobrable.
 *
 * Todo lo de aquí es puro.
 */

export const COMMISSION_STATES = [
  "pending", "approved", "settled", "paid", "cancelled", "held", "disputed",
] as const;
export type CommissionState = (typeof COMMISSION_STATES)[number];

export const ADJUSTMENT_REASONS = [
  "cancellation", "refund", "correction", "bonus", "clawback", "other",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  cancellation: "Venta cancelada",
  refund: "Reembolso al cliente",
  correction: "Corrección",
  bonus: "Premio pactado",
  clawback: "Devolución de lo pagado de más",
  other: "Otro",
};

export function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return typeof value === "string" && (ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

/**
 * Los estados en los que el dinero YA SALIÓ.
 *
 * Es la lista que decide si una cancelación anula o ajusta, y por eso vive
 * aquí y no repartida por las rutas: añadir un estado nuevo sin pensarlo haría
 * que una comisión pagada se anulara en silencio.
 */
export const MONEY_IS_OUT = new Set<CommissionState>(["settled", "paid"]);

/** Los estados que todavía se pueden anular sin mover dinero. */
export const VOIDABLE = new Set<CommissionState>(["pending", "approved", "held", "disputed"]);

export function round2(n: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

export interface Adjustment {
  amount?: number | null;
}

/** La suma firmada de los ajustes. Positivos y negativos, tal cual. */
export function adjustmentTotal(adjustments: Adjustment[] | null | undefined): number {
  if (!adjustments?.length) return 0;
  return round2(adjustments.reduce((sum, a) => sum + (Number(a.amount) || 0), 0));
}

/** Lo que se le debe HOY: el importe más los ajustes, nunca por debajo de cero. */
export function netCommission(amount: number, adjustments: Adjustment[] | null | undefined): number {
  return round2(Math.max(0, round2(amount) + adjustmentTotal(adjustments)));
}

export interface CancellationEffect {
  /** 'void' = anular la comisión; 'adjust' = ajustarla con signo; 'none' = nada que hacer. */
  action: "void" | "adjust" | "none";
  /** Importe FIRMADO del ajuste, cuando toca ajustar. */
  amount: number;
  reason: string;
  reasonCode: AdjustmentReason;
}

/**
 * Qué hacer con una comisión cuando su venta se cae.
 *
 * La decisión depende de si el dinero ya salió, y no del capricho de quien
 * cancela:
 *
 *  · Nada cobrado todavía → se anula. No hay nada que corregir.
 *  · Ya liquidada o pagada → se AJUSTA en negativo por su neto vivo. La
 *    comisión sigue diciendo que se pagó, y el ajuste dice que se descontó.
 *  · Ya anulada, o con el neto en cero → nada. Ajustar dos veces descontaría
 *    dos veces, que es el error clásico de un reintento del cron.
 */
export function cancellationEffect(
  commission: { status?: string | null; amount?: number | null },
  adjustments: Adjustment[] | null | undefined,
  reference: string
): CancellationEffect {
  const status = (commission.status || "pending") as CommissionState;
  const net = netCommission(Number(commission.amount ?? 0), adjustments);
  const motivo = `Reserva ${reference} cancelada`.slice(0, 300);

  if (status === "cancelled") return { action: "none", amount: 0, reason: motivo, reasonCode: "cancellation" };

  if (MONEY_IS_OUT.has(status)) {
    if (net <= 0) return { action: "none", amount: 0, reason: motivo, reasonCode: "cancellation" };
    return { action: "adjust", amount: round2(-net), reason: motivo, reasonCode: "cancellation" };
  }

  if (VOIDABLE.has(status)) return { action: "void", amount: 0, reason: motivo, reasonCode: "cancellation" };

  return { action: "none", amount: 0, reason: motivo, reasonCode: "cancellation" };
}

/**
 * Transiciones permitidas. `paid` es terminal: el dinero salió, y lo que se
 * corrige se corrige con un ajuste, no reescribiendo el estado.
 */
const TRANSITIONS: Record<CommissionState, CommissionState[]> = {
  pending: ["approved", "held", "disputed", "cancelled"],
  approved: ["settled", "held", "disputed", "cancelled"],
  settled: ["paid", "disputed"],
  paid: [],
  cancelled: ["pending"],
  held: ["pending", "approved", "cancelled"],
  disputed: ["pending", "approved", "cancelled"],
};

export function canTransition(from: CommissionState, to: CommissionState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Por qué NO se puede, en palabras que entienda quien lo intentó.
 *
 * Un «no permitido» a secas hace que la persona lo intente por otro camino —el
 * editor de SQL, normalmente— y ahí ya no hay quien lo pare.
 */
export function transitionBlocker(from: CommissionState, to: CommissionState): string | null {
  if (canTransition(from, to)) return null;
  if (from === to) return "Ya está en ese estado.";
  if (from === "paid") {
    return "Esta comisión ya se pagó. Lo que haya que corregir se hace con un ajuste, no borrando el pago.";
  }
  if (from === "settled" && to !== "paid") {
    return "Esta comisión está dentro de una liquidación. Se gestiona desde ahí, o se corrige con un ajuste.";
  }
  if (from === "cancelled") {
    return "Esta comisión está anulada. Si hay que reactivarla, vuelve a dejarla pendiente primero.";
  }
  return `No se puede pasar de «${from}» a «${to}».`;
}

/** Un ajuste pedido a mano: qué le falta para poder guardarse. */
export function adjustmentBlocker(input: {
  amount?: unknown;
  reason?: unknown;
  status?: string | null;
}): string | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || round2(amount) === 0) {
    return "Un ajuste de cero no ajusta nada. Escribe cuánto sube o cuánto baja.";
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3) {
    // Un movimiento de dinero sin motivo es exactamente lo que hace imposible
    // defender una liquidación seis semanas después.
    return "Escribe el motivo del ajuste: sin él, dentro de un mes nadie sabrá por qué está ahí.";
  }
  if ((input.status || "") === "cancelled") {
    return "Esta comisión está anulada: no hay nada sobre lo que ajustar.";
  }
  return null;
}
