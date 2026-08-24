import "server-only";
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

  const candidates = rules.filter((r) => ruleApplies(r, input));
  candidates.sort((a, b) => {
    const pa = a.priority ?? ruleSpecificity(a);
    const pb = b.priority ?? ruleSpecificity(b);
    if (pa !== pb) return pa - pb;
    return ruleSpecificity(a) - ruleSpecificity(b);
  });
  const appliedRule = candidates[0] ?? null;

  const basePrice = modality?.price ?? product.base_price ?? 0;
  const unitPrice = appliedRule?.amount ?? basePrice;
  const currency = (appliedRule?.currency || modality?.currency || product.currency || "usd") as Currency;

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
  };

  console.log(
    `[PricingEngine] producto=${product.name} modalidad=${modality?.name ?? "-"} unit=${unitPrice} ${currency} regla=${appliedRule?.name ?? "base"}`
  );

  return { unitPrice, grossAmount, discountAmount, taxAmount, totalAmount, currency, snapshot, appliedRule };
}

/** Total supplier cost for a booking, used for margin/profitability. */
export async function resolveCost(
  companyId: string,
  productId: string,
  quantity: number,
  fallbackUnitCost = 0
): Promise<number> {
  const costs = await tenantQuery<{ cost_type?: string; amount?: number }>(companyId, "product_cost", {
    _filter: { product: productId, status: "active" },
    _limit: 100,
  });
  if (costs.length === 0) return round2(fallbackUnitCost * quantity);

  let total = 0;
  for (const c of costs) {
    const amount = c.amount ?? 0;
    switch (c.cost_type) {
      case "per_person":
        total += amount * quantity;
        break;
      case "per_group":
      case "per_departure":
      case "per_vehicle":
      case "fixed":
        total += amount;
        break;
      case "percentage":
        break; // applied on revenue by the caller when needed
      default:
        total += amount * quantity;
    }
  }
  return round2(total);
}
