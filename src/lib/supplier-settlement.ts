/**
 * Lo que se le debe al proveedor que operó el servicio.
 *
 * Una operadora no opera nada: subcontrata. El transportista pone el autobús, el
 * restaurante el almuerzo, el parque la entrada, el guía freelance el día. Eso
 * es el dinero que de verdad sale cada semana, y hasta ahora el sistema no sabía
 * cuánto ni a quién: `product_cost` guardaba el costo por proveedor y el
 * cálculo los sumaba todos en un número tirando el proveedor a la basura.
 *
 * Aquí viven las tres cosas que tienen enjundia:
 *
 *  · **El desglose por proveedor.** La misma excursión le debe 1.200 al autobús
 *    y 800 al restaurante. Un total agregado sirve para el margen y para nada
 *    más: con él no se puede pagar a nadie.
 *
 *  · **La conciliación.** El proveedor factura 40 pax y el manifiesto dice 37.
 *    Esa diferencia es la conversación de cada viernes, y hay que poder verla
 *    antes de firmar la transferencia.
 *
 *  · **Las retenciones.** En la República Dominicana, contratar a una persona
 *    física obliga a retener ISR sobre los honorarios y una parte del ITBIS
 *    facturado. Pagar el bruto no es un descuido: es un problema con la DGII.
 */

export type CostType =
  | "per_person" | "per_group" | "per_departure" | "per_vehicle" | "percentage" | "fixed";

export type CostStatus =
  | "accrued" | "confirmed" | "disputed" | "settled" | "paid" | "cancelled" | "waived";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampPct = (v: unknown) => Math.min(Math.max(num(v), 0), 100);

/* ------------------------------------------------- el desglose por proveedor */

/** Una tarifa de `product_cost`: lo que cobra un proveedor por un concepto. */
export interface CostTariff {
  _id?: string | null;
  supplier?: unknown;
  concept?: string | null;
  cost_type?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
}

/** Sobre qué se aplica cada tarifa. */
export interface CostBasis {
  /** Pax que consumen el servicio (los que pagan; un bebé no ocupa almuerzo). */
  pax: number;
  /** Grupos: normalmente uno por reserva. */
  groups?: number;
  /** Vehículos asignados a la salida. */
  vehicles?: number;
  /** Venta bruta de la línea, para las tarifas por porcentaje. */
  revenue?: number;
}

export interface CostLine {
  tariffId: string | null;
  supplierId: string | null;
  concept: string;
  costType: CostType;
  quantity: number;
  unitCost: number;
  amount: number;
  currency: string;
}

const refId = (value: unknown): string | null => {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") return (value as { _id?: string })._id ?? null;
  return null;
};

const COST_TYPES = new Set<CostType>([
  "per_person", "per_group", "per_departure", "per_vehicle", "percentage", "fixed",
]);

/**
 * Cuántas unidades se le pagan a una tarifa.
 *
 * Un tipo desconocido se cobra por persona, que es el caso mayoritario y el
 * comportamiento que ya tenía el cálculo del costo: cambiarlo a cero haría
 * desaparecer en silencio un costo que sí se paga.
 */
export function costQuantity(costType: string | null | undefined, basis: CostBasis): number {
  const pax = Math.max(0, num(basis.pax));
  switch (costType) {
    case "per_group":
    case "per_departure":
    case "fixed":
      return Math.max(1, Math.trunc(num(basis.groups) || 1));
    case "per_vehicle":
      // Sin dato de vehículos se cobra UNA vez, que es lo que hacía el cálculo
      // del costo y lo único que se puede suponer al vender: a esa hora no se
      // sabe con cuántas guaguas va a salir. Un cero EXPLÍCITO sí es cero —la
      // salida no tiene vehículo asignado y no hay nada que pagarle.
      return basis.vehicles === undefined || basis.vehicles === null
        ? 1
        : Math.max(0, Math.trunc(num(basis.vehicles)));
    case "percentage":
      return 1;
    case "per_person":
      return pax;
    default:
      return pax;
  }
}

/**
 * El costo de un servicio, línea por línea y con su proveedor.
 *
 * Es el reemplazo del total agregado: la suma de estas líneas es exactamente el
 * costo de la reserva, así que el margen y lo que se le debe a cada proveedor
 * salen del mismo cálculo y no pueden discrepar.
 */
