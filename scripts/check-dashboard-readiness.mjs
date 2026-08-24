#!/usr/bin/env node
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", `.env.${process.env.NODE_ENV || "development"}`, ".env.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const table of ["task", "approval_request", "notification", "organizations", "organization_memberships"]) {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  console.log(`${table}: ${error ? `ERROR ${error.message}` : count}`);
}

const { data, error } = await sb
  .from("organization_memberships")
  .select("role,status,is_primary,organizations(slug,kind,name)")
  .limit(5);
console.log(`memberships: ${error ? `ERROR ${error.message}` : JSON.stringify(data)}`);
