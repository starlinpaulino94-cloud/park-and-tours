import "server-only";
import { tenantQuery } from "@/lib/tenant";
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
  /** Fecha de la VENTA (0059), distinta de la de viaje. Sin ella, hoy. */
  saleDate?: string | null;
  /** Accumulated sales in the period — used by tiered/volume rules. */
  periodSales?: number;
  /**
   * Los pasajeros de la venta (0059).
   *
   * Hacen falta para los tipos por pasajero y para la tarifa neta, y se
   * CONGELAN en la comisión: recalcular un «por adulto» de hace tres meses
   * tendría que ir a buscar la reserva, que puede haberse reprogramado con
   * otra gente.
   */
  adults?: number;
  children?: number;
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
  /** La frase legible, para guardarla junto a la cifra y poder imprimirla. */
  breakdown: string;
  pax_adults: number;
  pax_children: number;
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
  if (rule.effective_from || rule.effective_to) out.push("effective");
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

/**
 * Vigencia por fecha de VENTA (0059).
 *
 * `withinSeason` acota por fecha de VIAJE: «en temporada alta se comisiona
 * distinto». Esto acota por fecha de venta: «esta campaña vale para lo que se
 * venda en octubre, viajen cuando viajen». Son dos acuerdos distintos, y
 * mezclarlos hacía imposible expresar el segundo.
 */
function withinEffective(rule: CommissionRule, saleDate?: string | null): boolean {
  if (!rule.effective_from && !rule.effective_to) return true;
  const d = saleDate ? new Date(saleDate) : new Date();
  // Una fecha ilegible no puede excluir una regla: dejaría una venta sin
  // comisión por un dato de formato.
  if (Number.isNaN(d.getTime())) return true;
  if (rule.effective_from && d < new Date(rule.effective_from)) return false;
  // Hasta el FINAL del último día: `effective_to` es una fecha, y comparar
  // contra su medianoche dejaría fuera todo lo vendido ese día.
  if (rule.effective_to && d > new Date(`${rule.effective_to}T23:59:59.999Z`)) return false;
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
  if (!withinEffective(rule, input.saleDate)) return false;
  if (!withinVolume(rule, input.periodSales)) return false;

  return true;
}

export interface ComputedCommission {
  amount: number;
  percentage: number;
  /**
   * La frase que explica la cifra sin abrir el código.
   *
   * Existe porque el snapshot guarda los datos y un JSON no se le enseña a un
   * conserje que discute su liquidación por WhatsApp. «3 adultos × 10.00 USD =
   * 30.00 USD» cierra esa conversación; `{"calc_type":"per_adult","value":10}`
   * la alarga.
   */
  breakdown: string;
}

/** Importe con dos decimales y la moneda, sin formato local: se lee igual en un PDF, en una pantalla y en un WhatsApp. */
function money(value: number, currency: Currency): string {
  return `${round2(value).toFixed(2)} ${String(currency).toUpperCase()}`;
}

const plural = (n: number, singular: string, many: string) => `${n} ${n === 1 ? singular : many}`;

function pickTier(tiers: CommissionTier[], yardstick: number): CommissionTier | null {
  const sorted = [...tiers].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  let picked: CommissionTier | null = null;
  for (const tier of sorted) {
    const from = tier.from ?? 0;
    const to = tier.to ?? Number.POSITIVE_INFINITY;
    if (yardstick >= from && yardstick <= to) picked = tier;
  }
  return picked ?? sorted[0] ?? null;
}

/**
 * Cuánto se le debe por esta venta, y por qué.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS TIPOS QUE ESTUVIERON PAGANDO MAL
 *
 * `net_rate` y `markup` se ofrecían en la pantalla desde el principio y caían al
 * `return` final, o sea se pagaban como PORCENTAJE. Una regla de «tarifa neta
 * 45» —«la agencia me deja 45 por pasajero»— pagaba el 45 % de la venta. Nadie
 * lo reportó porque una comisión mal calculada no da error: da una cifra.
 *
 *  · **net_rate** — el beneficiario vende a su precio y le entrega a la
 *    operadora una tarifa neta por pasajero. Lo suyo es la diferencia:
 *    `venta − neto × pax`. Si vendió por debajo del neto, cero — no una deuda.
 *  · **markup** — el precio de venta ya lleva dentro el margen del
 *    beneficiario. Lo suyo es la parte que corresponde a ese margen:
 *    `venta − venta / (1 + markup%)`. Es la resta, no `venta × markup%`: sobre
 *    un precio que YA incluye el 20 %, el 20 % del total se pasa de largo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOPE, Y POR QUÉ NO ES PARANOIA
 *
 * El importe nunca pasa de la base. Una regla que da más de lo que entró es
 * siempre un error de configuración —un «fijo por venta» de 200 en un tour de
 * 120, una tarifa neta puesta al revés— y es mejor topar y decirlo en el
 * desglose que pagar de más y descubrirlo en la liquidación.
 */