export function costLines(
  tariffs: CostTariff[] | null | undefined,
  basis: CostBasis,
  fallbackCurrency = "usd"
): CostLine[] {
  const out: CostLine[] = [];
  for (const tariff of tariffs ?? []) {
    if (tariff.status && tariff.status !== "active") continue;
    const rawType = String(tariff.cost_type || "per_person");
    const costType = (COST_TYPES.has(rawType as CostType) ? rawType : "per_person") as CostType;
    const unitCost = Math.max(0, num(tariff.amount));

    let quantity: number;
    let amount: number;
    if (costType === "percentage") {
      // Un porcentaje se aplica sobre la venta, no sobre los pax.
      quantity = 1;
      amount = round2((Math.max(0, num(basis.revenue)) * clampPct(unitCost)) / 100);
    } else {
      quantity = costQuantity(costType, basis);
      amount = round2(unitCost * quantity);
    }
    // Una línea que no debe nada no se devenga: un porcentaje sin venta o una
    // tarifa por vehículo sin vehículos asignados no es una deuda con el
    // proveedor, y emitirla llenaría de ceros la lista de lo que hay que pagar.
    if (amount <= 0) continue;

    out.push({
      tariffId: tariff._id ?? null,
      supplierId: refId(tariff.supplier),
      concept: tariff.concept || "Servicio operado",
      costType,
      quantity,
      unitCost,
      amount,
      currency: String(tariff.currency || fallbackCurrency).toLowerCase(),
    });
  }
  return out;
}

export function costTotal(lines: CostLine[] | null | undefined): number {
  return round2((lines ?? []).reduce((sum, line) => sum + num(line.amount), 0));
}

