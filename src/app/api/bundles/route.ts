import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { planBundle } from "@/lib/bundle-service";

/**
 * GET /api/bundles — arma el itinerario de un paquete para una fecha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UN GET PORQUE ES UNA LECTURA
 *
 * Mira las salidas que hay y devuelve cuáles encajan. No escribe nada.
 *
 * La primera versión era POST, porque las salidas elegidas a mano caben mejor
 * en un cuerpo que en una URL. Las guardas de contrato lo cazaron: todas las
 * rutas que escriben verifican el origen y el plan de la empresa, y una que
 * parece que escribe y no lo hace obliga a meter una excepción en esas dos
 * guardas — que es exactamente como dejan de proteger.
 *
 * Las salidas elegidas viajan como `chosen=<componente>:<salida>`, repetido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y NO VENDE
 *
 * Vender un paquete es POST /api/orders con la línea del paquete y su día. El
 * servidor vuelve a resolver el itinerario en ese momento, porque entre que se
 * pintó esta respuesta y se pulsó el botón una salida puede haberse llenado.
 * Aceptar aquí una venta sería confiar en un itinerario de hace tres minutos.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "seller");

    const params = new URL(req.url).searchParams;
    const bundleId = params.get("bundle");
    if (!bundleId) {
      return fail(Object.assign(new Error("Falta el paquete"), { status: 400 }));
    }
    const startDay = String(params.get("day") || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) {
      return fail(Object.assign(new Error("Falta el día en que empieza el paquete"), { status: 400 }));
    }

    // `chosen=<componente>:<salida>`, una vez por componente. Un par mal
    // formado se ignora en vez de tumbar la consulta: lo peor que hace es que
    // ese componente se resuelva solo.
    const chosen: Record<string, string> = {};
    for (const raw of params.getAll("chosen")) {
      const [itemId, departureId] = String(raw).split(":");
      if (itemId && departureId) chosen[itemId] = departureId;
    }

    const plan = await planBundle(ctx, {
      bundleId,
      startDay,
      pax: Math.max(1, Math.floor(Number(params.get("pax") ?? 1))),
      includeOptional: params.get("optional") !== "no",
      chosen: Object.keys(chosen).length > 0 ? chosen : undefined,
    });

    if (!plan) {
      return fail(Object.assign(new Error("Ese producto no es un paquete"), { status: 404 }));
    }
    return ok(plan);
  } catch (err) {
    return fail(err);
  }
}
