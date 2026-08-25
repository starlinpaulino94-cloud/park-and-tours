import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { TenantError } from "@/lib/tenant";

/**
 * GET /api/cron/expire-approvals
 *
 * Marca como `expired` toda solicitud pendiente cuyo `expires_at` ya pasó.
 *
 * Las lecturas nunca dependen de este trabajo: `decidableFilter` descarta las
 * caducadas en la propia consulta, así que un cron caído no puede hacer que
 * aparezca como aprobable algo que expiró. Esto solo pone al día el estado
 * guardado para que el historial y los informes digan la verdad.
 *
 * Es un trabajo de plataforma, no de un inquilino: recorre todas las empresas
 * en una sola sentencia con el cliente de servicio. Por eso no puede
 * autenticarse con la sesión de un usuario y usa el secreto del cron, que
 * Vercel envía en `Authorization: Bearer <CRON_SECRET>`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/expire-approvals] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseService()
      .from("approval_request")
      .update({ status: "expired" })
      .eq("status", "pending")
      // Una solicitud sin fecha de expiración nunca cumple la comparación, así
      // que las de plazo abierto quedan intactas.
      .lt("expires_at", now)
      .select("id, organization_id");

    if (error) throw new Error(error.message);

    const expired = data?.length ?? 0;
    if (expired > 0) {
      console.log(`[cron/expire-approvals] ${expired} solicitudes marcadas como expiradas`);
      await writeAudit({
        action: "approvals_expired",
        entityType: "approval_request",
        description: `Caducidad automática de ${expired} solicitudes de aprobación`,
        severity: "info",
        metadata: { expired, ran_at: now },
      });
    }

    return ok({ expired, ranAt: now });
  } catch (err) {
    console.error("[cron/expire-approvals] error:", err);
    return fail(err);
  }
}
