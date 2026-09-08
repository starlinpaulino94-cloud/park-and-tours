import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as labels from "@/lib/labels";
import * as modules from "@/lib/labels-modules";

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

/**
 * Dominio permitido de `tabla.columna`, venga de un check o de un enum.
 *
 * Un `alter table ... add constraint ... check` posterior MANDA sobre lo que
 * declaró el `create table`: así es como 0029 amplió `checkin_status`. Se
 * evalúa primero para no leer un dominio ya superado.
 */
function allowedFor(table: string, column: string): string[] {
  const enums = enumValues();

  // Las migraciones se concatenan en orden, así que la última redefinición gana.
  let altered: string[] | null = null;
  for (const m of SQL.matchAll(
    /alter table\s+(\w+)\s+add constraint\s+\w+\s+check\s*\(\s*(?:\w+\s+is\s+null\s+or\s+)?(\w+)\s+in\s*\(([\s\S]*?)\)\s*\)/gi
  )) {
    if (m[1] === table && m[2] === column) {
      altered = [...m[3].matchAll(/'([^']+)'/g)].map((v) => v[1]);
    }
  }
  if (altered) return altered;

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

type Dict = Record<string, unknown>;

/** Diccionario de la UI -> columna que recibe sus valores. */
const BINDINGS: [string, Dict, string, string][] = [
  ["PAYMENT_METHOD", labels.PAYMENT_METHOD, "payment", "method"],
  ["EXPENSE_METHOD", labels.EXPENSE_METHOD, "expense", "payment_method"],
  ["LEAD_SOURCE", labels.LEAD_SOURCE, "lead", "source"],
  ["LEAD_STATUS", labels.LEAD_STATUS, "lead", "status"],
  ["CHANNEL", labels.CHANNEL, "booking", "channel"],
  ["BENEFICIARY_TYPE", labels.BENEFICIARY_TYPE, "commission", "beneficiary_type"],
  ["CALC_TYPE", labels.CALC_TYPE, "commission", "calc_type"],
  ["BOOKING_STATUS", labels.BOOKING_STATUS, "booking", "status"],
  ["CHECKIN_STATUS", labels.CHECKIN_STATUS, "booking", "checkin_status"],
  ["DEPARTURE_STATUS", labels.DEPARTURE_STATUS, "departure", "status"],
  ["PAYMENT_STATUS", labels.PAYMENT_STATUS, "payment", "status"],
  ["COMMISSION_STATUS", labels.COMMISSION_STATUS, "commission", "status"],
  ["SETTLEMENT_STATUS", labels.SETTLEMENT_STATUS, "settlement", "status"],
  ["VOUCHER_STATUS", labels.VOUCHER_STATUS, "voucher", "status"],
  ["ACTIVE_STATUS", labels.ACTIVE_STATUS, "hotel", "status"],
  ["SELLER_ROLE", labels.SELLER_ROLE, "seller", "seller_role"],
  // 0030 creó estas dos columnas con el dominio que ya usaba la UI del parque.
  ["ZONE_TYPE", modules.ZONE_TYPE, "zone", "zone_type"],
  ["YES_NO", modules.YES_NO, "zone", "requires_wristband"],
  // 0031: el tipo de partner ES el tipo de la relación comercial.
  ["PARTNER_TYPE", labels.PARTNER_TYPE, "organization_relationships", "relationship_type"],
];

describe("los diccionarios de la UI coinciden con el dominio de la base", () => {
  it.each(BINDINGS)("%s ↔ %s.%s", (dictName, dict, table, column) => {
    const allowed = allowedFor(table, column);
    // Si esto falla, la migración cambió de forma y hay que revisar el parser.
    expect(allowed.length, `sin dominio para ${table}.${column}`).toBeGreaterThan(0);

    const offered = Object.keys(dict);
    const rejected = offered.filter((v) => !allowed.includes(v));
    const notOffered = allowed.filter((v) => !offered.includes(v));

    // Ofrecer un valor que la columna rechaza hace fallar la escritura.
    expect(rejected, `${dictName} ofrece valores que ${table}.${column} rechaza`).toEqual([]);
    // No ofrecerlo hace que ese dato no se pueda registrar nunca.
    expect(notOffered, `${table}.${column} admite valores que ${dictName} no ofrece`).toEqual([]);
  });
});
