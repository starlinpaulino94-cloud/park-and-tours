#!/usr/bin/env node
/**
 * Safe aggregate verification for Supabase Auth cutover readiness.
 * Prints counts only; never logs emails, names, tokens, or row payloads.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function count(table, filters = {}) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return total ?? 0;
}

async function main() {
  const [tenants, partners, memberships, active, primary] = await Promise.all([
    count("organizations", { kind: "tenant" }),
    count("organizations", { kind: "partner" }),
    count("organization_memberships"),
    count("organization_memberships", { status: "active" }),
    count("organization_memberships", { is_primary: true }),
  ]);

  console.log("── Supabase Auth membership readiness (aggregate only) ──");
  console.log(`  tenant organizations: ${tenants}`);
  console.log(`  partner organizations: ${partners}`);
  console.log(`  memberships total: ${memberships}`);
  console.log(`  memberships active: ${active}`);
  console.log(`  memberships primary: ${primary}`);

  if (active === 0) {
    console.log("\n❌ No active memberships. Do not deploy with SUPABASE_USE_RLS=true until memberships are created.");
    process.exit(2);
  }
  if (primary === 0) {
    console.log("\n❌ No primary memberships. The JWT hook may choose an unexpected org per user.");
    process.exit(2);
  }
  console.log("\n✅ Aggregate membership check passed. Still verify the Supabase Auth hook in staging before RLS cutover.");
}

main().catch((error) => {
  console.error("Membership verification failed:", error.message);
  process.exit(1);
});
