/**
 * ESTADOS FINANCIEROS Y CIERRE DE PERIODO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES HUECOS QUE ESTE ARCHIVO TAPA
 *
 *  1. **No había estados financieros.** Solo un balance de comprobación, que
 *     es una herramienta de contable para ver si los libros cuadran. El dueño
 *     de la operadora no pregunta «¿cuadra el mayor?»: pregunta cuánto ganó el
 *     mes y qué tiene. Eso son el estado de resultados y el balance general, y
 *     no existían.
 *
 *  2. **Nada impedía contabilizar dentro de un mes ya declarado.** El 607 se
 *     envía el día 20 y el sistema aceptaba tan tranquilamente un asiento con
 *     fecha del mes anterior. A partir de ahí lo declarado y los libros dicen
 *     cosas distintas, y la diferencia solo aparece cuando la DGII cruza.
 *
 *  3. **`3201 Resultados acumulados` estaba en el plan de cuentas y nada
 *     escribía en él.** Sin el asiento de cierre, los ingresos y los gastos se
 *     acumulan para siempre: el segundo año arrastra el primero y el balance
 *     general no cuadra nunca.
 *
 * Todo lo de aquí es puro: clasifica, suma y decide. Quien lee la base y
 * escribe asientos es `financials-service.ts`.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ═══════════════════════════════════════════════ clasificar las cuentas */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense" | "contra";

/**
 * De qué lado vive cada tipo de cuenta.
 *
 * `contra` es el caso que se cuela: «descuentos y devoluciones» es una cuenta
 * de INGRESO que vive del lado del débito. Tratarla como gasto la sacaría de la
 * línea de ventas del estado de resultados y el margen saldría mal.
 */
export const NORMAL_SIDE: Record<AccountType, "debit" | "credit"> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
  expense: "debit",
  contra: "debit",
};

/** Las cuentas cuyo saldo se lleva a resultados al cerrar el ejercicio. */
export const RESULT_TYPES = new Set<AccountType>(["revenue", "expense", "contra"]);
/** Las que permanecen de un ejercicio al siguiente. */
export const BALANCE_TYPES = new Set<AccountType>(["asset", "liability", "equity"]);

