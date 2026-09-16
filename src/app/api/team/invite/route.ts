import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertWithinLimit } from "@/lib/plan-service";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { roleDecision, normalizeEmail, isEmail } from "@/lib/team";

/**
 * POST /api/team/invite — dar de alta a alguien SIN inventarle la contraseña.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO REEMPLAZA AL ALTA CON CONTRASEÑA
 *
 * Hasta ahora, para sumar a una persona al equipo, el administrador le
 * inventaba una contraseña y se la pasaba por WhatsApp. Eso tiene un coste que
 * no se ve hasta que hace falta: alguien más conoce la clave con la que se
 * cierran cajas y se anulan facturas, así que la bitácora —que existe para
 * responder «¿quién hizo esto?»— deja de responderlo. Y la contraseña queda
 * escrita en un chat para siempre.
 *
 * Con la invitación, la persona recibe un correo, entra por un enlace de un
 * solo uso y pone una contraseña que nadie más ha visto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA MEMBRESÍA NACE «PENDIENTE», Y ESO IMPORTA
 *
 * Solo las membresías activas resuelven inquilino, así que una invitación sin
 * aceptar no abre ninguna puerta: si el correo acaba en la bandeja equivocada,
 * quien lo reciba no entra a nada. Se activa sola al aceptar (`/auth/callback`).
 *
 * La plaza del plan sí se reserva desde el envío: si no contara, un plan de
 * cinco aceptaría veinte invitaciones y el tope saltaría delante de alguien que
 * ya recibió el correo.
 */

/** A dónde vuelve la persona desde el correo. */
function callbackUrl(req: NextRequest): string {
  // El origen de ESTA petición, no una variable de entorno: así la invitación
  // enviada desde una vista previa vuelve a esa vista previa, y la de
  // producción a producción, sin configurar nada en dos sitios.
  return new URL("/auth/callback?next=/auth/establecer-clave", req.nextUrl.origin).toString();
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    // Bajo a propósito: cada invitación manda un correo a una dirección que
    // elige quien la pide, y eso es un emisor de correo en manos de un usuario.
    await assertRateLimit({ key: rateLimitKey(req, "team:invite", ctx.userId), limit: 10, windowMs: 60_000 });

    const body = await readJson<{ email?: string; name?: string; role?: string }>(req);
    const email = normalizeEmail(body.email);
    const name = (body.name || "").trim();
    if (!email || !isEmail(email)) throw new TenantError("Escribe un correo válido", 400);
    if (!name) throw new TenantError("El nombre es obligatorio", 400);

    const decision = roleDecision(ctx.role, body.role || "seller");
    if (decision.ok === false) throw new TenantError(decision.message!, decision.status);
    const role = decision.role!;

    // El plan, antes de tocar Supabase Auth: al revés quedaría una cuenta
    // creada sin membresía, invisible en el equipo e imposible de volver a
    // invitar porque el correo ya existiría.
    await assertWithinLimit(ctx, "max_users");

    const sb = supabaseService();
    const { data: invited, error: inviteError } = await sb.auth.admin.inviteUserByEmail(email, {
      redirectTo: callbackUrl(req),
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
      // Pendiente hasta que la persona acepte: una invitación no es un acceso.
      status: "pending",
      is_primary: true,
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

    return ok({ _id: userId, email, name, role, status: "pending", state: "invited" });
  } catch (err) {
    return fail(err);
  }
}
