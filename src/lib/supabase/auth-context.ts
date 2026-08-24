import "server-only";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { AppRole } from "@/lib/auth";
import type { Company } from "@/lib/types";
import type { TenantContext } from "@/lib/tenant";

/**
 * Supabase Auth → TenantContext (M3).
 *
 * The tenant scope (org_id, app_role, partner_id, status) lives in the JWT,
 * injected by app.custom_access_token_hook from organization_memberships. This
 * removes per-request membership lookups in getTenantContext.
 *
 * `decodeJwtClaims` and `mapClaimsToContext` are pure and unit-tested; only
 * `getSupabaseTenantContext` performs IO.
 */

export interface AppClaims {
  org_id?: string;
  app_role?: string;
  partner_id?: string | null;
  status?: string;
}

const VALID_ROLES = new Set<AppRole>([
  "superadmin", "owner", "admin", "manager", "operations", "cashier", "seller", "partner",
]);
const IMPERSONATION_COOKIE = "tf_impersonate_company";

/** Decodes a JWT payload (base64url) without verifying — the caller must have
 *  already validated the token via supabase.auth.getUser(). */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) return {};
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = typeof atob === "function"
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Builds a TenantContext from validated claims + the user's identity and org.
 *  Returns null when there is no active tenant membership (deactivated users and
 *  users not attached to a company get no context — AUD-S02). */
export function mapClaimsToContext(
  claims: AppClaims,
  user: { id: string; email?: string | null; name?: string | null },
  company: Company | null
): TenantContext | null {
  if (!claims.org_id) return null;
  if (claims.status && claims.status !== "active") return null;

  const role = (VALID_ROLES.has(claims.app_role as AppRole) ? claims.app_role : "seller") as AppRole;
  return {
    userId: user.id,
    email: user.email || "",
    name: user.name || user.email || "",
    role,
    companyId: claims.org_id,
    partnerId: claims.partner_id || null,
    company,
  };
}

/** Loads the organization row (service client; organizations is not org-scoped). */
async function loadOrganization(orgId: string): Promise<Company | null> {
  try {
    const sb = supabaseService();
    const { data } = await sb.from("organizations").select("*").eq("id", orgId).maybeSingle();
    if (!data) return null;
    // Map the organization row onto the Company shape the app expects.
    return {
      _id: data.id,
      name: data.name,
      plan: data.plan_id,
      base_currency: data.currency,
      modules_enabled: data.modules_enabled,
      subscription_status: data.subscription_status,
      status: data.status,
    } as Company;
  } catch {
    return null;
  }
}

async function loadClaimsFromPrimaryMembership(userId: string): Promise<AppClaims | null> {
  try {
    const sb = supabaseService();
    const { data } = await sb
      .from("organization_memberships")
      .select("role,status,organizations(id,kind,tenant_org_id)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const org = Array.isArray(data?.organizations) ? data?.organizations[0] : data?.organizations;
    if (!data || !org?.id) return null;

    return {
      org_id: org.tenant_org_id || org.id,
      app_role: data.role,
      status: data.status,
      partner_id: org.kind === "partner" ? org.id : null,
    };
  } catch {
    return null;
  }
}

export async function getSupabaseTenantContext(): Promise<TenantContext | null> {
  const sb = await supabaseServer();
  const { data: userRes } = await sb.auth.getUser();      // validates the JWT
  const user = userRes?.user;
  if (!user) return null;

  const { data: sessionRes } = await sb.auth.getSession();
  const token = sessionRes?.session?.access_token;
  const jwtClaims = (token ? decodeJwtClaims(token) : {}) as AppClaims;
  const claims = jwtClaims.org_id ? jwtClaims : await loadClaimsFromPrimaryMembership(user.id);

  if (!claims?.org_id) return null;                       // no active membership
  const company = await loadOrganization(claims.org_id);
  const ctx = mapClaimsToContext(
    claims,
    { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? user.email },
    company
  );
  if (!ctx) return null;

  if (ctx.role === "superadmin") {
    const target = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    if (target) {
      const impersonated = await loadOrganization(target);
      if (impersonated?._id) {
        return { ...ctx, companyId: impersonated._id, company: impersonated, impersonating: true };
      }
    }
  }

  return ctx;
}
