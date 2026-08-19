import "server-only";
import { totalumSdk } from "@/lib/totalum";
import { tenantQuery } from "@/lib/tenant";
import type { CashSession } from "@/lib/types";

/** Recomputes the totals of an open cash session from its movements. */
export async function recalcCashSession(companyId: string, sessionId: string) {
  const [session] = await tenantQuery<CashSession>(companyId, "cash_session", {
    _filter: { _id: sessionId }, _limit: 1,
  });
  if (!session) return;

  const movements = await tenantQuery<{ movement_type?: string; amount?: number }>(companyId, "cash_movement", {
    _filter: { cash_session: sessionId }, _limit: 1000,
  });
  const payments = await tenantQuery<{ method?: string; amount?: number; payment_type?: string }>(
    companyId, "payment", { _filter: { cash_session: sessionId, status: "completed" }, _limit: 1000 }
  );

  let cashDelta = 0, expenses = 0, withdrawals = 0, sales = 0;
  for (const m of movements) {
    const amt = m.amount ?? 0;
    if (m.movement_type === "expense") { expenses += Math.abs(amt); cashDelta -= Math.abs(amt); }
    else if (m.movement_type === "withdrawal") { withdrawals += Math.abs(amt); cashDelta -= Math.abs(amt); }
    else if (m.movement_type === "opening") { /* opening float handled separately */ }
    else { cashDelta += amt; if (amt > 0) sales += amt; }
  }

  let card = 0, transfer = 0;
  for (const p of payments) {
    const signed = p.payment_type === "refund" ? -(p.amount ?? 0) : p.amount ?? 0;
    if (p.method === "card") card += signed;
    else if (p.method === "transfer" || p.method === "payment_link" || p.method === "deposit") transfer += signed;
  }

  // Card/transfer payments never touch the cash drawer.
  const cashOnly = cashDelta - card - transfer;
  const expected = Math.round(((session.opening_amount ?? 0) + cashOnly + Number.EPSILON) * 100) / 100;

  await totalumSdk.crud.editRecordById("cash_session", sessionId, {
    expected_cash: expected,
    card_total: Math.round((card + Number.EPSILON) * 100) / 100,
    transfer_total: Math.round((transfer + Number.EPSILON) * 100) / 100,
    sales_total: Math.round((sales + Number.EPSILON) * 100) / 100,
    expenses_total: Math.round((expenses + Number.EPSILON) * 100) / 100,
    withdrawals_total: Math.round((withdrawals + Number.EPSILON) * 100) / 100,
  });
}
