import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantQuery, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { apuntarMovimiento, movimientosDe, saldoDeSocio } from "@/lib/monedero-service";
import { saldoDe, TIPOS_DE_MOVIMIENTO, type TipoDeMovimiento } from "@/lib/monedero-socio";
import type { Partner } from "@/lib/types";

/**
 * EL MONEDERO DE UN SOCIO, DESDE DENTRO DE LA OPERADORA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SOCIO NO PUEDE RECARGARSE SOLO
 *
 * Es la puerta de atrás evidente de esta ola, y se cierra aquí antes que nada:
 * quien apunta una recarga es quien VE la transferencia en el banco, y eso es
 * la operadora. Si el socio pudiera escribir en su propio monedero, el saldo
 * dejaría de significar «dinero ingresado» para significar «lo que el socio
 * dice que ingresó», y con eso vendería sin haber pagado.
 *
 * Por eso son DOS rutas y no una con permisos: esta escribe y es solo interna;
 * `/api/portal/monedero` solo lee y es la del socio. Una ruta que hace las dos
 * cosas acaba teniendo un camino que se salta la comprobación.
 */
const TIPOS_A_MANO = new Set<TipoDeMovimiento>(["topup", "adjustment", "refund"]);

/** GET /api/partners/wallet?partner_id=… — saldo y movimientos. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "partners:wallet", ctx.userId), limit: 60, windowMs: 60_000 });
    // Ni siquiera para mirar: el saldo de un socio dice cuánto ingresa y cuánto
    // vende, y esta ruta acepta el socio por parámetro.
    if (esDeSocio(ctx)) throw new TenantError("Tu monedero está en el portal", 403);
    requireAtLeast(ctx, "manager");

    const partnerId = (req.nextUrl.searchParams.get("partner_id") || "").trim();
    if (!partnerId) throw new TenantError("Indica el socio.", 400);

    const movimientos = await movimientosDe(ctx.companyId, partnerId);
    return ok({
      partner_id: partnerId,
      // El saldo se suma sobre TODOS los movimientos, no sobre la página que se
      // devuelve: con más de quinientos, un saldo por página crecería solo.
      balance: await saldoDeSocio(ctx.companyId, partnerId),
      movements: movimientos,
    });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/partners/wallet — apunta una recarga, un ajuste o una devolución. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "partners:wallet:write", ctx.userId), limit: 30, windowMs: 60_000 });
    if (esDeSocio(ctx)) throw new TenantError("Un tour center no puede escribir en su propio monedero", 403);
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      partner_id?: string; movement_type?: string; amount?: number;
      reference?: string; note?: string;
    }>(req);

    const partnerId = String(body.partner_id || "").trim();
    if (!partnerId) throw new TenantError("Indica el socio.", 400);

    const tipo = String(body.movement_type || "topup") as TipoDeMovimiento;
    /**
     * `consumption` NO se apunta a mano.
     *
     * Lo escribe la venta, con su orden colgada y bajo el índice único que
     * impide descontarla dos veces. Dejarlo entrar por aquí crearía consumos
     * sin venta detrás — el saldo bajaría y no habría nada que enseñar cuando
     * el socio pregunte por qué.
     */
    if (!TIPOS_A_MANO.has(tipo)) {
      throw new TenantError(
        TIPOS_DE_MOVIMIENTO.includes(tipo)
          ? "El consumo lo apunta la venta, no se escribe a mano."
          : "Tipo de movimiento desconocido.",
        400
      );
    }

    const partner = (await tenantQuery<Partner>(ctx.companyId, "partner", {
      _filter: { _id: partnerId }, _limit: 1,
    }))[0];
    if (!partner) throw new TenantError("Partner no encontrado", 404);

    /**
     * La moneda del monedero es la de la RELACIÓN comercial, y no se pide en el
     * cuerpo: dejar que quien apunta elija la moneda es exactamente cómo se
     * mete una recarga en pesos en un monedero de dólares.
     */
    const moneda = String(partner.currency || ctx.company?.base_currency || "usd").toLowerCase();

    const movimiento = await apuntarMovimiento(
      ctx.companyId,
      {
        partnerId,
        tipo,
        importe: Number(body.amount ?? 0),
        moneda,
        referencia: (body.reference || "").trim() || null,
        nota: (body.note || "").trim() || null,
        userId: ctx.userId,
      },
      moneda
    );

    const saldo = await saldoDeSocio(ctx.companyId, partnerId);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "partner_wallet_movement", entityType: "partner", entityId: partnerId,
      description: `${tipo} de ${body.amount} ${moneda.toUpperCase()} · saldo ${saldo}` +
        (body.reference ? ` · ref ${body.reference}` : ""),
      // Un ajuste mueve dinero de un socio sin que haya venta ni transferencia
      // detrás: se marca para que salte en la revisión, no para acusar a nadie.
      severity: tipo === "adjustment" ? "warning" : "info",
      metadata: { movement_type: tipo, amount: body.amount, currency: moneda, balance: saldo },
    });

    // Y el socio se entera, que es la mitad del asunto: una recarga que él no ve
    // apuntada es una llamada al día siguiente preguntando si llegó.
    if (tipo === "topup") {
      await notify({
        companyId: ctx.companyId,
        partnerId,
        event: "partner_wallet_topup",
        entityType: "partner", entityId: partnerId,
        dedupeSeed: String(movimiento._id || ""),
        vars: { monto: Number(body.amount ?? 0), moneda, saldo },
      });
    }

    return ok({ movement: movimiento, balance: saldo });
  } catch (err) {
    return fail(err);
  }
}
