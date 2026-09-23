import "server-only";
import { tenantFindOne, tenantQuery } from "@/lib/tenant";
import {
  summarizeCash, countTotal, differenceOf, classifyDifference,
  type CurrencySummary, type CountLine, type DifferenceVerdict,
} from "@/lib/cash-close";
import type { CashSession } from "@/lib/types";

/**
 * El arqueo de una sesión, armado en un solo sitio.
 *
 * Lo piden tres sitios —la pantalla de caja, el PDF que se archiva con el
 * efectivo, y la revisión del supervisor— y los tres tienen que decir lo mismo.
 * Un arqueo que en pantalla cuadra y en el papel no, no sirve para nada.
 */

export interface CountedCurrency extends CurrencySummary {
  /** Lo que el cajero contó físicamente en esta moneda, si ya contó. */
  counted: number | null;
  difference: number | null;
  verdict: DifferenceVerdict | null;
  breakdown: CountLine[];
}

export interface CashClosePayload {
  session: CashSession & Record<string, unknown>;
  register: Record<string, unknown> | null;
  tolerance: number;
  currencies: CountedCurrency[];
  movements: Record<string, unknown>[];
  /** Conciliación del datáfono: lo cobrado con tarjeta contra el lote del banco. */
  card: { expected: number; batch: number | null; difference: number | null; reference: string | null };
}

export async function loadCashClose(companyId: string, sessionId: string): Promise<CashClosePayload> {
  const session = await tenantFindOne<CashSession & Record<string, unknown>>(
    companyId, "cash_session", sessionId,
    // `partner` y `seller` expandidos: quien lea este arqueo tiene que poder
    // decir de qué mostrador es el dinero sin volver a la base (0081).
    { cash_register: true, branch: true, user: true, partner: true, seller: true }
  );

  const [movements, payments, counts] = await Promise.all([
    tenantQuery<Record<string, unknown>>(companyId, "cash_movement", {
      _filter: { cash_session: sessionId }, _limit: 1000, _sort: { movement_at: "asc" }, user: true,
    }),
    tenantQuery<{ method?: string; amount?: number; payment_type?: string; currency?: string }>(
      companyId, "payment", { _filter: { cash_session: sessionId, status: "completed" }, _limit: 1000 }
    ),
    tenantQuery<Record<string, unknown>>(companyId, "cash_count", {
      _filter: { cash_session: sessionId, kind: "close" }, _limit: 20,
    }),
  ]);

  const primary = String(session.currency || "usd").toLowerCase();
  const summaries = summarizeCash(
    movements as { movement_type?: string; amount?: number; currency?: string }[],
    payments,
    [primary]
  );

  const register = (typeof session.cash_register === "object" ? session.cash_register : null) as
    unknown as Record<string, unknown> | null;
  const tolerance = Number(register?.difference_tolerance ?? 0) || 0;

  const countByCurrency = new Map<string, Record<string, unknown>>();
  for (const row of counts) countByCurrency.set(String(row.currency || "").toLowerCase(), row);

  const currencies: CountedCurrency[] = summaries.map((summary) => {
    const stored = countByCurrency.get(summary.currency);
    if (!stored) {
      return { ...summary, counted: null, difference: null, verdict: null, breakdown: [] };
    }
    const breakdown = Array.isArray(stored.breakdown) ? (stored.breakdown as CountLine[]) : [];
    const counted = countTotal(breakdown.length > 0 ? breakdown : null) || Number(stored.counted_total ?? 0);
    const difference = differenceOf(summary.expected, counted);
    return { ...summary, counted, difference, verdict: classifyDifference(difference, tolerance), breakdown };
  });

  const cardExpected = summaries.reduce((total, s) => (s.currency === primary ? total + s.card : total), 0);
  const batch = session.card_batch_total == null ? null : Number(session.card_batch_total);

  return {
    session,
    register,
    tolerance,
    currencies,
    movements,
    card: {
      expected: cardExpected,
      batch,
      difference: batch == null ? null : differenceOf(cardExpected, batch),
      reference: (session.card_batch_reference as string | undefined) ?? null,
    },
  };
}
