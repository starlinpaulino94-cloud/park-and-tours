import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, atLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { supabaseService } from "@/lib/supabase/service";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/team/mfa-reset — la salida del teléfono perdido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TIENE QUE EXISTIR
 *
 * Un segundo factor sin forma de restablecerlo convierte un teléfono roto en una
 * cuenta muerta: la persona no entra, y su empresa se queda sin su cajera un
 * sábado. La alternativa real no es «que tenga más cuidado», es que nadie active
 * el segundo factor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ ES PELIGROSO
 *
 * Quien puede quitar el segundo factor de una cuenta le quita su protección. Así
 * que: hace falta rol de administración, NO se puede hacer sobre alguien de rango
 * superior —un administrador no toca la cuenta del propietario— y queda en la
 * bitácora con severidad crítica, con nombre y apellido de quien lo hizo.
 *
 * Lo que este restablecimiento NO hace es dar acceso: la persona sigue
 * necesitando su contraseña. Solo se le quita el segundo paso.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    await assertRateLimit({ key: rateLimitKey(req, "team:mfa-reset", ctx.userId), limit: 10, windowMs: 60_000 });

    const body = await readJson<{ user_id?: string }>(req);
    const userId = (body.user_id || "").trim();
    if (!userId) throw new TenantError("Falta el identificador del usuario", 400);

    const sb = supabaseService();
    const { data: membership, error: loadError } = await sb
      .from("organization_memberships")
      .select("role, status")
      .eq("user_id", userId)
      .eq("organization_id", ctx.companyId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!membership) throw new TenantError("Usuario no encontrado en esta empresa", 404);

    // Nadie toca la seguridad de alguien por encima de sí mismo.
    if (!atLeast(ctx.role, membership.role as never)) {
      throw new TenantError(
        "No puedes restablecer la verificación de alguien con más rango que tú.",
        403
      );
    }

    const { data: factors, error: factorsError } = await sb.auth.admin.mfa.listFactors({ userId });
    if (factorsError) throw new Error(factorsError.message);

    let removed = 0;
    for (const factor of factors?.factors ?? []) {
      const { error } = await sb.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (error) throw new Error(error.message);
      removed++;
    }

    // La marca del token se apaga junto con los factores: si quedara puesta, la
    // persona seguiría atascada pidiéndole un código a una cuenta que ya no
    // tiene ninguno — el peor resultado posible de un restablecimiento.
    const { error: updateError } = await sb.auth.admin.updateUserById(userId, {
      app_metadata: { mfa_enabled: false },
    });
    if (updateError) throw new Error(updateError.message);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "mfa_reset",
      entityType: "user", entityId: userId,
      severity: "critical",
      description: `${ctx.email} restableció la verificación en dos pasos de otro usuario`,
      metadata: { removed, target_role: membership.role },
    });

    return ok({ removed });
  } catch (err) {
    return fail(err);
  }
}
