import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireTenant, WORKSPACE_COOKIE } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { workspacesOf, canEnterWorkspace } from "@/lib/workspace-service";

/**
 * GET /api/workspace — las empresas a las que esta persona pertenece.
 *
 * Solo las suyas, y con el rol que tiene en cada una: el selector no es un
 * directorio de empresas del sistema.
 */
export async function GET() {
  try {
    const ctx = await requireTenant();
    return ok(await workspacesOf(ctx.userId, ctx.companyId));
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/workspace — cambiar de empresa sin cerrar la sesión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COOKIE NO DICE QUIÉN ERES, DICE QUÉ MIRAR
 *
 * Guarda el identificador de la empresa y nada más. En cada petición se vuelve
 * a buscar la membresía —y de ahí salen el rol, la sucursal y el socio—, así
 * que una cookie manipulada a mano solo consigue que el servidor busque una
 * membresía que no existe y siga en la empresa de siempre. Es la misma regla
 * que la cookie del QR de atribución, por el mismo motivo.
 *
 * Y una membresía que se desactiva deja de valer en la petición siguiente, sin
 * tener que cerrarle la sesión a nadie.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES LA SUPLANTACIÓN DEL SUPERADMIN
 *
 * Aquélla entra a CUALQUIER empresa porque quien la usa es el dueño de la
 * plataforma, dura dos horas y se marca en pantalla. Ésta solo entra donde ya
 * te habían dado de alta, y no caduca sola: es tu sitio, no una visita.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    await assertRateLimit({
      key: rateLimitKey(req, "workspace:switch", ctx.userId),
      limit: 30, windowMs: 60_000,
    });

    const body = await readJson<{ company_id?: string | null; stop?: boolean }>(req);
    const jar = await cookies();

    if (body?.stop || !body?.company_id) {
      jar.delete(WORKSPACE_COOKIE);
      return ok({ switched: false });
    }

    const destino = await canEnterWorkspace(ctx.userId, String(body.company_id));
    if (!destino) {
      // Mismo mensaje para una empresa que no existe y para una donde no tienes
      // membresía: contestar distinto convertiría esta ruta en una forma de
      // averiguar qué empresas hay en el sistema.
      throw Object.assign(new Error("No tienes acceso a esa empresa"), { status: 403 });
    }

    jar.set(WORKSPACE_COOKIE, destino.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Dura lo que dura la sesión del navegador y no un plazo inventado: el
      // día que alguien trabaja en la otra empresa, trabaja en la otra empresa.
      maxAge: 60 * 60 * 12,
      secure: (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://"),
    });

    await writeAudit({
      companyId: destino.id,
      userId: ctx.userId,
      action: "workspace_switched",
      entityType: "company",
      entityId: destino.id,
      description: `${ctx.email} entró a ${destino.name} como ${destino.role}`,
      metadata: { from: ctx.companyId, to: destino.id, role: destino.role },
    });

    return ok({ switched: true, company: destino });
  } catch (err) {
    return fail(err);
  }
}
