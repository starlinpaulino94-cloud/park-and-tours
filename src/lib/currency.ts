import "server-only";
import { tenantQuery } from "@/lib/tenant";

/**
 * Currency conversion (AUD-F30).
 *
 * The system stores `currency`, `exchange_rate` and `base_amount` on every
 * money document, but the rate used to come from the client (defaulting to 1)
 * and the `currency_rate` table was never read — so a DOP amount was summed
 * 1:1 with USD. This helper resolves the rate SERVER-SIDE from `currency_rate`
 * so `base_amount`/`base_currency_total` are meaningful and can be aggregated.
 */

interface CurrencyRateRow {
  currency_from?: string;
  currency_to?: string;
  rate?: number;
  rate_date?: string;
}

const norm = (c?: string | null) => (c || "").trim().toLowerCase();

/**
 * Resolves the rate to convert an amount in `from` into `to`, using the most
 * recent matching `currency_rate` (direct, else the inverse of the opposite
 * pair). Returns 1 for same-currency. If no rate is configured it falls back to
 * 1 and logs a warning — a missing rate must never crash a sale.
 */
export async function resolveExchangeRate(
  companyId: string,
  from?: string | null,
  to?: string | null
): Promise<number> {
  const f = norm(from);
  const t = norm(to);
  if (!f || !t || f === t) return 1;

  const direct = await tenantQuery<CurrencyRateRow>(companyId, "currency_rate", {
    _filter: { currency_from: f, currency_to: t },
    _sort: { rate_date: "desc" },
    _limit: 1,
  });
  const directRate = Number(direct[0]?.rate);
  if (Number.isFinite(directRate) && directRate > 0) return directRate;

  const inverse = await tenantQuery<CurrencyRateRow>(companyId, "currency_rate", {
    _filter: { currency_from: t, currency_to: f },
    _sort: { rate_date: "desc" },
    _limit: 1,
  });
  const inverseRate = Number(inverse[0]?.rate);
  if (Number.isFinite(inverseRate) && inverseRate > 0) {
    return Math.round((1 / inverseRate + Number.EPSILON) * 1_000_000) / 1_000_000;
  }

  console.warn(`[currency] sin tasa configurada ${f}->${t}; se usa 1:1`);
  return 1;
}

/** Converts an amount from one currency to another, rounded to 2 decimals. */
export async function convertAmount(
  companyId: string,
  amount: number,
  from?: string | null,
  to?: string | null
): Promise<number> {
  const rate = await resolveExchangeRate(companyId, from, to);
  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
}
