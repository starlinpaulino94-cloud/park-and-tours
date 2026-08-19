import "server-only";
import { totalumSdk } from "@/lib/totalum";
import type {
  BeneficiaryType, CalcType, CommissionRule, CommissionSnapshot,
  CommissionTier, Currency,
} from "@/lib/types";
import { refId } from "@/lib/types";
import { parseJson } from "@/lib/format";

/**
 * CommissionEngine
 * ----------------
 * Single place where commissions are resolved. Never compute commissions in a
 * component or inline in a route — always go through `resolveCommissions`.
 *
 * Rule priority (most specific wins). Lower number = evaluated first:
 *   1. seller + product
 *   2. partner + product
 *   3. product
 *   4. partner
 *   5. seller (standard)
 *   6. category
 *   7. channel
 *   8. company default
 *
 * A rule may override the computed specificity with its own `priority` field.
 * Once a commission is generated its snapshot is immutable: later edits to the
 * rule never change historical commissions.
 */

export interface CommissionInput {
  companyId: string;
  /** Amount the commission is calculated on (net of discounts, excl. taxes). */
  baseAmount: number;
  currency: Currency;
  productId?: string | null;
  categoryId?: string | null;
  partnerId?: string | null;
  sellerId?: string | null;
  supervisorId?: string | null;
  channel?: string | null;
  travelDate?: string | null;
  /** Accumulated sales in the period — used by tiered/volume rules. */
  periodSales?: number;
}

export interface ResolvedCommission {
  beneficiary_type: BeneficiaryType;
  beneficiary_name: string;
  seller?: string | null;
  partner?: string | null;
  rule?: string | null;
  base_amount: number;
  calc_type: CalcType;
  percentage: number;
  amount: number;
  currency: Currency;
  snapshot: CommissionSnapshot;
}

/** Specificity score — the lower, the more specific. */
export function specificityOf(rule: CommissionRule): number {
  const hasSeller = !!refId(rule.seller);
  const hasPartner = !!refId(rule.partner);
  const hasProduct = !!refId(rule.product);
  const hasCategory = !!refId(rule.category);
  const hasChannel = !!rule.channel;

  if (hasSeller && hasProduct) return 1;
  if (hasPartner && hasProduct) return 2;
  if (hasProduct) return 3;
  if (hasPartner) return 4;
  if (hasSeller) return 5;
  if (hasCategory) return 6;
  if (hasChannel) return 7;
  return 8;
}

function matchedCriteria(rule: CommissionRule): string[] {
  const out: string[] = [];
  if (refId(rule.seller)) out.push("seller");
  if (refId(rule.partner)) out.push("partner");
  if (refId(rule.product)) out.push("product");
  if (refId(rule.category)) out.push("category");
  if (rule.channel) out.push("channel");
  if (rule.season_from || rule.season_to) out.push("season");
  if (rule.min_sales || rule.max_sales) out.push("volume");
  if (out.length === 0) out.push("company_default");
  return out;
}

function withinSeason(rule: CommissionRule, travelDate?: string | null): boolean {
  if (!rule.season_from && !rule.season_to) return true;
  const d = travelDate ? new Date(travelDate) : new Date();
  if (Number.isNaN(d.getTime())) return true;
  if (rule.season_from && d < new Date(rule.season_from)) return false;
  if (rule.season_to && d > new Date(rule.season_to)) return false;
  return true;
}

function withinVolume(rule: CommissionRule, periodSales?: number): boolean {
  if (rule.min_sales == null && rule.max_sales == null) return true;
  const sales = periodSales ?? 0;
  if (rule.min_sales != null && sales < rule.min_sales) return false;
  if (rule.max_sales != null && sales > rule.max_sales) return false;
  return true;
}

/** Does the rule apply to this sale for the given beneficiary? */
function ruleApplies(rule: CommissionRule, input: CommissionInput, beneficiary: BeneficiaryType): boolean {
  if (rule.status === "inactive") return false;
  if ((rule.beneficiary_type || "seller") !== beneficiary) return false;

  const ruleProduct = refId(rule.product);
  if (ruleProduct && ruleProduct !== input.productId) return false;

  const ruleCategory = refId(rule.category);
  if (ruleCategory && ruleCategory !== input.categoryId) return false;

  const rulePartner = refId(rule.partner);
  if (rulePartner && rulePartner !== input.partnerId) return false;

  const ruleSeller = refId(rule.seller);
  if (ruleSeller) {
    const target = beneficiary === "supervisor" ? input.supervisorId : input.sellerId;
    if (ruleSeller !== target) return false;
  }

  if (rule.channel && input.channel && rule.channel !== input.channel) return false;
  if (!withinSeason(rule, input.travelDate)) return false;
  if (!withinVolume(rule, input.periodSales)) return false;

  return true;
}

