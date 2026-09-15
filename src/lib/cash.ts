import "server-only";
import { tenantQuery, tenantUpdate } from "@/lib/tenant";
import { summarizeCash, byCurrencyMap, type CurrencySummary } from "@/lib/cash-close";
import type { CashSession } from "@/lib/types";

/**
 * Recalcula los totales de una sesión de caja a partir de sus movimientos.
 *
 * El cálculo vive en `cash-close.ts` (puro y probado); aquí solo se leen los
 * datos y se persiste el resultado. Lo que cambió respecto de la versión
 * anterior: los totales se guardan POR MONEDA. `expected_cash` y compañía se
 * mantienen para la moneda principal de la caja, porque los RPC del panel los
 * leen, pero ya no son la suma de importes de monedas distintas.
 */
export async function recalcCashSession(
  companyId: string,
  sessionId: string
): Promise<CurrencySummary[]> {
  const [session] = await tenantQuery<CashSession>(companyId, "cash_session", {
    _filter: { _id: sessionId }, _limit: 1,
  });
  if (!session) return [];

  const movements = await tenantQuery<{ movement_type?: string; amount?: number; currency?: string }>(
    companyId, "cash_movement", { _filter: { cash_session: sessionId }, _limit: 1000 }
  );
  const payments = await tenantQuery<{ method?: string; amount?: number; payment_type?: string; currency?: string }>(
    companyId, "payment", { _filter: { cash_session: sessionId, status: "completed" }, _limit: 1000 }
  );

  const primary = String(session.currency || "usd").toLowerCase();
  const summaries = summarizeCash(movements, payments, [primary]);
  const main = summaries.find((s) => s.currency === primary);

  await tenantUpdate(companyId, "cash_session", sessionId, {
    expected_by_currency: byCurrencyMap(summaries.map((s) => ({ currency: s.currency, amount: s.expected }))),
    // Escalares de la moneda principal: lo que leen el panel y los informes.
    expected_cash: main?.expected ?? 0,
    card_total: main?.card ?? 0,
    transfer_total: main?.transfer ?? 0,
    sales_total: main?.sales ?? 0,
    expenses_total: main?.expenses ?? 0,
    withdrawals_total: main?.withdrawals ?? 0,
  });

  return summaries;
}
