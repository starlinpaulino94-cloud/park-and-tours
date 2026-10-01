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
    /**
     * LA GIFT CARD NO ES CAJA: ES UN PASIVO QUE BAJA.
     *
     * Sin este caso caería en el `default` —Bancos— y el asiento diría que entró
     * dinero al banco cuando lo que ocurrió es que la empresa dejó de deberle al
     * portador. El efectivo quedaría inflado y el pasivo por gift cards, intacto
     * para siempre: las dos mitades mal a la vez.
     *
     * Con 2202 el asiento del cobro sale solo y correcto:
     *   Dr 2202 Pasivo por gift cards / Cr 4101 Ingresos.
     *
     * El otro lado —emitir— lo pone `postGiftCardIssued`: Dr caja / Cr 2202. Sin
     * ese, este débito dejaría el pasivo en NEGATIVO, que es un balance que no
     * significa nada.
     */
    case "gift_card":
      return "2202"; // Pasivo por gift cards
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

export interface GiftCardIssueLedgerInput {
  giftCardId: string;
  amount: number;
  /** Con qué se pagó la tarjeta al comprarla. */
  method?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
  userId?: string;
}

/**
 * EMITIR UNA GIFT CARD NO ES UN INGRESO: ES UNA DEUDA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL LADO QUE FALTABA
 *
 * `LedgerSource` tenía `"gift_card"` declarado y **sin usar**: la emisión no
 * contabilizaba nada. La cuenta `2202 Pasivo por gift cards` existía en el plan
 * base desde el primer día y ningún asiento la tocaba.
 *
 * Eso no se notaba mientras el saldo no se pudiera gastar. Al hacer la tarjeta un
 * método de cobro, el consumo empieza a DEBITAR 2202 —eso es lo correcto— y sin
 * este apunte el pasivo se iría a negativo: un balance que dice que los clientes
 * le deben saldo a la empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES INGRESO AL EMITIR
 *
 * El dinero entró, pero el servicio no se ha dado. Reconocerlo como venta al
 * emitir infla el resultado del mes en que se vendió la tarjeta y lo deja vacío
 * el mes en que de verdad se viaja. El ingreso se reconoce al CONSUMIRLA, que es
 * lo que hace el asiento del cobro: Dr 2202 / Cr 4101.
 *
 *   Emitir:  Dr caja o banco   / Cr 2202 (deuda con el portador)
 *   Consumir: Dr 2202          / Cr 4101 (ahora sí, ingreso)
 *
 * Las dos mitades se cierran y el pasivo refleja en todo momento cuánto saldo
 * vendido queda sin usar — que es la cifra que un contador pide a fin de año.
 */
export async function postGiftCardIssued(
  companyId: string,
  input: GiftCardIssueLedgerInput
): Promise<void> {
  try {
    const amount = Math.round((Number(input.amount) + Number.EPSILON) * 100) / 100;
    if (!(amount > 0)) return;
    if (await alreadyPosted(companyId, "gift_card", "gift_card", input.giftCardId)) return;

    await ensureChart(companyId);
    /**
     * El método es con qué PAGÓ el cliente la tarjeta, no la tarjeta misma. Si
     * llegara `gift_card` —pagar una gift card con otra gift card— el asiento
     * saldría 2202 contra 2202 y no diría nada, así que se cae a banco.
     */
    const cobrado = input.method === "gift_card" ? "1102" : cashAccountForMethod(input.method);

    await post(companyId, {
      source: "gift_card",
      currency: input.currency || undefined,
      exchangeRate: input.exchangeRate ?? 1,
      userId: input.userId,
      refs: { gift_card: input.giftCardId },
      memo: "Emisión de gift card",
      lines: [
        { account: cobrado, debit: amount, memo: "Cobro de la gift card" },
        { account: "2202", credit: amount, memo: "Saldo vendido y sin usar" },
      ],
    });
  } catch (err) {
    console.error("[ledger] postGiftCardIssued falló (no crítico):", err);
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

export interface CashDifferenceLedgerInput {
  cashSessionId: string;
  /** Contado menos esperado: positivo sobra, negativo falta. */
  difference: number;
  currency?: string | null;
  exchangeRate?: number | null;
  userId?: string;
}

/**
 * Asienta el descuadre de un arqueo.
 *
 *  Faltante: Dr Faltantes de caja (gasto), Cr Caja general.
 *  Sobrante: Dr Caja general,          Cr Sobrantes de caja (ingreso).
 *
 * Antes el descuadre solo quedaba en la auditoría, así que un turno que perdía
 * dinero todos los días no aparecía en ningún estado de resultados: la caja
 * cuadraba en el papel y el dinero se iba igual.
 */
export async function postCashDifference(
  companyId: string,
  input: CashDifferenceLedgerInput
): Promise<void> {
  try {
    const difference = Math.round((Number(input.difference) + Number.EPSILON) * 100) / 100;
    // Un arqueo cuadrado no genera asiento: no hay nada que contabilizar.
    if (!Number.isFinite(difference) || Math.abs(difference) < 0.01) return;
    if (await alreadyPosted(companyId, "cash_close", "cash_session", input.cashSessionId)) return;

    await ensureChart(companyId);
    const amount = Math.abs(difference);
    const lines = difference < 0
      ? [
          { account: "5206", debit: amount, memo: "Faltante de caja" },
          { account: "1101", credit: amount },
        ]
      : [
          { account: "1101", debit: amount },
          { account: "4105", credit: amount, memo: "Sobrante de caja" },
        ];

    await post(companyId, {
      source: "cash_close",
      currency: input.currency || undefined,
      exchangeRate: input.exchangeRate ?? 1,
      userId: input.userId,
      refs: { cash_session: input.cashSessionId },
      memo: difference < 0 ? "Faltante en el arqueo" : "Sobrante en el arqueo",
      lines,
    });
  } catch (err) {
    console.error("[ledger] postCashDifference falló (no crítico):", err);
  }
}
