import "server-only";
import { tenantCreate, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";

/**
 * Double-entry ledger.
 *
 * Every posting is a set of lines that must balance to zero. Lines are never
 * edited or deleted: a mistake is corrected with a reversing entry, so the
 * history of what the books said at any point stays intact.
 */

export type LedgerSource =
  | "sale" | "payment" | "refund" | "commission" | "settlement" | "expense" | "payable"
  | "purchase" | "inventory" | "payroll" | "adjustment" | "opening" | "tax"
  | "gift_card" | "membership";

export interface LedgerLine {
  /** Account code (e.g. "1101") or account `_id`. */
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface PostingInput {
  source: LedgerSource;
  lines: LedgerLine[];
  memo?: string;
  postedAt?: string;
  currency?: string;
  exchangeRate?: number;
  /** Links back to the business document that caused the posting. */
  refs?: Partial<Record<
    "order" | "payment" | "invoice" | "settlement" | "expense" | "payable" |
    "receivable" | "purchase_order" | "stock_movement", string
  >>;
  userId?: string;
}

const CENT = 100;
const round = (n: number) => Math.round(n * CENT) / CENT;

/** The seed chart of accounts, with the subledgers the blueprint requires. */
export const DEFAULT_CHART: {
  code: string; name: string; account_type: string; subledger?: string; normal_side: string;
}[] = [
  { code: "1101", name: "Caja general", account_type: "asset", subledger: "cash", normal_side: "debit" },
  { code: "1102", name: "Bancos", account_type: "asset", subledger: "bank", normal_side: "debit" },
  { code: "1103", name: "Tarjetas por liquidar", account_type: "asset", subledger: "bank", normal_side: "debit" },
  { code: "1201", name: "Cuentas por cobrar clientes", account_type: "asset", subledger: "receivable", normal_side: "debit" },
  { code: "1202", name: "Cuentas por cobrar socios", account_type: "asset", subledger: "receivable", normal_side: "debit" },
  { code: "1301", name: "Inventario de mercancía", account_type: "asset", subledger: "inventory", normal_side: "debit" },
  { code: "1302", name: "Inventario de repuestos", account_type: "asset", subledger: "inventory", normal_side: "debit" },
  { code: "1501", name: "Activo fijo", account_type: "asset", subledger: "fixed_asset", normal_side: "debit" },
  { code: "2101", name: "Cuentas por pagar proveedores", account_type: "liability", subledger: "payable", normal_side: "credit" },
  { code: "2102", name: "Comisiones por pagar", account_type: "liability", subledger: "commission", normal_side: "credit" },
  { code: "2103", name: "Impuestos por pagar", account_type: "liability", subledger: "tax", normal_side: "credit" },
  { code: "2104", name: "Sueldos por pagar", account_type: "liability", subledger: "payroll", normal_side: "credit" },
  { code: "2201", name: "Ingresos diferidos (reservas)", account_type: "liability", subledger: "deferred_revenue", normal_side: "credit" },
  { code: "2202", name: "Pasivo por gift cards", account_type: "liability", subledger: "gift_card_liability", normal_side: "credit" },
  { code: "2203", name: "Pasivo por membresías", account_type: "liability", subledger: "membership_liability", normal_side: "credit" },
  { code: "3101", name: "Capital", account_type: "equity", normal_side: "credit" },
  { code: "3201", name: "Resultados acumulados", account_type: "equity", normal_side: "credit" },
  { code: "4101", name: "Ingresos por excursiones", account_type: "revenue", normal_side: "credit" },
  { code: "4102", name: "Ingresos por entradas al parque", account_type: "revenue", normal_side: "credit" },
  { code: "4103", name: "Ingresos por tienda y F&B", account_type: "revenue", normal_side: "credit" },
  { code: "4104", name: "Ingresos por membresías", account_type: "revenue", normal_side: "credit" },
  { code: "4201", name: "Descuentos y devoluciones", account_type: "contra", normal_side: "debit" },
  { code: "5101", name: "Costo de servicios operados", account_type: "expense", normal_side: "debit" },
  { code: "5102", name: "Costo de mercancía vendida", account_type: "expense", normal_side: "debit" },
  { code: "5103", name: "Comisiones de venta", account_type: "expense", subledger: "commission", normal_side: "debit" },
  { code: "5201", name: "Nómina", account_type: "expense", subledger: "payroll", normal_side: "debit" },
  { code: "5202", name: "Mantenimiento", account_type: "expense", normal_side: "debit" },
  { code: "5203", name: "Mermas de inventario", account_type: "expense", normal_side: "debit" },
  { code: "5204", name: "Gastos operativos", account_type: "expense", normal_side: "debit" },
  { code: "5205", name: "Comisiones bancarias", account_type: "expense", normal_side: "debit" },
];

/** Creates any missing account from the default chart. Safe to call repeatedly. */
export async function ensureChart(companyId: string): Promise<number> {
  const existing = await tenantQuery<any>(companyId, "ledger_account", { _limit: 500 });
  const have = new Set(existing.map((a) => a.code));
  let created = 0;
  for (const account of DEFAULT_CHART) {
    if (have.has(account.code)) continue;
    await tenantCreate(companyId, "ledger_account", {
      ...account,
      subledger: account.subledger || null,
      is_postable: "yes",
      balance: 0,
      status: "active",
    });
    created++;
  }
  if (created > 0) console.log(`[ledger] plan de cuentas: ${created} cuentas creadas`);
  return created;
}

/** Resolves account codes/ids to account records, failing loudly on unknown codes. */
async function resolveAccounts(companyId: string, codes: string[]) {
  const accounts = await tenantQuery<any>(companyId, "ledger_account", { _limit: 500 });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byId = new Map(accounts.map((a) => [a._id, a]));
  const out = new Map<string, any>();
  for (const code of codes) {
    const account = byCode.get(code) || byId.get(code);
    if (!account) {
      throw new TenantError(
        `La cuenta contable "${code}" no existe. Crea el plan de cuentas antes de contabilizar.`,
        400
      );
    }
    out.set(code, account);
  }
  return out;
}

/**
 * Posts a balanced entry. Returns the entry code and the lines written.
 * Throws when debits and credits differ — an unbalanced entry is never stored.
 */
export async function post(companyId: string, input: PostingInput) {
  const lines = (input.lines || []).filter((l) => (l.debit || 0) !== 0 || (l.credit || 0) !== 0);
  if (lines.length < 2) {
    throw new TenantError("Un asiento necesita al menos dos líneas", 400);
  }

  const debit = round(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credit = round(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (debit !== credit) {
    throw new TenantError(
      `El asiento no cuadra: débitos ${debit} vs créditos ${credit}. Diferencia ${round(debit - credit)}.`,
      400
    );
  }

  const accounts = await resolveAccounts(companyId, [...new Set(lines.map((l) => l.account))]);
  const postedAt = input.postedAt || new Date().toISOString();
  const period = postedAt.slice(0, 7); // YYYY-MM
  const entryCode = `AS-${period.replace("-", "")}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const rate = Number(input.exchangeRate ?? 1) || 1;

  const written: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const account = accounts.get(line.account)!;
    const amount = Number(line.debit || 0) - Number(line.credit || 0);

    const row = await tenantCreate<{ _id: string }>(companyId, "ledger_entry", {
      entry_code: entryCode,
      line_no: i + 1,
      posted_at: postedAt,
      period,
      ledger_account: account._id,
      debit: round(Number(line.debit || 0)),
      credit: round(Number(line.credit || 0)),
      currency: input.currency || null,
      exchange_rate: rate,
      amount_base: round(amount * rate),
      memo: line.memo || input.memo || null,
      source_type: input.source,
      reversed: "no",
      user: input.userId || null,
      ...(input.refs || {}),
    });
    written.push(row._id);

    // Running balance on the account, in its normal side's sign.
    const delta = account.normal_side === "credit" ? -amount : amount;
    await tenantUpdate(companyId, "ledger_account", account._id, {
      balance: round(Number(account.balance ?? 0) + delta),
    });
    account.balance = round(Number(account.balance ?? 0) + delta);
  }

  console.log(`[ledger] ${entryCode} (${input.source}) ${lines.length} líneas, ${debit} balanceado`);
  return { entryCode, lines: written, total: debit };
}

/** Reverses an entry by posting its mirror image and flagging the original. */
export async function reverse(companyId: string, entryCode: string, userId?: string) {
  const rows = await tenantQuery<any>(companyId, "ledger_entry", {
    ledger_account: true,
    _filter: { entry_code: entryCode, reversed: "no" },
    _sort: { line_no: "asc" },
    _limit: 200,
  });
  if (rows.length === 0) {
    throw new TenantError(`No se encontró el asiento ${entryCode} o ya fue reversado`, 404);
  }

  const result = await post(companyId, {
    source: "adjustment",
    memo: `Reversa de ${entryCode}`,
    userId,
    lines: rows.map((r) => ({
      account: r.ledger_account?.code || r.ledger_account?._id,
      debit: Number(r.credit || 0),
      credit: Number(r.debit || 0),
      memo: `Reversa: ${r.memo || ""}`.trim(),
    })),
  });

  for (const r of rows) {
    await tenantUpdate(companyId, "ledger_entry", r._id, { reversed: "yes", reversal_of: result.entryCode });
  }
  console.log(`[ledger] ${entryCode} reversado por ${result.entryCode}`);
  return result;
}

/** Trial balance grouped by account — the report that proves the books balance. */
export async function trialBalance(companyId: string, period?: string) {
  const entries = await tenantQuery<any>(companyId, "ledger_entry", {
    ledger_account: true,
    _filter: period ? { period } : {},
    _limit: 5000,
  });

  const byAccount = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  for (const e of entries) {
    const account = e.ledger_account;
    if (!account) continue;
    const key = account._id;
    const row = byAccount.get(key) || {
      code: account.code, name: account.name, type: account.account_type, debit: 0, credit: 0,
    };
    row.debit += Number(e.debit || 0);
    row.credit += Number(e.credit || 0);
    byAccount.set(key, row);
  }

  const rows = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  const totals = rows.reduce(
    (acc, r) => ({ debit: round(acc.debit + r.debit), credit: round(acc.credit + r.credit) }),
    { debit: 0, credit: 0 }
  );
  return { rows, totals, balanced: totals.debit === totals.credit };
}
