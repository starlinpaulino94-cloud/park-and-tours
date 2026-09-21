import "server-only";
import { cache } from "react";
import type { AppRole } from "@/lib/auth";
import type { Company, ModuleKey } from "@/lib/types";
import { pgTable } from "@/lib/data-backend";
import {
  spQuery, spCount, spFindOne, spCreate, spUpdate, spDelete,
} from "@/lib/supabase/data-provider";
import { getSupabaseTenantContext } from "@/lib/supabase/auth-context";
import { subscriptionState, blockMessage } from "@/lib/plan";
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
  /**
   * Sucursal de la persona, o null cuando trabaja para toda la empresa.
   *
   * Acota lo que ve y sella lo que crea (`branch-scope.ts`). Es organizativo:
   * la muralla entre empresas sigue siendo la RLS por `organization_id`.
   */
  branchId?: string | null;
  company: Company | null;
  /** true while a superadmin is operating inside a tenant (always audited). */
  impersonating?: boolean;
  /**
   * La contraseña ya está, falta el código del segundo factor.
   *
   * No es un rechazo: es un paso a medio camino. La API responde 401 con
   * `MFA_REQUIRED` y la pantalla manda a `/auth/verificar` conservando la
   * sesión, porque cerrarla obligaría a escribir la contraseña otra vez.
   */
  mfaPending?: boolean;
}

/** Cookie used by the audited superadmin impersonation flow. */
export const IMPERSONATION_COOKIE = "tf_impersonate_company";

/**
 * Cookie de la empresa activa, para quien pertenece a más de una.
 *
 * Guarda SOLO el identificador: el rol y la sucursal se vuelven a resolver
 * desde la membresía en cada petición (`auth-context.ts`). Sin membresía
 * activa ahí, la cookie no vale nada.
 */
export const WORKSPACE_COOKIE = "tf_active_company";

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
  // El segundo factor se exige AQUÍ y no solo en la pantalla: una contraseña
  // robada sirve para llamar a la API directamente, que es donde están los
  // datos. Un segundo factor que solo vigila la interfaz no protege nada.
  if (ctx.mfaPending) {
    throw Object.assign(new TenantError("Falta verificar el código de tu segundo factor", 401), {
      code: "MFA_REQUIRED",
    });
  }
  if (!ctx.companyId) {
    throw new TenantError(
      "El usuario no está asociado a ninguna empresa. Contacta al administrador.",
      403
    );
  }
  return ctx as TenantContext & { companyId: string };
}

/**
 * Igual que `requireTenant`, y además exige que la suscripción permita ESCRIBIR.
 *
 * Toda ruta que crea, modifica o borra pasa por aquí; las que solo leen siguen
 * usando `requireTenant`. Esa separación ES la política: una empresa que no paga
 * pierde la capacidad de registrar operaciones, nunca el acceso a lo suyo —sus
 * reservas, su caja y su contabilidad son datos de su negocio, con obligación
 * fiscal de conservarlos en parte, y secuestrarlos como palanca de cobro no es
 * defendible—.
 *
 * La decisión es pura (`subscriptionState` en `plan.ts`) y se toma sobre datos
 * que el contexto ya trae: no cuesta ni una consulta más. Los límites por
 * cantidad viven aparte, en `plan-service.ts`, porque esos sí exigen contar.
 *
 * Responde 402 (Pago requerido) y no 403: al usuario no le faltan permisos, a la
 * empresa le falta plan al día. Son dos conversaciones con personas distintas.
 */
export async function requireTenantWrite(): Promise<TenantContext & { companyId: string }> {
  const ctx = await requireTenant();
  const state = subscriptionState(ctx.company ?? null);
  if (!state.canWrite && state.reason) {
    throw Object.assign(new TenantError(blockMessage(state.reason), 402), {
      code: "PLAN_BLOCKED",
      reason: state.reason,
    });
  }
  return ctx;
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
