import "server-only";
import { tenantQuery } from "@/lib/tenant";
import { ensureChart, post, type LedgerSource } from "@/lib/ledger";

/**
 * Connects real money movements to the double-entry ledger (AUD-F15).
 *
 * Design decisions that keep this safe to switch on:
 *
 *  - **Cash basis.** Every posting mirrors an actual cash/bank movement
 *    (a payment, a refund, a settlement pay-out). There are no accruals,
 *    deferred revenue or receivables in the ledger, so an entry can never
 *    drift away from reality and a cancellation needs no complex reversal.
 *    Accrual accounting (recognising revenue on check-in, receivables, etc.)
 *    is a deliberate future step, not a prerequisite for a truthful cash P&L.
 *
 *  - **Best-effort / non-fatal.** A bookkeeping failure must NEVER break the
 *    business operation that caused it. Every function here swallows its own
 *    errors and only logs them: a payment still succeeds even if the ledger
 *    is momentarily unreachable. The trial balance is a reporting layer, not a
 *    gate on taking money.
 *
 *  - **Idempotent.** Before posting we check whether an entry already exists
 *    for the same (source, document). Payment retries (the idempotency path in
 *    /api/payments) and event replays therefore never double-post.
 */

/** Maps a payment method to the asset account that receives/loses the cash. */
function cashAccountForMethod(method?: string | null): string {
  switch (method) {
    case "card":
    case "credit_card":
      return "1103"; // Tarjetas por liquidar
    case "transfer":
    case "bank":
    case "wire":
    case "link":
      return "1102"; // Bancos
    case "cash":
      return "1101"; // Caja general
    default:
      return "1102"; // conservative default: bank
  }
}

/** True when a balanced entry already exists for this source + document reference. */
async function alreadyPosted(
  companyId: string,
  source: LedgerSource,
  refKey: string,
  refValue: string
): Promise<boolean> {
  const rows = await tenantQuery<{ _id: string }>(companyId, "ledger_entry", {
    _filter: { source_type: source, [refKey]: refValue },
    _limit: 1,
  });
  return rows.length > 0;
}

export interface PaymentLedgerInput {
  paymentId: string;
  orderId?: string | null;
  amount: number;
  method?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
  isRefund: boolean;
  userId?: string;
}

/**
 * Posts a payment or refund.
 *  Payment: Dr Cash/Bank, Cr Revenue.
 *  Refund:  Dr Devoluciones (contra-revenue), Cr Cash/Bank.
 */
export async function postPayment(companyId: string, input: PaymentLedgerInput): Promise<void> {
  try {
    const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
    if (!(amount > 0)) return;

    const source: LedgerSource = input.isRefund ? "refund" : "payment";
    if (await alreadyPosted(companyId, source, "payment", input.paymentId)) return;

    await ensureChart(companyId);
    const cash = cashAccountForMethod(input.method);
    const refs = {
      payment: input.paymentId,
      ...(input.orderId ? { order: input.orderId } : {}),
    };

    const lines = input.isRefund
      ? [
          { account: "4201", debit: amount, memo: "Reembolso a cliente" },
          { account: cash, credit: amount },
        ]
      : [
          { account: cash, debit: amount },
          { account: "4101", credit: amount, memo: "Ingreso por venta" },
        ];

    await post(companyId, {
      source,
      currency: input.currency || undefined,
      exchangeRate: input.exchangeRate ?? 1,
      userId: input.userId,
      refs,
      memo: input.isRefund ? "Reembolso" : "Cobro",
      lines,
    });
  } catch (err) {
    console.error("[ledger] postPayment falló (no crítico):", err);
  }
}

export interface SettlementLedgerInput {
  settlementId: string;
  amount: number;
  method?: string | null;
  currency?: string | null;
  userId?: string;
}

/**
 * Posts a settlement pay-out to a partner/seller.
 *  Dr Comisiones de venta (expense 5103), Cr Cash/Bank.
 * (Cash basis: the commission hits the P&L when it is actually paid.)
 */
export async function postSettlementPayment(companyId: string, input: SettlementLedgerInput): Promise<void> {
  try {
    const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
    if (!(amount > 0)) return;
    if (await alreadyPosted(companyId, "settlement", "settlement", input.settlementId)) return;

    await ensureChart(companyId);
    const cash = cashAccountForMethod(input.method);
    await post(companyId, {
      source: "settlement",
      currency: input.currency || undefined,
      userId: input.userId,
      refs: { settlement: input.settlementId },
      memo: "Pago de liquidación",
      lines: [
        { account: "5103", debit: amount, memo: "Comisión liquidada" },
        { account: cash, credit: amount },
      ],
    });
  } catch (err) {
    console.error("[ledger] postSettlementPayment falló (no crítico):", err);
  }
}
