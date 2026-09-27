import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { redeemForOrder } from "@/lib/membego-redemption-service";
import { MembegoApiError } from "@/lib/membego-platform";
import type { EvaluatedBenefit } from "@/lib/membego-benefits";

/**
 * POST /api/membego/redeem — consumir el beneficio y rebajar la venta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PRIMERO MEMBEGO, DESPUÉS EL DESCUENTO
 *
 * El servicio consume en MembeGo y solo si MembeGo dijo que sí baja el importe.
 * Al revés sería regalar dinero: un beneficio que el cliente gastó hace diez
 * minutos en otra sucursal dejaría la venta rebajada sin nada que la respalde.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ERROR DE MEMBEGO SE TRADUCE, NO SE ESCONDE
 *
 * El cajero tiene que distinguir «no te quedan usos» de «no hay conexión»:
 * en el primer caso cobra completo, en el segundo espera un minuto. Un 500
 * genérico para las dos cosas convierte el mostrador en una adivinanza.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "seller");
    await assertRateLimit({ key: rateLimitKey(req, "membego:redeem", ctx.userId), limit: 20, windowMs: 60_000 });

    const body = await readJson<{
      order_id?: string;
      booking_id?: string | null;
      benefit?: EvaluatedBenefit;
    }>(req);

    if (!body.order_id) throw Object.assign(new Error("Indica la venta."), { status: 400 });
    if (!body.benefit?.id) throw Object.assign(new Error("Elige el beneficio que se va a canjear."), { status: 400 });

    /**
     * DEL CUERPO SOLO VIAJA CUÁL, NUNCA CUÁNTO.
     *
     * La pantalla manda el beneficio entero —así lo tiene en la mano— y antes se
     * pasaba tal cual, con su `eligible` y su `effect` dentro. Eso dejaba que el
     * navegador decidiera si el cliente tenía derecho y cuánto se le rebajaba.
     * Aquí se queda en el identificador y el tipo; el resto lo vuelve a preguntar
     * el servicio a MembeGo. El `evaluated_at` que la pantalla sigue mandando ya
     * no se lee: la frescura la pone la evaluación que hace el servidor, no la
     * que el cliente dice que hizo.
     */
    const result = await redeemForOrder(ctx, {
      orderId: body.order_id,
      benefit: { id: String(body.benefit.id), type: body.benefit.type },
      bookingId: body.booking_id ?? null,
    });

    return ok(result);
  } catch (err) {
    if (err instanceof MembegoApiError) {
      // El código de MembeGo viaja tal cual: es lo que la pantalla usa para
      // decidir si ofrecer «reintentar» o «cobrar completo».
      return Response.json(
        { error: { message: err.message, code: err.code, reason: err.reason, status: err.status } },
        { status: err.status }
      );
    }
    return fail(err);
  }
}