/** Computes the payable amount for a rule. */
export function computeAmount(rule: CommissionRule, input: CommissionInput): { amount: number; percentage: number } {
  const base = input.baseAmount;
  const calc = (rule.calc_type || "percentage") as CalcType;

  if (calc === "fixed") {
    return { amount: round2(rule.value ?? 0), percentage: base > 0 ? round2(((rule.value ?? 0) / base) * 100) : 0 };
  }

  if (calc === "tiered" || calc === "volume") {
    const tiers = parseJson<CommissionTier[]>(rule.tiers, []);
    const yardstick = calc === "volume" ? input.periodSales ?? base : base;
    const sorted = [...tiers].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
    let picked: CommissionTier | null = null;
    for (const tier of sorted) {
      const from = tier.from ?? 0;
      const to = tier.to ?? Number.POSITIVE_INFINITY;
      if (yardstick >= from && yardstick <= to) picked = tier;
    }
    if (!picked) picked = sorted[0] ?? null;
    if (!picked) return { amount: 0, percentage: 0 };
    if ((picked.calc_type ?? "percentage") === "fixed") {
      return { amount: round2(picked.value), percentage: base > 0 ? round2((picked.value / base) * 100) : 0 };
    }
    return { amount: round2((base * picked.value) / 100), percentage: picked.value };
  }

  const pct = rule.value ?? 0;
  return { amount: round2((base * pct) / 100), percentage: pct };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Picks the winning rule for a beneficiary, or null when none applies. */
export function pickRule(
  rules: CommissionRule[],
  input: CommissionInput,
  beneficiary: BeneficiaryType
): CommissionRule | null {
  const candidates = rules.filter((r) => ruleApplies(r, input, beneficiary));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = a.priority ?? specificityOf(a);
    const pb = b.priority ?? specificityOf(b);
    if (pa !== pb) return pa - pb;
    return specificityOf(a) - specificityOf(b);
  });
  return candidates[0];
}

export interface BeneficiaryDescriptor {
  type: BeneficiaryType;
  name: string;
  sellerId?: string | null;
  partnerId?: string | null;
  /** Fallback percentage when no rule matches (e.g. partner.default_commission_pct). */
  fallbackPct?: number | null;
}

/**
 * Resolves every commission obligation generated by one sale.
 * Each beneficiary (partner, supervisor, seller…) is registered separately.
 */
export async function resolveCommissions(
  input: CommissionInput,
  beneficiaries: BeneficiaryDescriptor[]
): Promise<ResolvedCommission[]> {
  const res = await totalumSdk.crud.query("commission_rule", {
    _filter: { company: input.companyId, status: "active" },
    _limit: 500,
  });
  if (res.errors) {
    console.error("[CommissionEngine] failed loading rules:", res.errors);
    throw new Error(res.errors.errorMessage || "No se pudieron cargar las reglas de comisión");
  }
  const rules = (res.data || []) as CommissionRule[];
  console.log(`[CommissionEngine] ${rules.length} reglas activas · base=${input.baseAmount} ${input.currency}`);

  const out: ResolvedCommission[] = [];

  for (const b of beneficiaries) {
    const scoped: CommissionInput = {
      ...input,
      sellerId: b.sellerId ?? input.sellerId,
      partnerId: b.partnerId ?? input.partnerId,
    };
    const rule = pickRule(rules, scoped, b.type);

    let amount = 0;
    let percentage = 0;
    let calcType: CalcType = "percentage";
    let ruleName = "Sin regla";
    let ruleId: string | null = null;
    let priority = 99;
    let matched: string[] = ["fallback"];

    if (rule) {
      const computed = computeAmount(rule, scoped);
      amount = computed.amount;
      percentage = computed.percentage;
      calcType = (rule.calc_type || "percentage") as CalcType;
      ruleName = rule.name || "Regla sin nombre";
      ruleId = rule._id;
      priority = rule.priority ?? specificityOf(rule);
      matched = matchedCriteria(rule);
    } else if (b.fallbackPct != null && b.fallbackPct > 0) {
      percentage = b.fallbackPct;
      amount = round2((input.baseAmount * b.fallbackPct) / 100);
      ruleName = `Comisión estándar (${b.fallbackPct}%)`;
    } else {
      continue; // nothing to register for this beneficiary
    }

    const snapshot: CommissionSnapshot = {
      rule_id: ruleId,
      rule_name: ruleName,
      priority,
      calc_type: calcType,
      value: rule?.value ?? b.fallbackPct ?? 0,
      base_amount: input.baseAmount,
      amount,
      currency: input.currency,
      matched_on: matched,
      captured_at: new Date().toISOString(),
    };

    out.push({
      beneficiary_type: b.type,
      beneficiary_name: b.name,
      seller: b.sellerId ?? null,
      partner: b.partnerId ?? null,
      rule: ruleId,
      base_amount: input.baseAmount,
      calc_type: calcType,
      percentage,
      amount,
      currency: input.currency,
      snapshot,
    });

    console.log(
      `[CommissionEngine] ${b.type} "${b.name}" → ${amount} ${input.currency} (regla: ${ruleName})`
    );
  }

  return out;
}
