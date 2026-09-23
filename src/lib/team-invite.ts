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

export interface InvitacionEquipo {
  ctx: TenantContext & { companyId: string };
  email?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
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
    organization_id: ctx.companyId,
    role,
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
    description: `${ctx.email} invitó a ${email} con rol ${role}`,
    metadata: { email, role },
  });

  return { userId, email, name, role };
}
