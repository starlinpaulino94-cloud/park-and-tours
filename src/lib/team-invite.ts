import "server-only";
import { TenantError, type TenantContext } from "@/lib/tenant";
import { assertWithinLimit } from "@/lib/plan-service";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { roleDecision, normalizeEmail, isEmail } from "@/lib/team";
import type { AppRole } from "@/lib/auth";

/**
 * INVITAR A ALGUIEN AL EQUIPO, EN UN SOLO SITIO.
 *
 * Lo escribía entera `/api/team/invite`. Cuando el alta de vendedores necesitó
 * hacer lo mismo —crear la cuenta y, además, vincularla a la ficha— había dos
 * caminos: copiarlo o compartirlo. Copiado, la divergencia es cuestión de
 * tiempo y se nota en lo peor: el tope del plan comprobado en un camino y no en
 * el otro, o una invitación que no queda en la bitácora.
 *
 * Aquí vive lo que las dos altas tienen que hacer igual, y en el mismo orden:
 *
 *  1. EL ROL, DECIDIDO POR RANGO. Nadie otorga un rol por encima del suyo.
 *  2. EL TOPE DEL PLAN, ANTES DE TOCAR SUPABASE AUTH. Al revés quedaría una
 *     cuenta creada sin membresía —invisible en el equipo e imposible de volver
 *     a invitar, porque el correo ya existiría—.
 *  3. LA MEMBRESÍA NACE «PENDIENTE». Solo las activas resuelven inquilino, así
 *     que una invitación sin aceptar no abre ninguna puerta: si el correo acaba
 *     en la bandeja equivocada, quien lo reciba no entra a nada.
 *  4. Y QUEDA EN LA BITÁCORA, que es lo que responde «¿quién metió a esta
 *     persona?».
 */

/**
 * DÓNDE CUELGA LA MEMBRESÍA: DE LA OPERADORA, O DE UNO DE SUS SOCIOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO ARREGLA
 *
 * El formulario de Configuración → Equipo pedía «Tour center» desde el
 * principio y lo enviaba. La API no contenía la palabra `partner_id` en NINGUNA
 * línea: lo descartaba y creaba la membresía sobre la operadora. Como el
 * identificador de socio solo se emite cuando la organización de la membresía
 * es de tipo socio (`auth-context.ts`), ese usuario llegaba al portal sin socio
 * y recibía 403.
 *
 * Es decir: **ningún tour center podía entrar**, el administrador creía haberle
 * dado acceso, y lo que había creado era un usuario más de su propia empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS COMPROBACIONES, Y LA SEGUNDA ES LA QUE IMPORTA
 *
 *  1. QUE SEA UN SOCIO. Colgar una membresía de una organización que no es de
 *     tipo socio no emite identificador de socio: el usuario acabaría en el ERP
 *     interno creyendo todos que está en el portal.
 *  2. QUE SEA DE ESTA OPERADORA. Sin esto, un administrador engancha a alguien
 *     a un socio de OTRA operadora —los identificadores son uuid, y el
 *     formulario los manda tal cual— y ese usuario sale con la empresa
 *     equivocada en el token. No es un error de escritura: es cruzar el
 *     aislamiento entre inquilinos por el único sitio donde se puede.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CERROJO
 *
 * Mientras el ámbito del socio siga decidiéndose por el NOMBRE del rol
 * (`ctx.role === "partner"`, repetido en veintinueve sitios), un empleado de un
 * tour center dado de alta como `seller` o `cashier` entraría al ERP interno de
 * la operadora: tendría identificador de socio —que sí se emite— y un rol que
 * ninguna de esas condiciones reconoce.
 *
 * Así que aquí el rol se FUERZA a socio cuando la membresía cuelga de un socio.
 * Es una línea, y permite arreglar la puerta hoy sin esperar a la sustitución
 * de las veintinueve. Cuando esa sustitución esté, este forzado deja de ser la
 * barrera y pasa a ser lo que ya era: lo razonable.
 */
export interface DestinoMembresia {
  organizationId: string;
  role: AppRole;
  esSocio: boolean;
}

