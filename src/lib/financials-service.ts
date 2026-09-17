import "server-only";
import { tenantQuery, tenantCreate, tenantUpdate, TenantError } from "@/lib/tenant";
import { trialBalance, post } from "@/lib/ledger";
import {
  incomeStatement, balanceSheet, closingEntry, periodTransition, isPeriod,
  type AccountBalance, type PeriodAction, type PeriodRow,
} from "@/lib/financials";

/**
 * Los estados financieros y el cierre, contra la base.
 *
 * Dos decisiones que no son obvias:
 *
 *  · **El balance se calcula sobre un RANGO, no sobre un `period` exacto.** El
 *    estado de resultados de un trimestre necesita tres meses y el balance
 *    general necesita TODO lo acumulado desde que la empresa existe. Filtrar
 *    por un solo mes daba un «balance general» que solo miraba septiembre, que
 *    es un número sin significado.
 *
 *  · **Cerrar el ejercicio es un asiento, no una bandera.** Saldar los ingresos
 *    y los gastos contra resultados acumulados deja rastro en el mayor y se
 *    puede reversar como cualquier otro asiento. Una bandera que dijera
 *    «cerrado» sin mover un peso obligaría a cada informe a recordar excluir el
 *    año anterior, y alguno se olvidaría.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const PAGE = 1000;
const MAX = 200_000;

/**
 * Los saldos por cuenta en un rango de periodos.
 *
 * `from` y `to` son periodos `AAAA-MM` inclusive. Omitir `from` significa desde
 * el principio, que es lo que necesita un balance general.
 */
export async function accountBalances(
  companyId: string,
  options: { from?: string | null; to?: string | null; includeClosing?: boolean } = {}
): Promise<AccountBalance[]> {
  const filter: Record<string, unknown> = {};
  if (options.from && options.to) filter.period = { gte: options.from, lte: options.to };
  else if (options.from) filter.period = { gte: options.from };
  else if (options.to) filter.period = { lte: options.to };

  const entries: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const page = await tenantQuery<Record<string, unknown>>(companyId, "ledger_entry", {
      ledger_account: true,
      _filter: filter,
      _sort: { posted_at: "asc" },
      _limit: PAGE,
      _offset: offset,
    });
    entries.push(...page);
    if (page.length < PAGE) break;
  }

  const byAccount = new Map<string, AccountBalance>();
  for (const e of entries) {
    // El asiento de cierre saldaría a cero las cuentas de resultado del
    // ejercicio que cierra: para VER ese ejercicio hay que excluirlo. Para el
    // balance general sí entra, porque el resultado ya está en acumulados.
    if (!options.includeClosing && e.is_closing === true) continue;
    const account = e.ledger_account as { _id?: string; code?: string; name?: string; account_type?: string } | null;
    if (!account?._id) continue;
    const row = byAccount.get(account._id) || {
      code: String(account.code || ""),
      name: String(account.name || ""),
      type: String(account.account_type || "asset"),
      debit: 0,
      credit: 0,
    };
    row.debit = round2(row.debit + num(e.debit));
    row.credit = round2(row.credit + num(e.credit));
    byAccount.set(account._id, row);
  }

  return [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Los tres estados, del mismo juego de datos.
 *
 * El estado de resultados mira SOLO el rango pedido —cuánto ganó la empresa ese
 * trimestre— y el balance general mira todo lo acumulado hasta el final del
 * rango: lo que la empresa TIENE no empieza el 1 de julio.
 */
export async function statements(
  companyId: string,
  from: string,
  to: string
) {
  const [period, cumulative] = await Promise.all([
    accountBalances(companyId, { from, to }),
    accountBalances(companyId, { to, includeClosing: true }),
  ]);

  return {
    range: { from, to },
    incomeStatement: incomeStatement(period),
    balanceSheet: balanceSheet(cumulative),
    trialBalance: period,
  };
}

/** Los periodos registrados, del más reciente al más antiguo. */
export async function periods(companyId: string, limit = 36): Promise<PeriodRow[]> {
  return tenantQuery<PeriodRow>(companyId, "accounting_period", {
    _sort: { period: "desc" },
    _limit: limit,
  });
}

export interface PeriodResult {
  period: string;
  status: string;
  totals?: { debit: number; credit: number; netIncome: number };
}

/**
 * Cierra, reabre o marca como declarado un periodo.
 *
 * Al cerrar se guardan las cifras del momento: si después se reabre y se toca
 * algo, la diferencia con ellas es la pregunta que hay que responderle al
 * contador. Sin ese retrato, reabrir un periodo borra la evidencia de lo que
 * decía cuando se aprobó.
 */
export async function movePeriod(
  companyId: string,
  userId: string,
  period: string,
  action: PeriodAction
): Promise<PeriodResult> {
  if (!isPeriod(period)) throw new TenantError("El periodo debe tener la forma AAAA-MM.", 400);

  const rows = await tenantQuery<PeriodRow & { _id?: string; id?: string }>(
    companyId, "accounting_period", { _filter: { period }, _limit: 1 }
  );
  const existing = rows[0] ?? null;
  const decision = periodTransition(existing?.status ?? "open", action);
  if (decision.ok === false) throw new TenantError(decision.reason, 409);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: decision.next };

  if (action === "close") {
    const tb = await trialBalance(companyId, period);
    const er = incomeStatement(await accountBalances(companyId, { from: period, to: period }));
    patch.closed_at = now;
    patch.closed_by = userId;
    patch.total_debit = tb.totals.debit;
    patch.total_credit = tb.totals.credit;
    patch.net_income = er.netIncome;
  }
  if (action === "lock") {
    patch.locked_at = now;
    patch.locked_by = userId;
  }
  if (action === "reopen") {
    patch.reopened_at = now;
    patch.reopened_by = userId;
  }

  if (existing) {
    await tenantUpdate(companyId, "accounting_period", String(existing._id || existing.id), patch);
  } else {
    await tenantCreate(companyId, "accounting_period", { period, ...patch });
  }

  console.log(`[contabilidad] periodo ${period} → ${decision.next}`);
  return {
    period,
    status: decision.next,
    totals: action === "close"
      ? {
          debit: num(patch.total_debit),
          credit: num(patch.total_credit),
          netIncome: num(patch.net_income),
        }
      : undefined,
  };
}