export interface AccountBalance {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

/**
 * El saldo de una cuenta con el signo de SU lado.
 *
 * Una cuenta de activo con 100 de débito y 30 de crédito tiene 70; una de
 * pasivo con los mismos números tiene −70, que en su lado son 70 de deuda.
 * Devolver siempre débito menos crédito obligaría a cada consumidor a saber el
 * lado de cada cuenta, y ahí es donde se cuela el signo cambiado.
 */
export function balanceOf(row: AccountBalance): number {
  const type = (row.type || "asset") as AccountType;
  const diff = num(row.debit) - num(row.credit);
  return round2(NORMAL_SIDE[type] === "credit" ? -diff : diff);
}

/* ═══════════════════════════════════════════════ estado de resultados */

export interface IncomeStatement {
  revenue: { code: string; name: string; amount: number }[];
  expenses: { code: string; name: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  grossMargin: number;
  netIncome: number;
  marginPct: number;
}

/** Cuentas de costo directo: lo que cuesta operar lo vendido. */
export const COST_OF_SALES_PREFIX = "51";

/**
 * Lo que la empresa ganó o perdió en el periodo.
 *
 * Las cuentas `contra` restan del ingreso, no suman al gasto: un descuento no
 * es un costo de operar, es venta que no se hizo. Meterlo entre los gastos
 * inflaría a la vez las ventas y los costos, y el margen bruto saldría mal
 * aunque el resultado neto cuadrara.
 */
export function incomeStatement(rows: AccountBalance[]): IncomeStatement {
  const revenue: IncomeStatement["revenue"] = [];
  const expenses: IncomeStatement["expenses"] = [];
  let totalRevenue = 0;
  let totalExpenses = 0;
  let costOfSales = 0;

  for (const row of rows) {
    const type = (row.type || "") as AccountType;
    const amount = balanceOf(row);
    if (type === "revenue") {
      revenue.push({ code: row.code, name: row.name, amount });
      totalRevenue = round2(totalRevenue + amount);
    } else if (type === "contra") {
      // Su saldo natural es deudor: resta de las ventas.
      revenue.push({ code: row.code, name: row.name, amount: round2(-amount) });
      totalRevenue = round2(totalRevenue - amount);
    } else if (type === "expense") {
      expenses.push({ code: row.code, name: row.name, amount });
      totalExpenses = round2(totalExpenses + amount);
      if (row.code.startsWith(COST_OF_SALES_PREFIX)) costOfSales = round2(costOfSales + amount);
    }
  }

  const netIncome = round2(totalRevenue - totalExpenses);
  return {
    revenue: revenue.sort((a, b) => a.code.localeCompare(b.code)),
    expenses: expenses.sort((a, b) => a.code.localeCompare(b.code)),
    totalRevenue,
    totalExpenses,
    grossMargin: round2(totalRevenue - costOfSales),
    netIncome,
    marginPct: totalRevenue > 0 ? round2((netIncome / totalRevenue) * 100) : 0,
  };
}

/* ═════════════════════════════════════════════════════ balance general */

export interface BalanceSheet {
  assets: { code: string; name: string; amount: number }[];
  liabilities: { code: string; name: string; amount: number }[];
  equity: { code: string; name: string; amount: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** El resultado del ejercicio, todavía sin llevar a resultados acumulados. */
  currentResult: number;
  difference: number;
  balanced: boolean;
}

/** Diferencia por debajo de la cual el balance se considera cuadrado. */
export const BALANCE_TOLERANCE = 0.01;

/**
 * Lo que la empresa tiene y lo que debe.
 *
 * El detalle que casi siempre se olvida: el resultado del ejercicio EN CURSO no
 * está todavía en `Resultados acumulados` —eso lo hace el asiento de cierre— y
 * sin sumarlo al patrimonio el balance no cuadra nunca. Aquí se incluye como
 * línea propia, que además es como lo espera ver un contador.
 */
export function balanceSheet(rows: AccountBalance[]): BalanceSheet {
  const assets: BalanceSheet["assets"] = [];
  const liabilities: BalanceSheet["liabilities"] = [];
  const equity: BalanceSheet["equity"] = [];
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const row of rows) {
    const type = (row.type || "") as AccountType;
    const amount = balanceOf(row);
    if (type === "asset") {
      assets.push({ code: row.code, name: row.name, amount });
      totalAssets = round2(totalAssets + amount);
    } else if (type === "liability") {
      liabilities.push({ code: row.code, name: row.name, amount });
      totalLiabilities = round2(totalLiabilities + amount);
    } else if (type === "equity") {
      equity.push({ code: row.code, name: row.name, amount });
      totalEquity = round2(totalEquity + amount);
    }
  }

  const currentResult = incomeStatement(rows).netIncome;
  const equityWithResult = round2(totalEquity + currentResult);
  const difference = round2(totalAssets - (totalLiabilities + equityWithResult));

  return {
    assets: assets.sort((a, b) => a.code.localeCompare(b.code)),
    liabilities: liabilities.sort((a, b) => a.code.localeCompare(b.code)),
    equity: equity.sort((a, b) => a.code.localeCompare(b.code)),
    totalAssets,
    totalLiabilities,
    totalEquity: equityWithResult,
    currentResult,
    difference,
    balanced: Math.abs(difference) <= BALANCE_TOLERANCE,
  };
}

/* ═══════════════════════════════════════════════════ cierre de periodo */

export type PeriodStatus = "open" | "closed" | "locked";

/** Un periodo en `YYYY-MM`. */
export function periodOf(dateISO: string): string {
  return String(dateISO || "").slice(0, 7);
}

/** ¿Es un periodo con forma de periodo? */
export function isPeriod(value: unknown): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ""));
}

/** El periodo anterior a uno dado. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface PeriodRow {
  period?: string | null;
  status?: string | null;
}

/**
 * ¿Se puede contabilizar con esta fecha?
 *
 * Devuelve el motivo o `null`. `closed` es el cierre normal del contador —se
 * puede reabrir— y `locked` es lo ya declarado a la DGII, que no se reabre
 * desde el sistema: si hay que corregirlo, se hace con una rectificativa y eso
 * es una conversación con el contador, no un botón.
 */
export function postingBlocker(period: string, periods: PeriodRow[]): string | null {
  const row = periods.find((p) => p.period === period);
  if (!row) return null;
  const status = String(row.status || "open");
  if (status === "closed") {
    return `El periodo ${period} está cerrado. Reábrelo si de verdad hay que contabilizar ahí.`;
  }
  if (status === "locked") {
    return `El periodo ${period} está bloqueado: ya se declaró a la DGII. Una corrección va por rectificativa, no por un asiento nuevo.`;
  }
  return null;
}