export async function resolveMembershipOrg(
  ctx: TenantContext & { companyId: string },
  partnerId: string | null | undefined,
  rolePedido: AppRole
): Promise<DestinoMembresia> {
  const id = (partnerId || "").trim();
  if (!id) {
    /**
     * LA OTRA MITAD DEL CERROJO, Y ESTA NO ESTABA EN NINGÚN SITIO DEL SERVIDOR.
     *
     * El rol de socio SIN tour center produce una persona con `role: partner`
     * y sin identificador —el enganche del token solo lo emite cuando la
     * organización es de tipo socio—. Y «sin identificador» es exactamente lo
     * que `app.can_read_partner` entiende por «ve todo»: ese usuario pasa el
     * ámbito del socio entero.
     *
     * El formulario de Configuración ya lo impedía, pero solo en el navegador:
     * la API aceptaba el alta tal cual. La equivalencia es rol de socio si y
     * solo si organización de socio, y desde 0073 también la exige la base.
     */
    if (rolePedido === "partner") {
      throw new TenantError(
        "El rol de socio exige elegir el tour center del que depende esa persona",
        400
      );
    }
    return { organizationId: ctx.companyId, role: rolePedido, esSocio: false };
  }

  const { data, error } = await supabaseService()
    .from("organizations")
    .select("id, kind, tenant_org_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;

  if (!data || data.kind !== "partner") {
    throw new TenantError("Ese tour center no existe o no es una empresa asociada", 400);
  }
  if (data.tenant_org_id !== ctx.companyId) {
    throw new TenantError("Ese tour center no es de tu empresa", 403);
  }
  if (data.status && data.status !== "active") {
    throw new TenantError("Ese tour center está inactivo: actívalo antes de darle acceso", 409);
  }

  // El cerrojo. Ver la cabecera de arriba.
  return { organizationId: data.id as string, role: "partner", esSocio: true };
}

export interface InvitacionEquipo {
  ctx: TenantContext & { companyId: string };
  email?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
  /** El tour center del que cuelga la membresía, si la persona es suya. */
  partnerId?: string | null;
  /** A dónde vuelve la persona desde el correo. */
  redirectTo: string;
}

export interface EquipoInvitado {
  userId: string;
  email: string;
  name: string;
  role: AppRole;
}

export async function inviteTeamMember(input: InvitacionEquipo): Promise<EquipoInvitado> {
  const { ctx } = input;
  const email = normalizeEmail(input.email);
  const name = (input.name || "").trim();
  if (!email || !isEmail(email)) throw new TenantError("Escribe un correo válido", 400);
  if (!name) throw new TenantError("El nombre es obligatorio", 400);

  const decision = roleDecision(ctx.role, input.role || "seller");
  if (decision.ok === false) throw new TenantError(decision.message!, decision.status);
  const role = decision.role!;

  await assertWithinLimit(ctx, "max_users");

  // De dónde cuelga la membresía, y el cerrojo si es de un socio.
  const destino = await resolveMembershipOrg(ctx, input.partnerId, role);

  const sb = supabaseService();
  const { data: invited, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
    redirectTo: input.redirectTo,
    data: { name },
  });

  // «Ya registrado» no es un fallo del sistema: es una persona que ya tiene
  // cuenta (en esta empresa o en otra), y el alta normal sabe vincularla.
  if (inviteError) {
    const message = /already|registered|exists/i.test(inviteError.message)
      ? "Ese correo ya tiene cuenta. Añádelo desde «Añadir existente» en vez de invitarlo."
      : inviteError.message;
    throw new TenantError(message, 409);
  }

  const userId = invited.user?.id;
  if (!userId) throw new Error("Supabase no devolvió la cuenta invitada");

  const { error: memberError } = await sb.from("organization_memberships").insert({
    user_id: userId,
    organization_id: destino.organizationId,
    role: destino.role,
    status: "pending",
    is_primary: true,
    branch_id: (input.branch || "").trim() || null,
  });
  if (memberError) throw memberError;

  await writeAudit({
    companyId: ctx.companyId, userId: ctx.userId,
    action: "team_member_invited",
    entityType: "user", entityId: userId,
    severity: "warning",
    description: `${ctx.email} invitó a ${email} con rol ${destino.role}` +
      (destino.esSocio ? ` para el tour center ${destino.organizationId}` : ""),
    metadata: { email, role: destino.role, partner: destino.esSocio ? destino.organizationId : null },
  });

  return { userId, email, name, role: destino.role };
}
