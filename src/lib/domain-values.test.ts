import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as labels from "@/lib/labels";

/**
 * Los diccionarios de la UI contra el dominio real de la base.
 *
 * Cada `select` del ERP se alimenta de un diccionario de etiquetas, pero la
 * columna que recibe el valor está acotada por un `check (... in (...))` o por
 * un tipo `enum`. Los dos lados se escribieron por separado y se separaron:
 *
 *  - `payment.method` recibía 'payment_link', 'b2b_credit' y 'mixed', que el
 *    enum `payment_method` no admite: el cobro fallaba en la base.
 *  - `lead.source` recibía valores de CHANNEL (canal de venta), y a la vez no
 *    dejaba registrar referido, hotel ni campaña.
 *  - `commission_rule.beneficiary_type` ofrecía guía y proveedor (inexistentes)
 *    y escondía 'company'.
 *
 * Esta prueba lee las migraciones en cada ejecución, así que cualquier deriva
 * futura —en la base o en la UI— rompe aquí en vez de en producción.
 */

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

function readMigrations(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

const SQL = readMigrations();

/** Valores de cada tipo enum declarado. */
function enumValues(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of SQL.matchAll(/create type\s+(\w+)\s+as\s+enum\s*\(([\s\S]*?)\);/gi)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
  }
  for (const m of SQL.matchAll(/alter type\s+(\w+)\s+add value(?:\s+if not exists)?\s+'([^']+)'/gi)) {
    (out[m[1]] ||= []).push(m[2]);
  }
  return out;
}

/** Dominio permitido de `tabla.columna`, venga de un check o de un enum. */
function allowedFor(table: string, column: string): string[] {
  const enums = enumValues();
  for (const m of SQL.matchAll(/create table (\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    if (m[1] !== table) continue;
    const body = m[2];

    const check = [...body.matchAll(/check\s*\(\s*(\w+)\s+in\s*\(([\s\S]*?)\)\s*\)/gi)]
      .find((c) => c[1] === column);
    if (check) return [...check[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);

    for (const line of body.split("\n")) {
      const lm = /^\s*(\w+)\s+(\w+)\b/.exec(line);
      if (lm && lm[1] === column && enums[lm[2]]) return enums[lm[2]];
    }
  }
  return [];
}

/** Diccionario de la UI -> columna que recibe sus valores. */
const BINDINGS: [keyof typeof labels, string, string][] = [
  ["PAYMENT_METHOD", "payment", "method"],
  ["EXPENSE_METHOD", "expense", "payment_method"],
  ["LEAD_SOURCE", "lead", "source"],
  ["LEAD_STATUS", "lead", "status"],
  ["CHANNEL", "booking", "channel"],
  ["BENEFICIARY_TYPE", "commission", "beneficiary_type"],
  ["CALC_TYPE", "commission", "calc_type"],
  ["BOOKING_STATUS", "booking", "status"],
  ["CHECKIN_STATUS", "booking", "checkin_status"],
  ["DEPARTURE_STATUS", "departure", "status"],
  ["PAYMENT_STATUS", "payment", "status"],
  ["COMMISSION_STATUS", "commission", "status"],
  ["SETTLEMENT_STATUS", "settlement", "status"],
  ["VOUCHER_STATUS", "voucher", "status"],
  ["ACTIVE_STATUS", "hotel", "status"],
];

describe("los diccionarios de la UI coinciden con el dominio de la base", () => {
  it.each(BINDINGS)("%s ↔ %s.%s", (dictName, table, column) => {
    const allowed = allowedFor(table, column);
    // Si esto falla, la migración cambió de forma y hay que revisar el parser.
    expect(allowed.length, `sin dominio para ${table}.${column}`).toBeGreaterThan(0);

    const offered = Object.keys(labels[dictName] as Record<string, unknown>);
    const rejected = offered.filter((v) => !allowed.includes(v));
    const notOffered = allowed.filter((v) => !offered.includes(v));

    // Ofrecer un valor que la columna rechaza hace fallar la escritura.
    expect(rejected, `${dictName} ofrece valores que ${table}.${column} rechaza`).toEqual([]);
    // No ofrecerlo hace que ese dato no se pueda registrar nunca.
    expect(notOffered, `${table}.${column} admite valores que ${dictName} no ofrece`).toEqual([]);
  });
});
