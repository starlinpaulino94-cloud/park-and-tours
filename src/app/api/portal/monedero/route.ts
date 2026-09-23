import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeSocio, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { movimientosDe, saldoDeSocio } from "@/lib/monedero-service";
import { esPrepago } from "@/lib/monedero-socio";
import type { Partner } from "@/lib/types";

/**
 * GET /api/portal/monedero — el saldo del tour center y sus movimientos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LEE, Y ESO ES LA MITAD DEL DISEÑO
 *
 * No hay POST aquí, y no por olvido: quien apunta una recarga es quien VE la
 * transferencia en el banco, y eso es la operadora (`/api/partners/wallet`). Si
 * el socio pudiera escribir en su propio monedero, el saldo dejaría de
 * significar «dinero ingresado» para significar «lo que el socio dice que
 * ingresó», y con eso vendería sin haber pagado.
 *
 * Dos rutas y no una con permisos: una ruta que lee y escribe acaba teniendo un
 * camino que se salta la comprobación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE ACOTA POR LA FICHA, NO POR EL PARÁMETRO
 *
 * Atender un `?partner_id=` a quien es del socio convertiría esto en la forma
 * de leer cuánto ingresa y cuánto vende la agencia de enfrente.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "portal:monedero", ctx.userId), limit: 60, windowMs: 60_000 });

    let partnerId: string | null;
    if (esDeSocio(ctx)) {
      partnerId = ctx.partnerId;
    } else {
      requireAtLeast(ctx, "manager");
      partnerId = (req.nextUrl.searchParams.get("partner_id") || "").trim() || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const partner = (await tenantQuery<Partner>(ctx.companyId, "partner", {
      _filter: { _id: partnerId }, _limit: 1,
    }))[0];
    if (!partner) throw new TenantError("Partner no encontrado", 404);

    const [balance, movements] = await Promise.all([
      saldoDeSocio(ctx.companyId, partnerId),
      movimientosDe(ctx.companyId, partnerId, 100),
    ]);

    return ok({
      partner_id: partnerId,
      currency: String(partner.currency || ctx.company?.base_currency || "usd").toLowerCase(),
      /**
       * Se dice si el prepago está activo o no.
       *
       * Un socio a crédito con movimientos viejos vería un saldo que no le
       * sirve para nada, y creería que puede vender contra él. La pantalla
       * necesita saber cuál de los dos contratos tiene.
       */
      prepaid: esPrepago(partner as { payment_mode?: string | null }),
      balance,
      movements,
    });
  } catch (err) {
    return fail(err);
  }
}
