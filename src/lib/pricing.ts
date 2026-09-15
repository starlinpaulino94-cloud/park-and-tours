import "server-only";
import { costLines, costTotal, type CostBasis, type CostTariff } from "@/lib/supplier-settlement";
import { tenantQuery } from "@/lib/tenant";
import type {
  Channel, Currency, PriceRule, PriceSnapshot, Product, ProductModality,
} from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * PricingEngine — resolves the unit price for a sale and captures an immutable
 * snapshot. Historical bookings are never re-priced when catalogue prices change.
 *
 * Rule priority (most specific first):
 *   1. seller + product/modality
 *   2. partner + product/modality
 *   3. channel + product/modality
 *   4. product/modality generic rule
 *   5. modality price
 *   6. product base price
 */

export interface PriceInput {
  companyId: string;
  productId: string;
  modalityId?: string | null;
  partnerId?: string | null;
  sellerId?: string | null;
  channel?: Channel | null;
  quantity: number;
  travelDate?: string | null;
  discountPct?: number;
  taxPct?: number;
  exchangeRate?: number;
  /**
   * Precio unitario pactado que sustituye al del catálogo.
   *
   * Un precio de grupo se negocia una vez y se firma en la cotización: volver a
   * calcularlo al convertirla en reserva le cobraría al cliente algo distinto de
   * lo que aceptó. Solo lo fija el servidor (la conversión de una cotización
   * aceptada); nunca llega desde el navegador, o cualquiera podría venderse un
   * tour a cero.
   */
  unitPriceOverride?: number | null;
  /** Moneda en la que se pactó ese precio; manda sobre la del catálogo. */
  overrideCurrency?: Currency | null;
  /** Cotización que fijó ese precio, para el snapshot inmutable. */
  quoteId?: string | null;
}

/**
 * Pax that actually pay: infants travel free. The POS quote and the real sale
 * must use this same rule or the price shown would not match the price charged.
 */
export function billablePax(adults = 0, children = 0): number {
  return Math.max(1, adults + children);
}

