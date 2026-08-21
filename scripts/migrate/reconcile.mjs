/**
 * Reconciliation: Totalum vs Supabase (M5). The migration is NOT done until
 * counts and financial totals match. Exits non-zero on any mismatch.
 *
 * Requires env: TOTALUM_API_KEY, TOTALUM_API_URL,
 *               NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run: node scripts/migrate/reconcile.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { TotalumApiSdk } from "totalum-api-sdk";
import { createClient } from "@supabase/supabase-js";
import { TABLE_SPECS } from "./transform.mjs";

const envFiles = [
  ".env",
  `.env.${process.env.NODE_ENV || "development"}`,
  ".env.local",
];
for (const envFile of envFiles) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
const totalum = new TotalumApiSdk({ apiKey: { "api-key": process.env.TOTALUM_API_KEY } });
totalum.changeBaseUrl(process.env.TOTALUM_API_URL || "https://api.totalum.app/");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function totalumCount(table) {
  const res = await totalum.crud.query(table, { _limit: 1, _aggregate: { _count: true } });
  return res.data?.[0]?._aggregate?._count ?? 0;
}
async function supabaseCount(table, filters = {}) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

// Financial totals that MUST match to the cent.
const FINANCIAL = [
  { table: "payment",    field: "amount",       target: "payment" },
  { table: "booking",    field: "total_amount", target: "booking" },
  { table: "commission", field: "amount",       target: "commission" },
];

async function totalumSum(table, field) {
  const pageSize = 500; let sum = 0;
  for (let offset = 0; ; offset += pageSize) {
    const res = await totalum.crud.query(table, { _limit: pageSize, _offset: offset });
    const batch = res.data || [];
    for (const r of batch) sum += Number(r[field] || 0);
    if (batch.length < pageSize) break;
  }
  return Math.round(sum * 100) / 100;
}
async function supabaseSum(table, field) {
  // Uses an RPC if present; otherwise pages. Here we page for portability.
  const pageSize = 1000; let sum = 0, from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(field).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) sum += Number(r[field] || 0);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return Math.round(sum * 100) / 100;
}

async function main() {
  let ok = true;
  console.log("── Reconciliation: counts ──");
  const tables = TABLE_SPECS.filter((s) => s.source !== "company");
  const [companyCount, partnerCount, tenantCount, partnerOrgCount, relationshipCount] = await Promise.all([
    totalumCount("company"), totalumCount("partner"),
    supabaseCount("organizations", { kind: "tenant" }),
    supabaseCount("organizations", { kind: "partner" }),
    supabaseCount("organization_relationships"),
  ]);
  for (const [source, target, a, b] of [
    ["company", "organizations(kind=tenant)", companyCount, tenantCount],
    ["partner", "organizations(kind=partner)", partnerCount, partnerOrgCount],
    ["partner", "organization_relationships", partnerCount, relationshipCount],
  ]) {
    const match = a === b;
    if (!match) ok = false;
    console.log(`  ${match ? "✓" : "✗"} ${source}→${target}: Totalum ${a} / Supabase ${b}`);
  }
  for (const { source, target } of tables) {
    const [a, b] = await Promise.all([totalumCount(source), supabaseCount(target)]);
    const match = a === b;
    if (!match) ok = false;
    console.log(`  ${match ? "✓" : "✗"} ${source}→${target}: Totalum ${a} / Supabase ${b}`);
  }

  console.log("\n── Reconciliation: financial totals ──");
  for (const { table, field, target } of FINANCIAL) {
    const [a, b] = await Promise.all([totalumSum(table, field), supabaseSum(target, field)]);
    const match = Math.abs(a - b) < 0.01;
    if (!match) ok = false;
    console.log(`  ${match ? "✓" : "✗"} sum(${table}.${field}): Totalum ${a} / Supabase ${b}`);
  }

  console.log(ok ? "\n✅ RECONCILED — counts and financial totals match." : "\n❌ MISMATCH — do not cut over.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("Reconcile failed:", e); process.exit(1); });
