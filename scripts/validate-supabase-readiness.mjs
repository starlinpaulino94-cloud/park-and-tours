#!/usr/bin/env node
/**
 * Supabase production-readiness validation.
 * Safe output only: prints counts/status, never tokens, emails, names, or row payloads.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFiles = [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"];
for (const envFile of envFiles) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_USE_RLS",
  "NEXT_PUBLIC_APP_URL",
];

const REQUIRED_TABLES = [
  "organizations",
  "organization_memberships",
  "organization_relationships",
  "plan",
  "product",
  "product_modality",
  "customer",
  "sales_order",
  "booking",
  "payment",
  "commission",
  "settlement",
  "audit_log",
];

const BUSINESS_TABLES = [
  "organizations",
  "organization_memberships",
  "product",
  "customer",
  "sales_order",
  "booking",
  "payment",
  "commission",
];

let failed = false;
let warnings = 0;

function fail(message) {
  failed = true;
  console.log(`❌ ${message}`);
}

function warn(message) {
  warnings += 1;
  console.log(`⚠️  ${message}`);
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function info(message) {
  console.log(`• ${message}`);
}

function assertConfigured() {
  console.log("── Environment ──");
  for (const key of REQUIRED_ENV) {
    if (process.env[key]) pass(`${key} configured`);
    else fail(`${key} missing`);
  }
  if (process.env.SUPABASE_USE_RLS && process.env.SUPABASE_USE_RLS !== "true") {
    fail("SUPABASE_USE_RLS must be true for production cutover");
  }
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

async function count(sb, table, filters = {}) {
  let query = sb.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return total ?? 0;
}

async function validateTables(sb) {
  console.log("\n── Schema / migrations ──");
  for (const table of REQUIRED_TABLES) {
    try {
      await count(sb, table);
      pass(`${table} reachable`);
    } catch (error) {
      fail(`${table} not reachable (${error.message})`);
    }
  }
}

async function validateCounts(sb) {
  console.log("\n── Data counts ──");
  for (const table of BUSINESS_TABLES) {
    try {
      info(`${table}: ${await count(sb, table)}`);
    } catch (error) {
      fail(`Could not count ${table} (${error.message})`);
    }
  }
}

async function validateAuth(sb) {
  console.log("\n── Auth / memberships ──");
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    fail(`Could not list Supabase Auth users (${error.message})`);
    return;
  }
  const authUsers = data.users.length;
  info(`auth.users listed: ${authUsers}${authUsers === 1000 ? "+" : ""}`);

  const [tenants, partners, memberships, active, primary] = await Promise.all([
    count(sb, "organizations", { kind: "tenant" }),
    count(sb, "organizations", { kind: "partner" }),
    count(sb, "organization_memberships"),
    count(sb, "organization_memberships", { status: "active" }),
    count(sb, "organization_memberships", { is_primary: true }),
  ]);
  info(`tenant organizations: ${tenants}`);
  info(`partner organizations: ${partners}`);
  info(`memberships total: ${memberships}`);
  info(`memberships active: ${active}`);
  info(`memberships primary: ${primary}`);

  if (tenants === 0) fail("No tenant organizations found");
  if (authUsers === 0) warn("No Supabase Auth users found; login cannot be validated");
  if (memberships === 0) fail("No organization_memberships rows; JWT org claims cannot be produced");
  if (active === 0) fail("No active memberships; RLS will deny tenant access");
  if (primary === 0) fail("No primary memberships; access-token hook cannot pick a deterministic org");
  if (authUsers > 0 && active > 0) pass("Auth users and active memberships exist");
}

async function validateAnonExposure() {
  console.log("\n── Anonymous exposure smoke test ──");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    warn("Skipping anon smoke test because NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");
    return;
  }

  const anon = anonClient();
  for (const table of ["customer", "booking", "payment", "organizations"]) {
    const { data, error } = await anon.from(table).select("id").limit(1);
    if (error) {
      pass(`${table}: anon read blocked (${error.code || "error"})`);
      continue;
    }
    if ((data || []).length > 0) fail(`${table}: anon can read data without a user session`);
    else pass(`${table}: anon returned no rows without a user session`);
  }
}

async function main() {
  console.log("Supabase readiness validation (safe aggregate output)\n");
  assertConfigured();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\nCannot continue without Supabase URL and service-role key.");
    process.exit(1);
  }

  const sb = serviceClient();
  await validateTables(sb);
  await validateCounts(sb);
  await validateAuth(sb);
  await validateAnonExposure();

  console.log("\n── SQL-only checks ──");
  warn("Run supabase/verify/RLS_EXPOSURE_CHECK.sql in Supabase SQL Editor to verify catalog-level RLS exposure.");
  warn("Confirm app.custom_access_token_hook is configured in Supabase Auth Hooks; this cannot be verified via PostgREST here.");

  if (failed) {
    console.log(`\n❌ Supabase readiness failed (${warnings} warning${warnings === 1 ? "" : "s"}).`);
    process.exit(2);
  }
  console.log(`\n✅ Supabase readiness passed with ${warnings} warning${warnings === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error("Readiness validation failed:", error.message);
  process.exit(1);
});
