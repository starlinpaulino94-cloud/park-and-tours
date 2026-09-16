import { requireTenant } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { planStatusFor } from "@/lib/plan-service";

/**
 * GET /api/plan — el plan de la empresa y cuánto lleva usado.
 *
 * Es una LECTURA y por eso usa `requireTenant`: justo cuando la suscripción
 * está bloqueada es cuando el cliente más necesita ver esta pantalla, y una
 * guarda de escritura aquí le esconderia la explicación de su propio bloqueo.
 *
 * Sin rango mínimo de rol: los medidores no son información sensible, y un
 * cajero que no puede crear una reserva porque el mes se llenó tiene derecho a
 * saber por qué en vez de ver un error sin causa.
 */
export async function GET() {
  try {
    const ctx = await requireTenant();
    return ok(await planStatusFor(ctx));
  } catch (err) {
    return fail(err);
  }
}
