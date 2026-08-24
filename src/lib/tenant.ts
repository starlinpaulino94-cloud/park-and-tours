import "server-only";
import { cache } from "react";
import type { AppRole } from "@/lib/auth";
import type { Company, ModuleKey } from "@/lib/types";
import { pgTable } from "@/lib/data-backend";
import {
  spQuery, spCount, spFindOne, spCreate, spUpdate, spDelete,
} from "@/lib/supabase/data-provider";
import { getSupabaseTenantContext } from "@/lib/supabase/auth-context";

/**
 * Multi-tenant security core.
 *
 * Every read/write that touches business data MUST go through `tenantQuery`
 * / `assertTenant` so the `company` scope is applied at the database layer and
 * never only in the UI.
 */

export interface TenantContext {
  userId: string;
  email: string;
  name: string;
  role: AppRole;
  /** null only for the platform superadmin (cross-tenant). */
  companyId: string | null;
  /** set for B2B portal users. */
  partnerId: string | null;
  company: Company | null;
  /** true while a superadmin is operating inside a tenant (always audited). */
  impersonating?: boolean;
}

/** Cookie used by the audited superadmin impersonation flow. */
export const IMPERSONATION_COOKIE = "tf_impersonate_company";

export class TenantError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "TenantError";
  }
}

/**
 * Resolves the caller's tenant context from the session + database (authoritative).
 *
 * Wrapped in `cache()` so it runs once per request instead of once per caller:
 * the dashboard layout and the page it renders both need it, and each call cost
 * a session lookup plus a user query. Deduplicating halves the round-trips on
 * every navigation. The cache is per-request, so it can never leak one user's
 * context into another's.
 */
export const getTenantContext = cache(async function getTenantContext(): Promise<TenantContext | null> {
  const started = Date.now();
  const logSlow = (result: string) => {
    const elapsed = Date.now() - started;
    if (process.env.NODE_ENV !== "production" && elapsed > 800) {
      console.warn(`[tenant] getTenantContext ${result} tardó ${elapsed}ms`);
    }
  };
  const ctx = await getSupabaseTenantContext();
  logSlow(ctx ? "supabase" : "sin contexto supabase");
  return ctx;
});

/** Same as `getTenantContext` but throws when unauthenticated / not attached to a tenant. */
export async function requireTenant(): Promise<TenantContext & { companyId: string }> {
  const ctx = await getTenantContext();
  if (!ctx) throw new TenantError("No autenticado", 401);
  if (!ctx.companyId) {
    throw new TenantError(
      "El usuario no está asociado a ninguna empresa. Contacta al administrador.",
      403
    );
  }
  return ctx as TenantContext & { companyId: string };
}

/** Throws unless the caller is the platform owner. */
export async function requireSuperadmin(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new TenantError("No autenticado", 401);
  if (ctx.role !== "superadmin") throw new TenantError("Acceso restringido al propietario de la plataforma", 403);
  return ctx;
}

const ROLE_RANK: Record<AppRole, number> = {
  superadmin: 100,
  owner: 90,
  admin: 80,
  manager: 60,
  operations: 40,
  cashier: 40,
  seller: 20,
  partner: 10,
};

export function hasRole(role: AppRole, ...allowed: AppRole[]): boolean {
  return allowed.includes(role);
}

export function atLeast(role: AppRole, minimum: AppRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minimum] ?? 0);
}

export function requireAtLeast(ctx: TenantContext, minimum: AppRole) {
  if (!atLeast(ctx.role, minimum)) {
    throw new TenantError("No tienes permisos para realizar esta acción", 403);
  }
}

export function moduleEnabled(company: Company | null, moduleKey: ModuleKey): boolean {
  const mods = company?.modules_enabled;
  if (!mods || mods.length === 0) return true; // no restriction configured
  return mods.includes(moduleKey);
}

type QueryOptions = Record<string, unknown>;

/** Runs a tenant-scoped Supabase query. */
export async function tenantQuery<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  options: QueryOptions = {}
): Promise<T[]> {
  return spQuery<T>(companyId, pgTable(tableName), options as never);
}

/** Aggregate helper honouring the tenant scope. Returns the `_aggregate` payload or null. */
export async function tenantAggregate(
  companyId: string,
  tableName: string,
  options: QueryOptions = {}
): Promise<Record<string, any> | null> {
  const rows = await tenantQuery<any>(companyId, tableName, options);
  return rows.length > 0 ? rows[0]._aggregate ?? null : null;
}

/** Total count for a table honouring the tenant scope. */
export async function tenantCount(
  companyId: string,
  tableName: string,
  filter: Record<string, unknown> = {}
): Promise<number> {
  return spCount(companyId, pgTable(tableName), filter);
}

/**
 * Loads a single record and verifies it belongs to the caller's tenant.
 * Throws `TenantError` on cross-tenant access attempts.
 */
export async function tenantFindOne<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  id: string,
  expand: QueryOptions = {}
): Promise<T> {
  return spFindOne<T>(companyId, pgTable(tableName), id);
}

/** Creates a record with the tenant scope forced onto it. */
export async function tenantCreate<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  data: Record<string, unknown>
): Promise<T> {
  return spCreate<T>(companyId, pgTable(tableName), data);
}

/** Updates a record after verifying tenant ownership. */
export async function tenantUpdate<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  return spUpdate<T>(companyId, pgTable(tableName), id, data);
}

/** Deletes a record after verifying tenant ownership. */
export async function tenantDelete(companyId: string, tableName: string, id: string): Promise<void> {
  return spDelete(companyId, pgTable(tableName), id);
}
