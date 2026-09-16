import { NextRequest } from "next/server";
import { getTenantContext, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";
import { hasVerifiedFactor } from "@/lib/mfa";

/**
 * POST /api/account/mfa — pone la marca de «esta cuenta exige segundo factor».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO RECIBE ÓRDENES: MIRA LA REALIDAD Y LA COPIA
 *
 * No hay parámetro de «activar» o «desactivar». La ruta pregunta a Supabase qué
 * factores tiene esta cuenta y pone la marca en consecuencia. Eso hace imposible
 * el fallo que importa: que la marca diga «protegida» sin factor —dejando a la
 * persona fuera de su cuenta para siempre— o que diga «sin protección» con un
 * factor verificado, que es la puerta que el segundo factor venía a cerrar.
 *
 * Como consecuencia, llamarla de más no hace nada: vuelve a copiar la verdad.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA MARCA Y NO LOS FACTORES
 *
 * La marca vive en `app_metadata`, que viaja en el token y solo escribe el rol
 * de servicio. Sin ella habría que preguntarle a Supabase por los factores en
 * CADA petición; con `user_metadata` la borraría el propio usuario —y quien
 * tiene una contraseña robada la borraría primero.
 *
 * Se usa `getTenantContext` y no `requireTenant` a propósito: `requireTenant`
 * rechaza las sesiones a medio verificar, y esta ruta se llama justo al terminar
 * de enrolar, cuando el token todavía no se ha renovado.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await getTenantContext();
    if (!ctx) throw new TenantError("No autenticado", 401);
    await assertRateLimit({ key: rateLimitKey(req, "account:mfa", ctx.userId), limit: 20, windowMs: 60_000 });

    const sb = supabaseService();
    const { data: factors, error } = await sb.auth.admin.mfa.listFactors({ userId: ctx.userId });
    if (error) throw new Error(error.message);

    const enabled = hasVerifiedFactor(factors?.factors);
    const { data: current } = await sb.auth.admin.getUserById(ctx.userId);
    const before = (current.user?.app_metadata as { mfa_enabled?: boolean } | undefined)?.mfa_enabled === true;

    if (before !== enabled) {
      const { error: updateError } = await sb.auth.admin.updateUserById(ctx.userId, {
        app_metadata: { mfa_enabled: enabled },
      });
      if (updateError) throw new Error(updateError.message);

      // Queda en la bitácora: activar o quitar el segundo factor de una cuenta
      // es justo lo que alguien querría poder revisar después de un incidente.
      await writeAudit({
        companyId: ctx.companyId || "",
        userId: ctx.userId,
        action: enabled ? "mfa_enabled" : "mfa_disabled",
        entityType: "user",
        entityId: ctx.userId,
        severity: "warning",
        description: enabled
          ? `${ctx.email} activó el segundo factor en su cuenta`
          : `${ctx.email} quitó el segundo factor de su cuenta`,
      });
    }

    return ok({ mfaEnabled: enabled });
  } catch (err) {
    return fail(err);
  }
}
