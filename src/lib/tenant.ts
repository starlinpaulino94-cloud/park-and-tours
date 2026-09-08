import "server-only";
import { cache } from "react";
import type { AppRole } from "@/lib/auth";
import type { Company, ModuleKey } from "@/lib/types";
import { pgTable } from "@/lib/data-backend";
import {
  spQuery, spCount, spFindOne, spCreate, spUpdate, spDelete,
} from "@/lib/supabase/data-provider";
import { getSupabaseTenantContext } from "@/lib/supabase/auth-context";
import { splitExpand, expandRows } from "@/lib/supabase/expand";

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

/**
 * Runs a tenant-scoped Supabase query, resolving the relations it asks for.
 *
 * Las claves que no empiezan por `_` son relaciones a expandir. Antes se
 * ignoraban en silencio y las referencias llegaban como uuid: ver
 * `src/lib/supabase/expand.ts` para lo que eso rompía.
 */
export async function tenantQuery<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  options: QueryOptions = {}
): Promise<T[]> {
  const { query, expand } = splitExpand(options);
  const rows = await spQuery<T>(companyId, pgTable(tableName), query as never);
  return expandRows(companyId, tableName, rows as Record<string, unknown>[], expand) as Promise<T[]>;
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
  const row = await spFindOne<T>(companyId, pgTable(tableName), id);
  const spec = splitExpand(expand).expand;
  if (Object.keys(spec).length === 0) return row;
  const [expanded] = await expandRows(companyId, tableName, [row as Record<string, unknown>], spec);
  return expanded as T;
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
