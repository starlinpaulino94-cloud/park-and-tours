import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { octoChannels, recentOctoBookings } from "@/lib/octo-service";
import { SUPPORTED_CAPABILITIES } from "@/lib/octo";

/**
 * GET /api/octo/channels — lo que entra por los revendedores, para la operadora.
 *
 * Es una LECTURA: se usa `requireTenant` y no `requireTenantWrite`. Una
 * suscripción vencida deja de admitir operaciones nuevas, pero mirar lo que ya
 * se vendió tiene que seguir funcionando —es justamente cuando más falta hace.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days") ?? 90)));
    const [channels, bookings] = await Promise.all([
      octoChannels(ctx.companyId, days),
      recentOctoBookings(ctx.companyId, 50),
    ]);

    return ok({
      channels,
      bookings,
      capabilities: SUPPORTED_CAPABILITIES,
      endpoint: "/api/octo/v1",
      days,
    });
  } catch (err) {
    return fail(err);
  }
}
