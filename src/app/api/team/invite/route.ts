import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertWithinLimit } from "@/lib/plan-service";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { inviteTeamMember } from "@/lib/team-invite";

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

    const body = await readJson<{ email?: string; name?: string; role?: string; branch?: string | null }>(req);

    // Lo que hacen igual esta alta y la de vendedores vive en `team-invite.ts`:
    // copiado, la divergencia es cuestión de tiempo y se nota en lo peor —el
    // tope del plan comprobado en un camino y no en el otro—.
    const { userId, email, name, role } = await inviteTeamMember({
      ctx, email: body.email, name: body.name, role: body.role,
      branch: body.branch, redirectTo: callbackUrl(req),
    });

    return ok({ _id: userId, email, name, role, status: "pending", state: "invited" });
  } catch (err) {
    return fail(err);
  }
}
