import "server-only";
import { tenantQuery, tenantUpdate } from "@/lib/tenant";
import { summarizeCash, byCurrencyMap, type CurrencySummary } from "@/lib/cash-close";
import { leerTodoElRecurso } from "@/lib/barrido";
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

  /**
   * EL ARQUEO SE LEE ENTERO O NO SE ESCRIBE.
   *
   * Esto leía mil movimientos y mil cobros y de ahí salía `expected_cash`: lo
   * que se le exige al cajero que tenga en el cajón al cerrar. En un kiosco de
   * parque cada entrada vendida es un cobro, así que mil se pasan en un día
   * bueno — y pasado el tope el número escrito era MENOR que el real, así que
   * al cerrar aparecía un sobrante. Si lo truncado eran los movimientos
   * (gastos, retiros), aparecía un faltante.
   *
   * En cualquiera de los dos casos el sistema acusa a una persona con un número
   * que se calculó a medias y se guardó como bueno. Aquí no vale quedarse corto
   * y avisar: si no se puede leer todo, no se escribe nada y se lanza. Un
   * arqueo que no se puede cuadrar se arregla mirándolo; un arqueo mal cuadrado
   * se arregla despidiendo a alguien.
   */
  const movements = await leerTodoElRecurso<{ movement_type?: string; amount?: number; currency?: string }>(
    "cash_movement",
    (limite, salto) => tenantQuery(companyId, "cash_movement", {
      _filter: { cash_session: sessionId },
      _sort: { created_at: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    })
  );
  const payments = await leerTodoElRecurso<{ method?: string; amount?: number; payment_type?: string; currency?: string }>(
    "payment",
    (limite, salto) => tenantQuery(companyId, "payment", {
      _filter: { cash_session: sessionId, status: "completed" },
      _sort: { created_at: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    })
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
