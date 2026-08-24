#!/usr/bin/env node
/**
 * Bootstrap the first platform superadmin in Supabase.
 * Safe output only: no emails, tokens, or row payloads.
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: usersRes, error: usersError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw new Error(`Could not list users: ${usersError.message}`);
  const users = usersRes.users;
  if (users.length !== 1) {
    throw new Error(`Expected exactly 1 Auth user for safe bootstrap; found ${users.length}. Refusing to guess.`);
  }
  const userId = users[0].id;

  const { data: existingOrg, error: orgLoadError } = await sb
    .from("organizations")
    .select("id")
    .eq("slug", "platform-admin")
    .maybeSingle();
  if (orgLoadError) throw new Error(`Could not load platform org: ${orgLoadError.message}`);

  let orgId = existingOrg?.id;
  if (!orgId) {
    const { data: createdOrg, error: createOrgError } = await sb
      .from("organizations")
      .insert({
        kind: "tenant",
        name: "Platform Admin",
        slug: "platform-admin",
        legal_name: "Platform Admin",
        company_type: "other",
        subscription_status: "active",
        modules_enabled: [],
        status: "active",
        metadata: { system: true, purpose: "superadmin_claim_anchor" },
      })
      .select("id")
      .single();
    if (createOrgError) throw new Error(`Could not create platform org: ${createOrgError.message}`);
    orgId = createdOrg.id;

    const { error: selfTenantError } = await sb.from("organizations").update({ tenant_org_id: orgId }).eq("id", orgId);
    if (selfTenantError) throw new Error(`Could not finalize platform org: ${selfTenantError.message}`);
  }

  const { error: clearPrimaryError } = await sb
    .from("organization_memberships")
    .update({ is_primary: false })
    .eq("user_id", userId)
    .neq("organization_id", orgId);
  if (clearPrimaryError) throw new Error(`Could not clear previous primary memberships: ${clearPrimaryError.message}`);

  const { data: existingMembership, error: membershipLoadError } = await sb
    .from("organization_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (membershipLoadError) throw new Error(`Could not load membership: ${membershipLoadError.message}`);

  if (existingMembership?.id) {
    const { error } = await sb
      .from("organization_memberships")
      .update({ role: "superadmin", status: "active", is_primary: true })
      .eq("id", existingMembership.id);
    if (error) throw new Error(`Could not update superadmin membership: ${error.message}`);
  } else {
    const { error } = await sb.from("organization_memberships").insert({
      user_id: userId,
      organization_id: orgId,
      role: "superadmin",
      status: "active",
      is_primary: true,
    });
    if (error) throw new Error(`Could not create superadmin membership: ${error.message}`);
  }

  const { error: metadataError } = await sb.auth.admin.updateUserById(userId, {
    app_metadata: { app_role: "superadmin" },
  });
  if (metadataError) throw new Error(`Could not update user app_metadata: ${metadataError.message}`);

  console.log("✅ Superadmin bootstrap complete");
  console.log("• Auth users processed: 1");
  console.log("• Platform org slug: platform-admin");
  console.log("• Membership role: superadmin");
  console.log("• Membership status: active");
  console.log("• Membership primary: true");
}

main().catch((error) => {
  console.error("❌ Superadmin bootstrap failed:", error.message);
  process.exit(1);
});
