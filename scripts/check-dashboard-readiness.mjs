#!/usr/bin/env node
/**
 * Executive dashboard readiness validation.
 *
 * Safe output only: this prints schema status and aggregate counts, never row
 * payloads, tokens, customer data or user emails.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  const envPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const REQUIRED_TABLES = ["organizations", "booking", "payment", "departure", "product", "sales_order"];
const REQUIRED_COLUMNS = [
  { table: "booking", columns: ["branch_id", "exchange_rate", "base_currency", "base_amount", "base_refund_amount", "base_cost_amount"] },
  { table: "sales_order", columns: ["branch_id", "base_currency", "base_currency_total"] },
  { table: "payment", columns: ["base_currency", "base_amount"] },
  { table: "cash_session", columns: ["currency", "exchange_rate", "base_expected_cash"] },
];
const REQUIRED_INDEXES = [
  "booking_dashboard_period_idx",
  "booking_dashboard_product_idx",
  "booking_dashboard_branch_idx",
  "booking_dashboard_seller_idx",
  "booking_dashboard_partner_idx",
  "booking_dashboard_channel_idx",
  "payment_dashboard_paid_idx",
  "payment_dashboard_booking_idx",
  "payment_dashboard_order_idx",
  "departure_dashboard_upcoming_idx",
];

let failed = false;
let warnings = 0;

function pass(message) { console.log(`OK ${message}`); }
function info(message) { console.log(`-- ${message}`); }
function warn(message) { warnings += 1; console.log(`WARN ${message}`); }
function fail(message) { failed = true; console.log(`FAIL ${message}`); }

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runSql(sql) {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx", "supabase", "db", "query", "--linked", sql]
    : ["supabase", "db", "query", "--linked", sql];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    if (result.error) throw result.error;
    const detail = (result.stderr || result.stdout || "unknown error").trim().split("\n").slice(-1)[0];
    throw new Error(detail);
  }
  return result.stdout;
}

function outputHasTrue(output, column) {
  return new RegExp(`\\b${column}\\b[\\s\\S]*\\btrue\\b`, "i").test(output);
}

async function count(sb, table) {
  const { count: total, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return total ?? 0;
}

async function validatePostgrestAccess(sb) {
  console.log("\nTables");
  for (const table of REQUIRED_TABLES) {
    try {
      info(`${table}: ${await count(sb, table)}`);
    } catch (error) {
      fail(`${table} is not reachable through service client (${error.message})`);
    }
  }
}

function validateColumns() {
  console.log("\nColumns");
  const values = REQUIRED_COLUMNS.flatMap(({ table, columns }) => columns.map((column) => `('${table}','${column}')`)).join(",");
  const sql = `with required(table_name, column_name) as (values ${values}) select r.table_name, r.column_name, c.column_name is not null as present from required r left join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.table_name and c.column_name = r.column_name order by r.table_name, r.column_name;`;
  const output = runSql(sql);
  for (const { table, columns } of REQUIRED_COLUMNS) {
    for (const column of columns) {
      if (new RegExp(`${table}[\\s\\S]*${column}[\\s\\S]*true`, "i").test(output)) pass(`${table}.${column}`);
      else fail(`${table}.${column} missing`);
    }
  }
}

function validateIndexes() {
  console.log("\nIndexes");
  const list = REQUIRED_INDEXES.map((name) => `'${name}'`).join(",");
  const output = runSql(`select indexname from pg_indexes where schemaname = 'public' and indexname in (${list}) order by indexname;`);
  for (const index of REQUIRED_INDEXES) {
    if (output.includes(index)) pass(index);
    else fail(`${index} missing`);
  }
}

function validateRpcDefinition() {
  console.log("\nRPC dashboard_summary");
  const sql = `select pg_get_functiondef('public.dashboard_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) ilike '%app.current_org_id()%' as tenant_guard, pg_get_functiondef('public.dashboard_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) ilike '%upcoming_departures%' as has_upcoming, pg_get_functiondef('public.dashboard_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) ilike '%left join booking pb on pb.id = p.booking_id%' as payment_booking_join, pg_get_functiondef('public.dashboard_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,text,text,uuid)'::regprocedure) ilike '%p_product_id is null or pb.product_id = p_product_id%' as payment_product_filter;`;
  const output = runSql(sql);
  for (const check of ["tenant_guard", "has_upcoming", "payment_booking_join", "payment_product_filter"]) {
    if (outputHasTrue(output, check)) pass(check);
    else fail(`${check} missing in dashboard_summary`);
  }
}

function validateFinancialData() {
  console.log("\nFinancial data aggregates");
  const output = runSql(`select (select count(*) from booking) as bookings, (select count(*) from payment) as payments, (select count(*) from departure where departure_at >= now() and departure_at <= now() + interval '14 days' and status not in ('cancelled','completed')) as upcoming_14d, (select count(*) from booking where currency::text <> coalesce(base_currency::text, currency::text) and (base_amount is null or base_cost_amount is null)) as incomplete_non_base_bookings, (select count(*) from payment where currency::text <> coalesce(base_currency::text, currency::text) and base_amount is null) as incomplete_non_base_payments;`);
  console.log(output.trim());
  if (!/incomplete_non_base_bookings[\s\S]*0/i.test(output)) warn("There may be incomplete historical non-base-currency bookings");
  if (!/incomplete_non_base_payments[\s\S]*0/i.test(output)) warn("There may be incomplete historical non-base-currency payments");
}

async function main() {
  console.log("Executive dashboard readiness (safe aggregate output)");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  } else {
    await validatePostgrestAccess(serviceClient());
  }

  try {
    validateColumns();
    validateIndexes();
    validateRpcDefinition();
    validateFinancialData();
  } catch (error) {
    fail(`SQL checks could not run (${error.message})`);
    warn("Ensure Supabase CLI is logged in and the project is linked. For migration list/db lint, SUPABASE_DB_PASSWORD is still required.");
  }

  if (failed) {
    console.log(`\nFAIL dashboard readiness failed (${warnings} warning${warnings === 1 ? "" : "s"}).`);
    process.exit(2);
  }
  console.log(`\nOK dashboard readiness passed (${warnings} warning${warnings === 1 ? "" : "s"}).`);
}

main().catch((error) => {
  console.error("FAIL dashboard readiness crashed:", error.message);
  process.exit(1);
});
