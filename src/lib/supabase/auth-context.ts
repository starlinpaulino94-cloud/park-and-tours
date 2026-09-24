import "server-only";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { AppRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { mfaGate, hasVerifiedFactor } from "@/lib/mfa";
import type { Company } from "@/lib/types";
import { esAdminDeSocio, type TenantContext } from "@/lib/tenant";

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
  supplier_id?: string | null;
  /** Sucursal de la membresía activa; null = toda la empresa. */
  branch_id?: string | null;
  status?: string;
  /** Nivel de garantía de la sesión: `aal2` = pasó el segundo factor. */
  aal?: string;
  /** Solo lo escribe el rol de servicio; aquí viaja `mfa_enabled`. */
  app_metadata?: { mfa_enabled?: boolean } | null;
}

/**
 * LOS ROLES VÁLIDOS SALEN DE LA TABLA DE RANGO, NO DE UNA LISTA A MANO.
 *
 * Aquí había una cuarta copia de la lista de roles —después de las tres tablas
 * de rango— y esta era la peligrosa, porque lo que hace con lo que no reconoce
 * no es rechazarlo: lo convierte en `seller`.
 *
 * Es decir: añadir un rol a la base sin acordarse de esta línea no deja fuera a
 * ese actor, lo ASCIENDE al rango 20 — el que abre las veintiuna rutas que
 * exigen `seller`. Un proveedor habría entrado a cotizar, a cobrar y a cancelar
 * reservas, y nada habría fallado por el camino.
 */
const VALID_ROLES = new Set<AppRole>(ROLES);
const IMPERSONATION_COOKIE = "tf_impersonate_company";
const WORKSPACE_COOKIE = "tf_active_company";

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

/**
 * Nombre presentable del usuario autenticado.
 *
 * `ctx.name` se usa en el shell (menú, iniciales). Antes caía directamente al
 * correo cuando `user_metadata.name` estaba vacío, así que el correo del usuario
 * autenticado terminaba dibujado en pantallas donde no debe aparecer: solo
 * `/dashboard/perfil` puede mostrarlo. Aquí se deriva un nombre a partir de la
 * parte local del correo en vez de exponer la dirección completa.
 */
export function resolveDisplayName(name?: string | null, email?: string | null): string {
  const clean = name?.trim();
  if (clean && !clean.includes("@")) return clean;

  const local = (clean || email || "").split("@")[0];
  if (!local) return "Usuario";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Usuario";
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

  /**
   * Y lo que no se reconoce cae al rango MÁS BAJO, no a `seller`.
   *
   * Un rol desconocido es un rol del que no se sabe nada: puede venir de un
   * token viejo, de una migración a medias o de una base tocada a mano.
   * Tratarlo como vendedor es fallar hacia arriba justo donde más caro sale —
   * `seller` ya vende, cobra y cancela—. El último de la lista es el que menos
   * puede, y si alguien se queda fuera se ve el primer día; al revés no se ve
   * nunca.
   */
  const role = (VALID_ROLES.has(claims.app_role as AppRole)
    ? claims.app_role
    : ROLES[ROLES.length - 1]) as AppRole;
  return {
    userId: user.id,
    // El correo sigue disponible en el contexto para `/dashboard/perfil` y para
    // los registros de auditoría; lo que cambia es que ya no se filtra al nombre.
    email: user.email || "",
    name: resolveDisplayName(user.name, user.email),
    role,
    companyId: claims.org_id,
    partnerId: claims.partner_id || null,
    /**
     * Del MISMO sitio que el identificador, y por eso no pueden discrepar: los
     * dos salen de que la organización de la membresía sea de tipo socio.
     *
     * Se guarda como campo propio en vez de dejar que cada sitio haga
     * `Boolean(ctx.partnerId)` porque así la regla tiene un nombre, se puede
     * buscar, y el día que un actor nuevo necesite lo mismo hay dónde ponerlo.
     */
    isPartnerMember: Boolean(claims.partner_id),
    /**
     * El proveedor, del token (0084).
     *
     * Mismo papel que `partner_id` y por el mismo motivo: la RLS lo necesita en
     * el token para poder acotar. Su ESTADO se comprueba abajo, en cada
     * petición, porque desactivar a un transportista tiene que surtir efecto
     * ahora y no cuando a su sesión le toque renovarse.
     */
    supplierId: claims.supplier_id || null,
    branchId: claims.branch_id || null,
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
      // 0042 — sin estas tres, la decisión de suscripción no tiene con qué
      // decidir: el periodo de prueba no podía vencer porque su fecha nunca
      // llegaba al contexto, y el medidor de almacenamiento no tenía qué medir.
      trial_ends_at: data.trial_ends_at,
      next_billing_at: data.next_billing_at,
      storage_used_mb: data.storage_used_mb,
      status: data.status,
      // Necesarios para que la lógica temporal use la zona de la empresa y no
      // la del servidor (UTC en Vercel). La columna existía en 0002 pero no se
      // estaba mapeando, así que nunca llegaba al contexto.
      timezone: data.timezone,
      country: data.country,
    } as Company;
  } catch {
    return null;
  }
}

