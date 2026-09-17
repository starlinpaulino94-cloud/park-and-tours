import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
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
    requireAtLeast(ctx, "manager");

    const url = new URL(req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
    const sellerId = url.searchParams.get("seller");

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
