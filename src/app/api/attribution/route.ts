import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { NADIE } from "@/lib/seller-scope";
import { ok, fail } from "@/lib/api-response";
import { funnelReport } from "@/lib/attribution-service";
import { DEFAULT_WINDOW_DAYS, POLICY_LABEL, normalizePolicy } from "@/lib/attribution";

/**
 * GET /api/attribution — el embudo de la red comercial.
 *
 * Es una LECTURA: `requireTenant` y no `requireTenantWrite`. Una suscripción
 * vencida deja de admitir operaciones nuevas, pero mirar de quién eran los
 * clientes que ya entraron tiene que seguir funcionando — es justo cuando hay
 * que decidir a quién se le paga lo pendiente.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();

    const url = new URL(req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)));

    /**
     * El embudo del vendedor es SUYO, y el parámetro de la consulta no existe
     * para él.
     *
     * Misma regla que en las metas, y por el mismo motivo: aceptar `?seller=` y
     * comprobar después que coincide deja un fallo de comparación —o un camino
     * nuevo que se olvide de comprobarlo— entre él y el embudo de un compañero,
     * que dice cuánta gente trae. Ignorándolo no hay comparación que pueda
     * salir mal.
     *
     * Y quien no tiene ficha vinculada no ve el de nadie, no ve «todos».
     */
    let sellerId: string | null;
    if (ctx.role === "seller") {
      sellerId = ctx.sellerId ?? NADIE;
    } else {
      requireAtLeast(ctx, "manager");
      sellerId = url.searchParams.get("seller");
    }

    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const report = await funnelReport(ctx.companyId, { sellerId, from });

    const company = ctx.company as {
      attribution_policy?: string | null;
      attribution_window_days?: number | null;
    } | null;
    const policy = normalizePolicy(company?.attribution_policy);

    return ok({
      ...report,
      days,
      policy,
      policyLabel: POLICY_LABEL[policy],
      windowDays: Number(company?.attribution_window_days ?? DEFAULT_WINDOW_DAYS),
      // El origen del enlace impreso: la pantalla no puede inventárselo, porque
      // en producción no es el mismo que en una vista previa.
      baseUrl: url.origin,
    });
  } catch (err) {
    return fail(err);
  }
}
