import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { benefitsForCustomer } from "@/lib/membego-redemption-service";

/**
 * GET /api/membego/benefits?customer=<id> — qué puede consumir AHORA.
 *
 * Es una LECTURA (`requireTenant`): consultar los beneficios de un cliente no
 * es una operación de la empresa, y una suscripción vencida no puede impedir
 * que el cajero le explique al cliente por qué no se le aplica nada.
 *
 * Cada llamada pregunta a MembeGo. No se cachea NADA, y eso es la regla que la
 * migración 0041 dejó escrita: una copia desfasada de la elegibilidad regala un
 * beneficio ya consumido. El límite por usuario está para que un componente con
 * un `useEffect` mal puesto no convierta esa decisión en un problema de cuota.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "seller");
    await assertRateLimit({ key: rateLimitKey(req, "membego:benefits", ctx.userId), limit: 60, windowMs: 60_000 });

    const customerId = (new URL(req.url).searchParams.get("customer") || "").trim();
    if (!customerId) return ok({ available: false, reason: "Indica el cliente.", evaluation: null });

    return ok(await benefitsForCustomer(ctx.companyId, customerId));
  } catch (err) {
    return fail(err);
  }
}