/**
 * LA EMPRESA ACTIVA, CUANDO ALGUIEN PERTENECE A MÁS DE UNA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA
 *
 * La sesión resolvía la empresa SIEMPRE desde la membresía principal —lo hace
 * el hook de la base con `order by is_primary desc` y lo repite el respaldo de
 * este archivo—, y no había ninguna forma de cambiarla. El sembrador de
 * demostración crea una empresa hermana y da membresía `is_primary: false` a
 * propósito, para que nadie aterrice ahí por accidente; su propio comentario
 * decía «para presentar se cambia de empresa en el selector». Ese selector no
 * existía: la demostración quedaba escrita y era inalcanzable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COOKIE GUARDA LA EMPRESA, Y EL ROL SE VUELVE A RESOLVER
 *
 * La cookie la controla el cliente, así que no se cree nada de lo que diga
 * salvo «mira esta empresa». Lo que decide es esta consulta, en CADA petición:
 * si no hay membresía activa en esa empresa, la cookie no vale nada.
 *
 * Y el rol sale de ESA membresía, no de la anterior. Es la parte que de verdad
 * importa: quien es `owner` en su empresa y `operations` en la de al lado
 * entraría a la segunda mandando, y eso no sería un selector — sería una
 * escalada de privilegios a un clic. Una membresía que se desactiva deja de
 * valer en la siguiente petición, sin sesión que cerrar.
 */