/**
 * Cierra el ejercicio: lleva el resultado a resultados acumulados.
 *
 * Se contabiliza con fecha del último día del año, y se niega a repetirse: un
 * segundo cierre del mismo ejercicio duplicaría el resultado en acumulados y
 * el balance general dejaría de cuadrar para siempre.
 */
export async function closeYear(companyId: string, userId: string, year: string) {
  if (!/^\d{4}$/.test(year)) throw new TenantError("El ejercicio debe tener la forma AAAA.", 400);

  const yaCerrado = await tenantQuery<{ _id?: string }>(companyId, "ledger_entry", {
    _filter: { closes_year: year, is_closing: true },
    _limit: 1,
  });
  if (yaCerrado.length > 0) {
    throw new TenantError(`El ejercicio ${year} ya está cerrado. Si hay que corregirlo, reversa su asiento de cierre.`, 409);
  }

  const balances = await accountBalances(companyId, { from: `${year}-01`, to: `${year}-12` });
  const lines = closingEntry(balances, `Cierre del ejercicio ${year}`);
  if (lines.length === 0) {
    throw new TenantError(`El ejercicio ${year} no tiene movimientos que cerrar.`, 409);
  }

  const result = await post(companyId, {
    source: "adjustment",
    memo: `Cierre del ejercicio ${year}`,
    postedAt: `${year}-12-31T23:59:59.000Z`,
    userId,
    lines,
  });

  // La marca va DESPUÉS de que el asiento exista: al revés, un fallo a mitad
  // dejaría el ejercicio marcado como cerrado sin asiento que lo cierre.
  const written = await tenantQuery<{ _id?: string; id?: string }>(companyId, "ledger_entry", {
    _filter: { entry_code: result.entryCode },
    _limit: 200,
  });
  for (const row of written) {
    await tenantUpdate(companyId, "ledger_entry", String(row._id || row.id), {
      is_closing: true,
      closes_year: year,
    });
  }

  console.log(`[contabilidad] ejercicio ${year} cerrado con ${result.entryCode}`);
  return { year, entryCode: result.entryCode, lines: lines.length, total: result.total };
}