export interface PriceResult {
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: Currency;
  snapshot: PriceSnapshot;
  appliedRule: PriceRule | null;
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function ruleSpecificity(rule: PriceRule): number {
  const hasSeller = !!refId(rule.seller);
  const hasPartner = !!refId(rule.partner);
  const hasModality = !!refId(rule.modality);
  const hasChannel = !!rule.channel;
  if (hasSeller && hasModality) return 1;
  if (hasSeller) return 2;
  if (hasPartner && hasModality) return 3;
  if (hasPartner) return 4;
  if (hasChannel && hasModality) return 5;
  if (hasChannel) return 6;
  if (hasModality) return 7;
  return 8;
}

function ruleApplies(rule: PriceRule, input: PriceInput): boolean {
  if (rule.status === "inactive") return false;
  if (refId(rule.product) !== input.productId) return false;

  const ruleModality = refId(rule.modality);
  if (ruleModality && ruleModality !== input.modalityId) return false;

  const rulePartner = refId(rule.partner);
  if (rulePartner && rulePartner !== input.partnerId) return false;

  const ruleSeller = refId(rule.seller);
  if (ruleSeller && ruleSeller !== input.sellerId) return false;

  if (rule.channel && input.channel && rule.channel !== input.channel) return false;

  if (rule.min_qty != null && input.quantity < rule.min_qty) return false;
  if (rule.max_qty != null && input.quantity > rule.max_qty) return false;

  const date = input.travelDate ? new Date(input.travelDate) : null;
  if (date && !Number.isNaN(date.getTime())) {
    if (rule.season_from && date < new Date(rule.season_from)) return false;
    if (rule.season_to && date > new Date(rule.season_to)) return false;
    if (rule.weekdays && rule.weekdays.length > 0) {
      const key = WEEKDAY_KEYS[date.getDay()];
      if (!rule.weekdays.includes(key)) return false;
    }
  }
  return true;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function resolvePrice(input: PriceInput): Promise<PriceResult> {
  const [products, modalities, rules] = await Promise.all([
    tenantQuery<Product>(input.companyId, "product", { _filter: { _id: input.productId }, _limit: 1 }),
    input.modalityId
      ? tenantQuery<ProductModality>(input.companyId, "product_modality", {
          _filter: { _id: input.modalityId },
          _limit: 1,
        })
      : Promise.resolve([] as ProductModality[]),
    tenantQuery<PriceRule>(input.companyId, "price_rule", {
      _filter: { status: "active", product: input.productId },
      _limit: 300,
    }),
  ]);

  const product = products[0] ?? null;
  if (!product) throw new Error("Producto no encontrado");
  const modality = modalities[0] ?? null;

  const override = input.unitPriceOverride;
  const negotiated =
    override !== null && override !== undefined &&
    Number.isFinite(Number(override)) && Number(override) >= 0;

  const candidates = rules.filter((r) => ruleApplies(r, input));
  candidates.sort((a, b) => {
    const pa = a.priority ?? ruleSpecificity(a);
    const pb = b.priority ?? ruleSpecificity(b);
    if (pa !== pb) return pa - pb;
    return ruleSpecificity(a) - ruleSpecificity(b);
  });
  // Con un precio pactado no hay regla aplicada: decirlo sería atribuirle al
  // catálogo un precio que salió de la negociación.
  const appliedRule = negotiated ? null : (candidates[0] ?? null);

  const basePrice = modality?.price ?? product.base_price ?? 0;
  const unitPrice = negotiated ? round2(Number(override)) : (appliedRule?.amount ?? basePrice);
  const currency = (negotiated && input.overrideCurrency
    ? input.overrideCurrency
    : appliedRule?.currency || modality?.currency || product.currency || "usd") as Currency;

  // Un precio negociado es el precio de la línea tal cual se cotizó: la regla
  // del catálogo ya no decide si se multiplica por pax.
  const isGroupPrice =
    appliedRule?.price_type === "per_group" || appliedRule?.price_type === "per_vehicle";
  const grossAmount = round2(isGroupPrice ? unitPrice : unitPrice * input.quantity);

  // AUD-F02: clamp discount to [0,100]. A client-supplied discount >100 (or
  // negative) previously produced negative totals/balances, and a booking with
  // a negative total corrupts order totals and dashboard KPIs.
  const discountPct = Math.min(100, Math.max(0, input.discountPct ?? 0));
  const discountAmount = round2((grossAmount * discountPct) / 100);
  const netAmount = round2(grossAmount - discountAmount);
  // AUD-F02: tax percentage cannot be negative.
  const taxPct = Math.max(0, input.taxPct ?? 0);
  const taxAmount = round2((netAmount * taxPct) / 100);
  const totalAmount = round2(netAmount + taxAmount);

  const snapshot: PriceSnapshot = {
    base_price: basePrice,
    applied_rule_id: appliedRule?._id ?? null,
    applied_rule_name: appliedRule?.name ?? null,
    modality_name: modality?.name ?? null,
    unit_price: unitPrice,
    quantity: input.quantity,
    discount_pct: discountPct,
    tax_pct: taxPct,
    currency,
    exchange_rate: input.exchangeRate ?? 1,
    captured_at: new Date().toISOString(),
    price_source: negotiated ? "quote" : "catalog",
    quote_id: negotiated ? input.quoteId ?? null : null,
  };

  console.log(
    `[PricingEngine] producto=${product.name} modalidad=${modality?.name ?? "-"} unit=${unitPrice} ${currency} regla=${appliedRule?.name ?? "base"}`
  );

  return { unitPrice, grossAmount, discountAmount, taxAmount, totalAmount, currency, snapshot, appliedRule };
}

/**
 * Las tarifas de proveedor activas de un producto.
 *
 * Se expone porque el devengo por proveedor y el costo total tienen que salir de
 * las MISMAS tarifas: con dos consultas distintas basta que una filtre por
 * estado y la otra no para que el margen y lo que se le paga al proveedor dejen
 * de cuadrar.
 */
export async function loadCostTariffs(
  companyId: string,
  productId: string
): Promise<CostTariff[]> {
  return tenantQuery<CostTariff>(companyId, "product_cost", {
    _filter: { product: productId, status: "active" },
    _limit: 100,
    supplier: true,
  });
}

/**
 * Costo total de proveedores de una reserva, para el margen.
 *
 * Es la SUMA de las líneas por proveedor (`costLines`), no un cálculo aparte:
 * antes esta función recorría las tarifas por su cuenta y tiraba el proveedor,
 * así que el costo servía para el margen y para nada más —con él no se podía
 * pagar a nadie— y cualquier arreglo en un lado dejaba el otro desviado.
 */
export async function resolveCost(
  companyId: string,
  productId: string,
  quantity: number,
  fallbackUnitCost = 0,
  basis: Partial<CostBasis> = {}
): Promise<number> {
  const tariffs = await loadCostTariffs(companyId, productId);
  if (tariffs.length === 0) return round2(fallbackUnitCost * quantity);
  return costTotal(costLines(tariffs, { pax: quantity, ...basis }));
}