async function loadMembershipClaims(userId: string, orgId: string): Promise<AppClaims | null> {
  try {
    const sb = supabaseService();
    const { data } = await sb
      .from("organization_memberships")
      .select("role,status,branch_id,organizations(id,kind,tenant_org_id)")
      .eq("user_id", userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    const org = Array.isArray(data?.organizations) ? data?.organizations[0] : data?.organizations;
    if (!data || !org?.id) return null;

    return {
      org_id: org.tenant_org_id || org.id,
      app_role: data.role,
      status: data.status,
      partner_id: org.kind === "partner" ? org.id : null,
      branch_id: data.branch_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * LA FICHA DE VENDEDOR DE ESTA CUENTA.
 *
 * Es lo que convierte «este usuario tiene rol de vendedor» en «este usuario ES
 * el vendedor tal», y sin eso el ámbito del vendedor (`seller-scope.ts`) no
 * tiene por dónde acotar. El vínculo vive en `seller.user_id` y se pone desde
 * la ficha del vendedor.
 *
 * Se consulta en cada petición y SOLO para el rol `seller` —una consulta por
 * clave indexada, y únicamente para el rango más bajo—. Va por consulta y no
 * como dato del token a propósito: vincular, desvincular o desactivar una ficha
 * tiene efecto en la petición siguiente. Metido en el token, un vendedor
 * desvinculado seguiría viendo lo de su ficha hasta que su sesión se renovara.
 *
 * Un fallo aquí devuelve null, y null NO abre nada: el ámbito acota entonces a
 * las filas sin vendedor. Falla cerrado.
 */
async function loadSellerId(
  orgId: string,
  userId: string,
  /**
   * El tour center del que tiene que colgar la ficha, o `null` para el
   * personal interno.
   *
   * SIN ESTE FILTRO la consulta es una fuga de aislamiento, no una comodidad:
   * un usuario de tour center cuyo correo coincidiera con el de una ficha
   * INTERNA de la operadora quedaría acotado a esa ficha —y entonces vería las
   * ventas de un vendedor de la operadora desde el portal—. La ficha de un
   * vendedor de socio tiene que colgar de SU socio; ninguna otra sirve.
   */
  partnerId: string | null
): Promise<string | null> {
  try {
    const sb = supabaseService();
    let q = sb
      .from("seller")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active");
    // `is null` y no «sin condición»: una ficha con socio NO es del personal
    // interno, y dejarla pasar acotaría a un empleado de la operadora al
    // ámbito de un vendedor de tour center.
    q = partnerId ? q.eq("partner_id", partnerId) : q.is("partner_id", null);
    const { data } = await q.limit(1).maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿SIGUE SIENDO ESTA FICHA DE ESTE PROVEEDOR, Y SIGUE ACTIVA?
 *
 * El token trae el identificador de cuando se emitió. Entre eso y ahora, la
 * operadora puede haber desactivado al proveedor o haberle desvinculado la
 * cuenta, y las dos cosas tienen que surtir efecto en la petición siguiente.
 *
 * FALLA CERRADO: cualquier problema devuelve `false` y el contexto se queda sin
 * proveedor, que acota a nada en vez de abrir. Aquí eso importa más que en el
 * vendedor, porque lo que hay al otro lado son datos personales de terceros —
 * una hoja de ruta es una lista de clientes con su hotel, su habitación y su
 * teléfono.
 */
async function supplierSigueActivo(
  orgId: string,
  supplierId: string,
  userId: string
): Promise<boolean> {
  try {
    const sb = supabaseService();
    const { data } = await sb
      .from("supplier")
      .select("id")
      .eq("id", supplierId)
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

/**
 * EL ESTADO DE LA EMPRESA DEL SOCIO.
 *
 * Una consulta por clave primaria, y SOLO para quien viene de un socio: el
 * personal interno no paga nada por esto. Va por consulta y no como dato del
 * token por lo mismo que la ficha de vendedor: desactivar o suspender a un
 * tour center tiene que surtir efecto en la petición siguiente, no cuando a su
 * sesión le toque renovarse dentro de una hora.
 *
 * FALLA CERRADO, y aquí eso importa más que en ningún otro cargador de este
 * fichero: `loadSellerId` devuelve null y null ACOTA, pero si un fallo de red
 * aquí devolviera «activo», un socio suspendido seguiría operando por el
 * simple expediente de que la consulta se cayera. Devuelve la cadena vacía,
 * que no es `active` y por tanto veta.
 */
async function loadPartnerMembership(
  partnerId: string,
  userId: string
): Promise<{ status: string; partnerRole: string | null }> {
  const CERRADO = { status: "", partnerRole: null };
  try {
    const sb = supabaseService();
    /**
     * Las dos cosas en UNA consulta: si esa empresa puede operar, y qué manda
     * esta persona dentro de ella. Se parte de la MEMBRESÍA y no de la
     * organización porque así la respuesta también deja de existir cuando la
     * membresía deja de existir — y eso es más estricto que antes a propósito:
     * `claims.status` viene del token y una membresía borrada seguiría pasando
     * hasta la siguiente renovación.
     */
    const { data, error } = await sb
      .from("organization_memberships")
      .select("partner_role, status, organizations!inner(status)")
      .eq("user_id", userId)
      .eq("organization_id", partnerId)
      .eq("status", "active")
      .maybeSingle();
    if (error || !data) return CERRADO;

    const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
    return {
      status: ((org as { status?: string } | null)?.status as string) ?? "",
      partnerRole: (data.partner_role as string) ?? null,
    };
  } catch {
    return CERRADO;
  }
}

async function loadClaimsFromPrimaryMembership(userId: string): Promise<AppClaims | null> {
  try {
    const sb = supabaseService();
    const { data } = await sb
      .from("organization_memberships")
      .select("role,status,branch_id,organizations(id,kind,tenant_org_id)")
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
      branch_id: data.branch_id ?? null,
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
  let claims = jwtClaims.org_id ? jwtClaims : await loadClaimsFromPrimaryMembership(user.id);

  /**
   * El cambio de empresa, ANTES de cargar nada más.
   *
   * Va aquí y no al final para que el contexto salga entero de una pieza: la
   * empresa, el rol, la sucursal y el socio del MISMO sitio. Resolverlo después
   * dejaría la puerta abierta a un contexto mezclado —la empresa nueva con el
   * rol viejo—, que es exactamente el fallo que este orden evita.
   */
  const activo = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (activo && activo !== claims?.org_id) {
    const otra = await loadMembershipClaims(user.id, activo);
    // Sin membresía activa, la cookie se ignora en silencio y se sigue en la
    // empresa de siempre: una cookie manipulada no puede sacar a nadie de su
    // sesión ni meterlo donde no pertenece.
    if (otra) claims = otra;
  }

  /**
   * El segundo factor se decide con lo que YA hay en la mano: el nivel del token
   * y la marca de `app_metadata` (que el usuario no puede tocar). Los factores
   * del propio usuario entran como segunda señal para las cuentas que se
   * enrolaron antes de que existiera la marca. Ninguna consulta extra.
   */
  const mfaPending = mfaGate(
    {
      aal: jwtClaims.aal,
      app_metadata: (user.app_metadata ?? null) as { mfa_enabled?: boolean } | null,
    },
    hasVerifiedFactor(user.factors as { status?: string }[] | undefined)
  ) === "verify";

  if (!claims?.org_id) return null;                       // no active membership
  const company = await loadOrganization(claims.org_id);
  const ctx = mapClaimsToContext(
    claims,
    { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? user.email },
    company
  );
  if (!ctx) return null;
  if (mfaPending) ctx.mfaPending = true;

  /**
   * La ficha de vendedor, para todo el personal interno.
   *
   * El rol `seller` la necesita porque su ámbito se acota por ella. Los rangos
   * de arriba la necesitan por otra razón: en una operadora pequeña el gerente
   * y el dueño TAMBIÉN venden, y sin este dato su apartado propio no existiría
   * —o peor, existiría vacío—. No les acota nada (`sellerScopeApplies` solo
   * mira al rango más bajo): les da su propia vista sin quitarles el ERP.
   *
   * Cuesta una consulta indexada por petición para el personal interno. Se
   * salta para el socio B2B, que no tiene ficha, y para el superadministrador
   * —incluso mientras impersona—: quien entra a mirar una empresa ajena no es
   * ningún vendedor de ella, así que no aterriza en el apartado de nadie ni se
   * le acota lo que ve, que es justo para lo que sirve impersonar (y queda
   * auditado).
   */
  // Del socio, tenga el rol que tenga: un empleado de un tour center dado de
  // alta como `seller` no es vendedor de la operadora y buscarle ficha sería
  // una consulta por petición para no encontrar nunca nada.
  // Se resuelve por `partnerId` y no por `esDeSocio`: lo que hay que consultar
  // es el estado de UNA organización concreta, y sin identificador no hay
  // ninguna a la que preguntar. Va ANTES de la ficha porque la ficha del
  // vendedor de un tour center se busca acotada a ese tour center.
  if (ctx.partnerId) {
    const membresia = await loadPartnerMembership(ctx.partnerId, user.id);
    ctx.partnerStatus = membresia.status;
    ctx.partnerRole = membresia.partnerRole;
  }

  /**
   * Y la ficha de vendedor, que desde la Fase 5 también tiene el tour center.
   *
   * El sub-login del vendedor de un socio es esto: una persona del portal que
   * ADEMÁS tiene ficha, colgando de su propio tour center. Con ella, el ámbito
   * combinado —lo de su socio, y dentro de eso lo suyo— sale solo, porque los
   * dos filtros se acumulan (`row-scope.ts`).
   *
   * Quien administra la cuenta del tour center no la necesita: no se acota.
   * Preguntar igualmente costaría una consulta por petición para un dato que
   * nadie va a mirar.
   */
  /**
   * Y el proveedor sigue estando activo.
   *
   * FALLA CERRADO, como el estado del socio y por lo mismo: si un fallo de red
   * devolviera «sigue siendo proveedor», un transportista desactivado seguiría
   * viendo las hojas de ruta —con los nombres, los teléfonos y las
   * habitaciones de los clientes— por el simple expediente de que la consulta
   * se cayera.
   *
   * Y se comprueba que la ficha siga SIENDO SUYA: el token trae el
   * identificador de cuando se emitió, y entre eso y ahora la operadora puede
   * haberle desvinculado la cuenta.
   */
  if (ctx.supplierId) {
    const sigue = await supplierSigueActivo(ctx.companyId!, ctx.supplierId, user.id);
    if (!sigue) ctx.supplierId = null;
  }

  const esAdminDelSocio = esAdminDeSocio(ctx);
  if (ctx.role !== "superadmin" && !esAdminDelSocio) {
    ctx.sellerId = await loadSellerId(ctx.companyId!, user.id, ctx.partnerId ?? null);
  }

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
