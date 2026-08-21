/**
 * Validates TABLE_SPECS against the real Postgres schema. Every ref/yn/json
 * field in every spec must be an actual column of its target table, so a wrong
 * column name is caught before the ETL ever runs.
 *
 * Usage: node scripts/migrate/validate-specs.mjs <columns.json>
 *   columns.json = { "<table>": ["col1","col2",...], ... }  (from information_schema)
 */
import fs from "node:fs";
import { TABLE_SPECS } from "./transform.mjs";

const GLOBAL_TABLES = new Set(["plan", "stripe_event"]); // no organization_id
const cols = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let bad = 0;
const seenTargets = new Set();

for (const s of TABLE_SPECS) {
  const t = s.target;
  if (seenTargets.has(t)) { console.error(`✗ duplicate spec target: ${t}`); bad++; }
  seenTargets.add(t);

  const set = new Set(cols[t]);
  if (!cols[t]) { console.error(`✗ target table missing in schema: ${t}`); bad++; continue; }
  if (!set.has("id")) { console.error(`✗ ${t}: no 'id' column`); bad++; }
  if (!GLOBAL_TABLES.has(t) && !set.has("organization_id")) {
    console.error(`✗ ${t}: no 'organization_id' column`); bad++;
  }
  for (const [f, c] of Object.entries(s.refs || {})) {
    if (!set.has(c)) { console.error(`✗ ${t}: ref ${f} → ${c} is NOT a column`); bad++; }
  }
  for (const y of s.yn || []) if (!set.has(y)) { console.error(`✗ ${t}: yn '${y}' is NOT a column`); bad++; }
  for (const j of s.json || []) if (!set.has(j)) { console.error(`✗ ${t}: json '${j}' is NOT a column`); bad++; }
}

console.log(bad
  ? `\n❌ ${bad} problema(s) en TABLE_SPECS`
  : `\n✅ TABLE_SPECS válido contra el esquema — ${TABLE_SPECS.length} tablas, todas las columnas existen`);
process.exit(bad ? 1 : 0);
