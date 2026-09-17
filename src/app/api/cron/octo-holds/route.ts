import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { TenantError } from "@/lib/tenant";
import { sweepExpiredOctoHolds } from "@/lib/octo-service";

/**
 * GET /api/cron/octo-holds — soltar las plazas que una OTA retuvo y no pagó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UN CRON APARTE
 *
 * El barrido de retenciones vive en el cron de cobros y corre una vez al día,
 * que es lo correcto para una venta de mostrador retenida 24 horas por una
 * transferencia. Una retención de OTA dura treinta minutos: para ella, un
 * barrido diario es como no tener ninguno.
 *
 * Las consultas de disponibilidad ya barren de forma oportunista —quien
 * pregunta por plazas es quien necesita que estén al día—, pero eso solo cubre
 * a la operadora que tiene tráfico. Este cron cubre a la que no: la que tuvo
 * tres reservas por la mañana, ninguna consulta después, y se quedaría con las
 * plazas bloqueadas hasta el día siguiente.
 *
 * Como el resto de los trabajos programados recorre TODOS los inquilinos, se
 * autentica con el secreto del cron y usa el cliente de servicio con
 * `organization_id` explícito: bajo RLS, las ayudas de inquilino resuelven la
 * sesión desde las cookies de la petición, que un cron no tiene.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/octo-holds] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    const now = new Date();

    // Solo las empresas que TIENEN algo vencido. Recorrer todas las del sistema
    // para descubrir que casi ninguna vende por OTA sería gastar el presupuesto
    // del cron en no hacer nada.
    const { data, error } = await supabaseService()
      .from("sales_order")
      .select("organization_id")
      .eq("status", "pending_payment")
      .not("hold_until", "is", null)
      .lt("hold_until", now.toISOString())
      .limit(2000);
    if (error) throw new Error(error.message);

    const companies = [...new Set((data ?? []).map((row) => String(row.organization_id)))];
    let expired = 0;

    for (const companyId of companies) {
      try {
        expired += await sweepExpiredOctoHolds(companyId, now);
      } catch (err) {
        // Una empresa con un problema no deja a las demás con las plazas
        // bloqueadas.
        console.error(`[cron/octo-holds] el barrido de ${companyId} falló:`, err);
      }
    }

    console.log(`[cron/octo-holds] ${companies.length} empresa(s) revisada(s) · ${expired} retención(es) vencida(s)`);
    return ok({ companies: companies.length, expired, ranAt: now.toISOString() });
  } catch (err) {
    console.error("[cron/octo-holds] error:", err);
    return fail(err);
  }
}
