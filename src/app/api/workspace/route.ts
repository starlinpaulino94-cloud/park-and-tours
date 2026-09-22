import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireTenant, WORKSPACE_COOKIE } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { workspacesOf, canEnterWorkspace } from "@/lib/workspace-service";
import { supabaseService } from "@/lib/supabase/service";

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
      // Y se borra la empresa activa del token: el próximo refresco vuelve a la
      // principal. Sin esto, la cookie diría una empresa y el JWT otra.
      await clearActiveWorkspace(ctx.userId);
      return ok({ switched: false, reloadSession: true });
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

    // La empresa activa también viaja en el token: se guarda aquí para que el
    // enganche (0068) la ponga en el JWT en el próximo refresco. Es lo que hace
    // que RLS y el panel —que leen el org_id del token— respeten el cambio sin
    // cerrar sesión. El cliente refresca la sesión al recibir `reloadSession`.
    await setActiveWorkspace(ctx.userId, destino.id);

    await writeAudit({
      companyId: destino.id,
      userId: ctx.userId,
      action: "workspace_switched",
      entityType: "company",
      entityId: destino.id,
      description: `${ctx.email} entró a ${destino.name} como ${destino.role}`,
      metadata: { from: ctx.companyId, to: destino.id, role: destino.role },
    });

    return ok({ switched: true, company: destino, reloadSession: true });
  } catch (err) {
    return fail(err);
  }
}

/**
 * La empresa activa se escribe con la llave de servicio: es una fila del
 * usuario en una tabla de plataforma, no un dato de la empresa, y el enganche
 * del token (definer) es quien la lee. Va con `user_id` explícito.
 */
async function setActiveWorkspace(userId: string, orgId: string) {
  const sb = supabaseService();
  const { error } = await sb
    .from("user_active_workspace")
    .upsert({ user_id: userId, organization_id: orgId, updated_at: new Date().toISOString() },
            { onConflict: "user_id" });
  if (error) throw new Error(`no se pudo fijar la empresa activa: ${error.message}`);
}

async function clearActiveWorkspace(userId: string) {
  const sb = supabaseService();
  const { error } = await sb.from("user_active_workspace").delete().eq("user_id", userId);
  if (error) throw new Error(`no se pudo limpiar la empresa activa: ${error.message}`);
}
