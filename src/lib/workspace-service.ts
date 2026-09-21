import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { mustRead } from "@/lib/supabase/io";

/**
 * LAS EMPRESAS A LAS QUE UNA PERSONA PERTENECE.
 *
 * Una sola consulta, y la misma que decide el cambio: si esta lista no la
 * incluye, el cambio tampoco la acepta. Dos fuentes distintas —una para pintar
 * el selector y otra para autorizar— acabarían separándose, y entonces el
 * selector enseñaría empresas a las que no se puede entrar, o al revés.
 */

export interface WorkspaceOption {
  id: string;
  name: string;
  /** El rol que esa persona tiene AHÍ, que no tiene por qué ser el de aquí. */
  role: string;
  isPrimary: boolean;
  /** Dónde aterriza al entrar si no cambia nada. */
  isActive: boolean;
}

interface MembershipRow {
  organization_id: string;
  role: string | null;
  is_primary: boolean | null;
}

interface OrgRow {
  id: string;
  name: string | null;
  tenant_org_id: string | null;
}

/**
 * Dos lecturas y no una con relación incrustada, a propósito.
 *
 * PostgREST sabe traer `organizations(...)` dentro de la misma consulta, pero
 * el doble con el que se prueban los servicios sin sesión no entiende esa
 * gramática —y enseñársela sería escribir medio PostgREST para mantenerlo—.
 * Dos lecturas contra un puñado de filas cuestan un viaje más y se pueden
 * probar de verdad; es el mismo camino que toma el conector de OTAs.
 */
export async function workspacesOf(userId: string, activeCompanyId: string): Promise<WorkspaceOption[]> {
  if (!userId) return [];

  const memberships = (await mustRead<MembershipRow[]>(
    "leer las membresías de la persona",
    supabaseService()
      .from("organization_memberships")
      .select("organization_id,role,is_primary")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(50)
  )) ?? [];
  if (memberships.length === 0) return [];

  const ids = [...new Set(memberships.map((m) => String(m.organization_id)).filter(Boolean))];
  const orgs = new Map<string, OrgRow>();
  for (const org of (await mustRead<OrgRow[]>(
    "leer las empresas de esas membresías",
    supabaseService()
      .from("organizations")
      .select("id,name,tenant_org_id")
      .in("id", ids)
      .limit(50)
  )) ?? []) orgs.set(String(org.id), org);

  const out: WorkspaceOption[] = [];
  for (const row of memberships) {
    const org = orgs.get(String(row.organization_id));
    if (!org) continue;
    // Se lista la empresa a la que se entra de verdad: para una membresía de
    // socio, la matriz. Enseñar la fila del socio llevaría a un cambio que
    // aterriza en otro sitio del que dice.
    const id = String(org.tenant_org_id || org.id);
    if (out.some((w) => w.id === id)) continue;
    out.push({
      id,
      name: String(org.name ?? "Empresa"),
      role: String(row.role ?? ""),
      isPrimary: row.is_primary === true,
      isActive: id === activeCompanyId,
    });
  }

  // La principal primero y el resto por nombre: el orden no puede bailar entre
  // recargas, porque el selector se usa con el ratón y por costumbre.
  return out.sort((a, b) =>
    (Number(b.isPrimary) - Number(a.isPrimary)) || a.name.localeCompare(b.name));
}

/** ¿Puede esta persona entrar a esa empresa? La misma lista que se enseña. */
export async function canEnterWorkspace(userId: string, companyId: string): Promise<WorkspaceOption | null> {
  if (!companyId) return null;
  const lista = await workspacesOf(userId, companyId);
  return lista.find((w) => w.id === companyId) ?? null;
}
