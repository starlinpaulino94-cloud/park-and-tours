/**
 * ETL: Totalum → Supabase (M5).  Extract → Transform → (Backup) → Load.
 * Idempotent: rows are upserted on their deterministic uuid, so re-runs converge.
 *
 * Requires env: TOTALUM_API_KEY, TOTALUM_API_URL,
 *               NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:  node scripts/migrate/etl.mjs            # full load
 *       node scripts/migrate/etl.mjs --backup   # dump Totalum to JSON only
 *
 * Loads in FK-dependency order: company → organizations(kind='tenant'), then
 * partner → organizations(kind='partner') + organization_relationships, then the
 * business tables. `user` → organization_memberships is done in the Auth migration
 * (M3), not here, because memberships FK to auth.users.
 */
import fs from "node:fs";
import path from "node:path";
import { TotalumApiSdk } from "totalum-api-sdk";
import { createClient } from "@supabase/supabase-js";
import {
  TABLE_SPECS, transformRecord, toUuid, refId, partnerToOrg, partnerToRelationship,
} from "./transform.mjs";

// Real Postgres columns per table (from the migrations) — used to drop Totalum
// fields that have no matching column, so upserts never fail on unknown columns.
const SCHEMA_COLS = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "scripts/migrate/schema-columns.json"), "utf8")
);
const allowedCols = (table) => new Set(SCHEMA_COLS[table] || []);

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const BACKUP_ONLY = process.argv.includes("--backup");
const BACKUP_DIR = path.resolve(process.cwd(), "scripts/migrate/backup");

const totalum = new TotalumApiSdk({ apiKey: { "api-key": process.env.TOTALUM_API_KEY } });
totalum.changeBaseUrl(process.env.TOTALUM_API_URL || "https://api.totalum.app/");

const supabase = BACKUP_ONLY ? null : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── extract (paginated) ──────────────────────────────────────────────────────
async function extractAll(table) {
  const rows = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const res = await totalum.crud.query(table, { _limit: pageSize, _offset: offset });
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function backup(table, rows) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, `${table}.json`), JSON.stringify(rows, null, 2));
}

// ── load (batched upsert) ────────────────────────────────────────────────────
async function loadRows(target, rows) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(target).upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`load ${target}: ${error.message}`);
  }
}

// ── company → organizations(kind='tenant') ───────────────────────────────────
async function loadOrganizations() {
  const companies = await extractAll("company");
  backup("company", companies);
  if (BACKUP_ONLY) return companies.length;
  const orgs = companies.map((c) => ({
    id: toUuid(c._id),
    kind: "tenant",
    tenant_org_id: toUuid(c._id),
    name: c.name,
    slug: c.slug,
    legal_name: c.legal_name,
    tax_id: c.tax_id,
    email: c.email,
    phone: c.phone,
    country: c.country,
    timezone: c.timezone,
    currency: c.base_currency,
    company_type: c.company_type,
    subscription_status: c.subscription_status,
    modules_enabled: c.modules_enabled || [],
    stripe_customer_id: c.stripe_customer_id,
    stripe_subscription_id: c.stripe_subscription_id,
    status: c.status || "active",
  }));
  await loadRows("organizations", orgs);
  return orgs.length;
}

// ── partner → organizations(kind='partner') + organization_relationships ───────
// Must run AFTER tenants (FK tenant_org_id) and BEFORE business tables that
// reference partner_id. `user`→organization_memberships is deliberately NOT here:
// memberships FK to auth.users, so they are created during the Auth migration (M3)
// via the Supabase Auth Admin API, not in this data-only ETL.
async function loadPartners() {
  const partners = await extractAll("partner");
  backup("partner", partners);
  if (BACKUP_ONLY) return { partners: partners.length, relationships: 0 };

  const orgs = partners.map(partnerToOrg);
  await loadRows("organizations", orgs); // upsert onConflict:id — tenants already loaded

  const rels = partners.map(partnerToRelationship).filter(Boolean);
  if (rels.length) await loadRows("organization_relationships", rels);

  return { partners: orgs.length, relationships: rels.length };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(BACKUP_ONLY ? "→ BACKUP ONLY (no load)\n" : "→ ETL Totalum → Supabase\n");
  const counts = {};
  counts.organizations = await loadOrganizations();
  console.log(`  organizations (tenants): ${counts.organizations}`);

  const partnerCounts = await loadPartners();
  counts.organizations += partnerCounts.partners;
  counts.organization_relationships = partnerCounts.relationships;
  console.log(`  organizations (partners): ${partnerCounts.partners}`);
  console.log(`  organization_relationships: ${partnerCounts.relationships}`);

  for (const spec of TABLE_SPECS) {
    if (spec.source === "company") continue; // handled above
    const raw = await extractAll(spec.source);
    backup(spec.source, raw);
    counts[spec.target] = raw.length;
    if (!BACKUP_ONLY) {
      const cols = allowedCols(spec.target);
      const rows = raw.map((r) => transformRecord(spec, r, undefined, cols));
      await loadRows(spec.target, rows);
    }
    console.log(`  ${spec.target}: ${raw.length}`);
  }

  fs.writeFileSync(path.join(BACKUP_DIR, "_counts.json"), JSON.stringify(counts, null, 2));
  console.log(`\n✓ ${BACKUP_ONLY ? "backup" : "load"} complete. Now run: node scripts/migrate/reconcile.mjs`);
}

main().catch((e) => { console.error("ETL failed:", e); process.exit(1); });