/** Lo mismo agrupado por proveedor: es la vista con la que se paga. */
export function costBySupplier(
  lines: CostLine[] | null | undefined
): { supplierId: string | null; currency: string; amount: number; lines: CostLine[] }[] {
  const groups = new Map<string, { supplierId: string | null; currency: string; amount: number; lines: CostLine[] }>();
  for (const line of lines ?? []) {
    const key = `${line.supplierId ?? "sin-proveedor"}:${line.currency}`;
    const group = groups.get(key) || {
      supplierId: line.supplierId, currency: line.currency, amount: 0, lines: [],
    };
    group.amount = round2(group.amount + line.amount);
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------ conciliación */

export interface AccruedCost {
  _id?: string;
  amount?: number | null;
  confirmed_amount?: number | null;
  status?: string | null;
}

export type ReconcileVerdict = "pending" | "match" | "over" | "under";

/**
 * Lo facturado contra lo operado.
 *
 * `over` es que el proveedor cobra más de lo que se operó —el caso que hay que
 * discutir—; `under` que cobra menos, que también hay que mirar porque suele
 * significar que se le olvidó una salida.
 */
export function reconcile(
  cost: AccruedCost,
  tolerance = 0
): { accrued: number; confirmed: number | null; variance: number; verdict: ReconcileVerdict } {
  const accrued = round2(num(cost.amount));
  if (cost.confirmed_amount === null || cost.confirmed_amount === undefined) {
    return { accrued, confirmed: null, variance: 0, verdict: "pending" };
  }
  const confirmed = round2(num(cost.confirmed_amount));
  const variance = round2(confirmed - accrued);
  const limit = Math.abs(num(tolerance)) + 0.009;
  if (Math.abs(variance) <= limit) return { accrued, confirmed, variance, verdict: "match" };
  return { accrued, confirmed, variance, verdict: variance > 0 ? "over" : "under" };
}

/* -------------------------------------------------------------- retenciones */

export type TaxRegime = "company" | "individual" | "informal";

export interface RetentionPolicy {
  tax_regime?: string | null;
  retention_isr_pct?: number | null;
  retention_itbis_pct?: number | null;
  /** ITBIS que el proveedor factura, para poder separarlo del importe bruto. */
  tax_rate?: number | null;
}

/**
 * Retenciones por defecto según el régimen del proveedor.
 *
 * Son un punto de partida razonable para la República Dominicana, NO una
 * afirmación de lo que tu contador tiene que aplicar: las tasas y a quién
 * alcanzan cambian con la norma y con el tipo de servicio. Cada proveedor
 * guarda sus propios porcentajes y, en cuanto están puestos, mandan sobre
 * estos. Una empresa formal no se le retiene nada por defecto; a una persona
 * física se le retiene ISR por honorarios y el ITBIS facturado.
 */
export const DEFAULT_RETENTIONS: Record<TaxRegime, { isr: number; itbis: number }> = {
  company: { isr: 0, itbis: 0 },
  individual: { isr: 10, itbis: 100 },
  // Sin comprobante no hay ITBIS que retener, pero el ISR sigue aplicando.
  informal: { isr: 10, itbis: 0 },
};

export interface Retentions {
  /** Base imponible: el importe sin el ITBIS. */
  base: number;
  /** ITBIS contenido en el importe facturado. */
  tax: number;
  isrPct: number;
  itbisPct: number;
  isr: number;
  itbis: number;
  total: number;
}

/**
 * Qué se le retiene de una factura de proveedor.
 *
 * El importe que entra es el BRUTO facturado. El ITBIS se separa de él —no se
 * suma encima— porque es lo que el proveedor puso en su comprobante: el ISR se
 * retiene sobre los honorarios y el ITBIS sobre el impuesto, y aplicarlos los
 * dos sobre el bruto retendría de más.
 */
export function retentionsFor(
  policy: RetentionPolicy | null | undefined,
  invoicedTotal: number
): Retentions {
  const gross = round2(Math.max(num(invoicedTotal), 0));
  const regime = (policy?.tax_regime as TaxRegime) || "company";
  const defaults = DEFAULT_RETENTIONS[regime] ?? DEFAULT_RETENTIONS.company;

  const isrPct = policy?.retention_isr_pct == null ? defaults.isr : clampPct(policy.retention_isr_pct);
  const itbisPct = policy?.retention_itbis_pct == null ? defaults.itbis : clampPct(policy.retention_itbis_pct);
  const taxRate = clampPct(policy?.tax_rate);

  const base = taxRate > 0 ? round2(gross / (1 + taxRate / 100)) : gross;
  const tax = round2(gross - base);

  const isr = round2((base * isrPct) / 100);
  const itbis = round2((tax * itbisPct) / 100);
  return { base, tax, isrPct, itbisPct, isr, itbis, total: round2(isr + itbis) };
}

/* --------------------------------------------------------- totales y estado */

export interface SettlementTotalsInput {
  /** Lo devengado por el manifiesto. */
  services: number;
  /** Lo que el proveedor factura. Nulo mientras no haya facturado. */
  confirmed?: number | null;
  /** Ajustes acordados: penalidades, cortesías, notas de crédito. */
  adjustments?: number | null;
  retentions?: Retentions | null;
}

export interface SettlementTotals {
  services: number;
  confirmed: number;
  adjustments: number;
  retentions: number;
  /** Lo que sale del banco. */
  net: number;
}

/**
 * Los totales de una liquidación.
 *
 * Se paga sobre lo FACTURADO, no sobre lo devengado: el devengo es la cuenta de
 * la empresa y el que manda mientras el proveedor no facture, pero en cuanto
 * factura, el documento es el suyo y las retenciones se calculan sobre él.
 */
export function settlementTotals(input: SettlementTotalsInput): SettlementTotals {
  const services = round2(Math.max(num(input.services), 0));
  const confirmed = input.confirmed == null ? services : round2(Math.max(num(input.confirmed), 0));
  const adjustments = round2(num(input.adjustments));
  const retentions = round2(Math.max(num(input.retentions?.total), 0));
  // Nunca negativo: un ajuste que se come la liquidación entera no genera una
  // transferencia al revés, deja el neto en cero y una conversación pendiente.
  const net = Math.max(0, round2(confirmed - retentions + adjustments));
  return { services, confirmed, adjustments, retentions, net };
}

export type SettlementState =
  | "pending" | "approved" | "partially_paid" | "paid" | "held" | "disputed" | "void";

export type PayBlock = "already_paid" | "void" | "disputed" | "nothing_due" | "not_confirmed";

export const PAY_BLOCK_MESSAGE: Record<PayBlock, string> = {
  already_paid: "La liquidación ya fue pagada",
  void: "La liquidación está anulada",
  disputed: "La liquidación está en disputa: resuélvela antes de pagar",
  nothing_due: "No queda nada por pagar en esta liquidación",
  not_confirmed: "Falta la factura del proveedor: sin comprobante no se puede pagar el gasto",
};

/**
 * Por qué no se puede pagar una liquidación.
 *
 * `not_confirmed` solo aplica a proveedores: el gasto se sostiene ante la DGII
 * con el comprobante del proveedor, y pagar sin él deja un gasto que no se
 * puede deducir. Una liquidación de comisiones no lleva factura de nadie.
 */
export function payBlocker(
  settlement: {
    status?: string | null;
    beneficiary_type?: string | null;
    net_total?: number | null;
    commission_total?: number | null;
    paid_total?: number | null;
    supplier_invoice_number?: string | null;
  },
  opts: { requireInvoice?: boolean } = {}
): PayBlock | null {
  const status = settlement.status || "";
  if (status === "paid") return "already_paid";
  if (status === "void") return "void";
  if (status === "disputed") return "disputed";

  const isSupplier = settlement.beneficiary_type === "supplier";
  const total = isSupplier
    ? round2(num(settlement.net_total))
    : round2(num(settlement.commission_total));
  const outstanding = round2(total - num(settlement.paid_total));
  if (outstanding <= 0.009) return "nothing_due";

  if (isSupplier && opts.requireInvoice !== false && !settlement.supplier_invoice_number) {
    return "not_confirmed";
  }
  return null;
}

/** Cómo queda una liquidación tras cobrar un abono. */
export function stateAfterPayment(
  total: number,
  alreadyPaid: number,
  payment: number
): { paid: number; outstanding: number; status: SettlementState } {
  const gross = round2(Math.max(num(total), 0));
  const paid = round2(Math.min(gross, Math.max(num(alreadyPaid), 0) + Math.max(num(payment), 0)));
  const outstanding = round2(gross - paid);
  return {
    paid,
    outstanding,
    status: outstanding <= 0.009 ? "paid" : paid > 0.009 ? "partially_paid" : "pending",
  };
}