export type PeriodAction = "close" | "reopen" | "lock";

/**
 * Qué se puede hacer con un periodo.
 *
 * Bloquear exige haberlo cerrado antes: bloquear sin cerrar saltaría la
 * revisión del contador, que es precisamente el paso que hace que lo declarado
 * valga algo.
 */
export function periodTransition(
  status: string | null | undefined,
  action: PeriodAction
): { ok: true; next: PeriodStatus } | { ok: false; reason: string } {
  const s = (status || "open") as PeriodStatus;
  if (action === "close") {
    if (s === "closed") return { ok: false, reason: "El periodo ya estaba cerrado." };
    if (s === "locked") return { ok: false, reason: "Un periodo declarado no se vuelve a cerrar." };
    return { ok: true, next: "closed" };
  }
  if (action === "lock") {
    if (s === "open") return { ok: false, reason: "Ciérralo antes de darlo por declarado." };
    if (s === "locked") return { ok: false, reason: "Ya estaba marcado como declarado." };
    return { ok: true, next: "locked" };
  }
  if (s === "open") return { ok: false, reason: "El periodo ya estaba abierto." };
  if (s === "locked") {
    return { ok: false, reason: "Un periodo declarado a la DGII no se reabre desde aquí: corrige por rectificativa." };
  }
  return { ok: true, next: "open" };
}

/* ═════════════════════════════════════════════════ el asiento de cierre */

/** La cuenta donde se acumula el resultado de los ejercicios cerrados. */
export const RETAINED_EARNINGS = "3201";

export interface ClosingLine {
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

/**
 * El asiento que lleva el resultado del ejercicio a resultados acumulados.
 *
 * Cada cuenta de resultado se salda contra su propio lado —una de ingreso se
 * debita, una de gasto se acredita— y la diferencia va a `3201`. Sin esto, los
 * ingresos y los gastos de un año siguen ahí el año siguiente y el estado de
 * resultados del segundo ejercicio incluye el primero.
 *
 * Devuelve `[]` cuando no hay nada que cerrar: un ejercicio sin movimiento no
 * necesita un asiento con dos líneas en cero.
 */
export function closingEntry(rows: AccountBalance[], memo = "Cierre del ejercicio"): ClosingLine[] {
  const lines: ClosingLine[] = [];
  let result = 0;

  for (const row of rows) {
    const type = (row.type || "") as AccountType;
    if (!RESULT_TYPES.has(type)) continue;
    const amount = balanceOf(row);
    if (Math.abs(amount) < 0.005) continue;

    // Se salda por el lado contrario al suyo.
    if (NORMAL_SIDE[type] === "credit") {
      lines.push({ account: row.code, debit: round2(amount), memo });
      result = round2(result + amount);
    } else {
      lines.push({ account: row.code, credit: round2(amount), memo });
      result = round2(result - amount);
    }
  }

  if (lines.length === 0) return [];

  // El resultado va a acumulados: ganancia al crédito, pérdida al débito.
  lines.push(
    result >= 0
      ? { account: RETAINED_EARNINGS, credit: round2(result), memo }
      : { account: RETAINED_EARNINGS, debit: round2(-result), memo }
  );
  return lines;
}

/* ═════════════════════════════════════════════ exportación al contador */

export const STATEMENT_COLUMNS = ["Codigo", "Cuenta", "Tipo", "Debe", "Haber", "Saldo"] as const;

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * El balance de comprobación en CSV, que es lo que el contador pide.
 *
 * Con el saldo ya con el signo de su lado: un contable que recibe débito y
 * crédito sueltos tiene que volver a hacer la resta, y la hace en Excel.
 */
export function trialBalanceCsv(rows: AccountBalance[]): string {
  const out = [STATEMENT_COLUMNS.join(",")];
  let debit = 0;
  let credit = 0;
  for (const row of rows) {
    debit = round2(debit + num(row.debit));
    credit = round2(credit + num(row.credit));
    out.push([row.code, row.name, row.type, num(row.debit), num(row.credit), balanceOf(row)].map(csvCell).join(","));
  }
  out.push(["", "TOTALES", "", debit, credit, ""].map(csvCell).join(","));
  return out.join("\n");
}
