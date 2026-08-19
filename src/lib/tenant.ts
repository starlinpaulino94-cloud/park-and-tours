import "server-only";
import { cookies, headers } from "next/headers";
import { auth, type AppRole } from "@/lib/auth";
import { totalumSdk } from "@/lib/totalum";
import type { AppUser, Company, ModuleKey } from "@/lib/types";
import { refId } from "@/lib/types";

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
export const IMPERSONATION_COOKIE = "totalum_impersonate_company";

export class TenantError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "TenantError";
  }
}

/** Resolves the caller's tenant context from the session + database (authoritative). */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    console.log("[tenant] no session");
    return null;
  }

  const userId = session.user.id;
  const res = await totalumSdk.crud.query("user", {
    _filter: { _id: userId },
    _limit: 1,
    company_id: true,
  });
  const record = (res.data?.[0] || null) as AppUser | null;
  if (!record) {
    console.error("[tenant] session user not found in database:", userId);
    return null;
  }

  const companyRef = record.company_id;
  const company =
    companyRef && typeof companyRef === "object" ? (companyRef as Company) : null;

  const role = (record.role as AppRole) || "owner";
  const ctx: TenantContext = {
    userId,
    email: record.email || session.user.email,
    name: record.name || session.user.name,
    role,
    companyId: company?._id || (typeof companyRef === "string" ? companyRef : null),
    partnerId: refId(record.partner_id) || null,
    company,
  };

  // Controlled impersonation: only the platform owner may enter a tenant, and
  // every action performed while impersonating is written to the audit trail.
  if (role === "superadmin") {
    const target = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    if (target) {
      const impersonated = await totalumSdk.crud.query("company", { _filter: { _id: target }, _limit: 1 });
      const targetCompany = (impersonated.data?.[0] || null) as Company | null;
      if (targetCompany) {
        console.log(`[tenant] superadmin ${ctx.email} impersonando ${targetCompany.name}`);
        return { ...ctx, companyId: targetCompany._id, company: targetCompany, impersonating: true };
      }
      console.warn("[tenant] impersonation cookie points to a missing company:", target);
    }
  }

  return ctx;
}

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
 * Runs a Totalum query with the tenant filter forcibly merged into `_filter`.
 * The caller cannot override `company` — it is applied last.
 */
export async function tenantQuery<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  options: QueryOptions = {}
): Promise<T[]> {
  const filter = { ...((options._filter as Record<string, unknown>) || {}), company: companyId };
  const res = await totalumSdk.crud.query(tableName, { ...options, _filter: filter });
  if (res.errors) console.error(`[tenantQuery] ${tableName} errors:`, res.errors);
  return (res.data || []) as T[];
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
  const agg = await tenantAggregate(companyId, tableName, {
    _filter: filter,
    _aggregate: { _count: true },
  });
  return agg?._count ?? 0;
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
  const rows = await tenantQuery<any>(companyId, tableName, {
    ...expand,
    _filter: { _id: id },
    _limit: 1,
  });
  if (rows.length === 0) {
    throw new TenantError("Registro no encontrado o fuera de tu empresa", 404);
  }
  return rows[0] as T;
}

/** Creates a record with the tenant scope forced onto it. */
export async function tenantCreate<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  data: Record<string, unknown>
): Promise<T> {
  const res = await totalumSdk.crud.createRecord(tableName, { ...data, company: companyId });
  if (res.errors) {
    console.error(`[tenantCreate] ${tableName} errors:`, res.errors);
    throw new Error(res.errors.errorMessage || "Error creando el registro");
  }
  return res.data as T;
}

/** Updates a record after verifying tenant ownership. */
export async function tenantUpdate<T = Record<string, unknown>>(
  companyId: string,
  tableName: string,
  id: string,
  data: Record<string, unknown>
): Promise<T> {
  await tenantFindOne(companyId, tableName, id);
  const { company: _ignored, ...safe } = data as Record<string, unknown>;
  const res = await totalumSdk.crud.editRecordById(tableName, id, safe);
  if (res.errors) {
    console.error(`[tenantUpdate] ${tableName}/${id} errors:`, res.errors);
    throw new Error(res.errors.errorMessage || "Error actualizando el registro");
  }
  return res.data as T;
}

/** Deletes a record after verifying tenant ownership. */
export async function tenantDelete(companyId: string, tableName: string, id: string): Promise<void> {
  await tenantFindOne(companyId, tableName, id);
  const res = await totalumSdk.crud.deleteRecordById(tableName, id);
  if (res.errors) {
    console.error(`[tenantDelete] ${tableName}/${id} errors:`, res.errors);
    throw new Error(res.errors.errorMessage || "Error eliminando el registro");
  }
}