export function computeAmount(rule: CommissionRule, input: CommissionInput): ComputedCommission {
  const base = round2(input.baseAmount);
  const currency = input.currency;
  const value = round2(rule.value ?? 0);
  const adults = Math.max(0, Math.floor(input.adults ?? 0));
  const children = Math.max(0, Math.floor(input.children ?? 0));
  const pax = adults + children;
  const calc = (rule.calc_type || "percentage") as CalcType;

  let amount = 0;
  let breakdown = "";

  switch (calc) {
    case "fixed":
      amount = value;
      breakdown = `${money(value, currency)} fijos por venta`;
      break;

    case "per_pax":
      amount = value * pax;
      breakdown = `${money(value, currency)} × ${plural(pax, "pasajero", "pasajeros")}`;
      break;

    case "per_adult":
      amount = value * adults;
      breakdown = `${money(value, currency)} × ${plural(adults, "adulto", "adultos")}`;
      break;

    case "per_child":
      amount = value * children;
      breakdown = `${money(value, currency)} × ${plural(children, "niño", "niños")}`;
      break;

    case "net_rate": {
      amount = base - value * pax;
      breakdown = `Tarifa neta: ${money(base, currency)} − ${money(value, currency)} × ${plural(pax, "pasajero", "pasajeros")}`;
      if (pax === 0) {
        breakdown = `${breakdown} — la venta no declara pasajeros, así que el neto no se puede descontar`;
      }
      break;
    }

    case "markup": {
      // La parte del precio que ES el margen del beneficiario. Con un markup de
      // cero no hay margen y no hay comisión, que es lo correcto y además evita
      // dividir entre uno para llegar a cero por otro camino.
      amount = value > 0 ? base - base / (1 + value / 100) : 0;
      breakdown = `Markup del ${value} % ya incluido en ${money(base, currency)}`;
      break;
    }

    case "tiered":
    case "volume": {
      const tiers = parseJson<CommissionTier[]>(rule.tiers, []);
      /**
       * Contra qué se miden los escalones.
       *
       * `volume` mira lo acumulado del periodo, que es lo que significa. Para
       * `tiered`, la regla lo dice: el acuerdo que se firma con un touroperador
       * mira los PASAJEROS —«de 1 a 10 pax, 10 %»— y con escalones por importe
       * un grupo de 20 en un tour barato cobraría menos que una pareja en uno
       * caro, que es lo contrario de lo pactado.
       */
      const byPax = calc === "tiered" && rule.tier_basis === "pax";
      const yardstick = calc === "volume" ? input.periodSales ?? base : byPax ? pax : base;
      const unidad = calc === "volume"
        ? `${money(yardstick, currency)} acumulados en el periodo`
        : byPax ? plural(yardstick, "pasajero", "pasajeros") : money(yardstick, currency);

      const tier = pickTier(tiers, yardstick);
      if (!tier) {
        amount = 0;
        breakdown = `${unidad} no cae en ningún escalón definido: comisión en cero`;
        break;
      }
      const hasta = tier.to == null ? "en adelante" : `hasta ${tier.to}`;
      if ((tier.calc_type ?? "percentage") === "fixed") {
        amount = tier.value;
        breakdown = `${money(tier.value, currency)} fijos (escalón de ${tier.from ?? 0} ${hasta}, ${unidad})`;
      } else {
        amount = (base * tier.value) / 100;
        breakdown = `${tier.value} % sobre ${money(base, currency)} (escalón de ${tier.from ?? 0} ${hasta}, ${unidad})`;
      }
      break;
    }

    case "percentage":
      amount = (base * value) / 100;
      breakdown = `${value} % sobre ${money(base, currency)} (venta sin impuestos)`;
      break;

    default: {
      /**
       * Un tipo que la base admite y este motor no conoce.
       *
       * Pagar cero en silencio es lo que hacía el código anterior con
       * `net_rate` y `markup`, y por eso nadie se enteró en dos años. Aquí se
       * paga cero pero el desglose lo grita, y ese texto acaba impreso en la
       * liquidación del vendedor.
       */
      amount = 0;
      breakdown = `Tipo de cálculo «${calc}» no reconocido: comisión en cero — revisa la regla`;
      break;
    }
  }

  amount = round2(Math.max(0, amount));

  if (base <= 0) {
    amount = 0;
    breakdown = `${breakdown} — la venta no dejó ingreso: comisión en cero`;
  } else if (amount > base) {
    amount = base;
    breakdown = `${breakdown} — topado a ${money(base, currency)}: la regla daba más de lo que entró`;
  }

  return {
    amount,
    percentage: base > 0 ? round2((amount / base) * 100) : 0,
    breakdown,
  };
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
  const rules = await tenantQuery<CommissionRule>(input.companyId, "commission_rule", {
    _filter: { status: "active" },
    _limit: 500,
  });
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
    let breakdown = "";
    let calcType: CalcType = "percentage";
    let ruleName = "Sin regla";
    let ruleId: string | null = null;
    let priority = 99;
    let matched: string[] = ["fallback"];

    if (rule) {
      const computed = computeAmount(rule, scoped);
      amount = computed.amount;
      percentage = computed.percentage;
      breakdown = computed.breakdown;
      calcType = (rule.calc_type || "percentage") as CalcType;
      ruleName = rule.name || "Regla sin nombre";
      ruleId = rule._id;
      priority = rule.priority ?? specificityOf(rule);
      matched = matchedCriteria(rule);
    } else if (b.fallbackPct != null && b.fallbackPct > 0) {
      percentage = b.fallbackPct;
      amount = round2((input.baseAmount * b.fallbackPct) / 100);
      ruleName = `Comisión estándar (${b.fallbackPct}%)`;
      // También el respaldo lleva su frase: si no, la mitad de las comisiones
      // de una operadora sin reglas configuradas aparecerían sin explicación.
      breakdown = `${b.fallbackPct} % estándar sobre ${round2(input.baseAmount).toFixed(2)} ${String(input.currency).toUpperCase()} (sin regla específica)`;
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
      breakdown,
      pax_adults: input.adults ?? 0,
      pax_children: input.children ?? 0,
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
      breakdown,
      pax_adults: input.adults ?? 0,
      pax_children: input.children ?? 0,
    });

    console.log(
      `[CommissionEngine] ${b.type} "${b.name}" → ${amount} ${input.currency} (regla: ${ruleName})`
    );
  }

  return out;
}
