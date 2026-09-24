import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeProveedor, esInterno } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { serviciosDeProveedor, type VentanaDeServicios } from "@/lib/servicios-proveedor";

/**
 * GET /api/proveedor/servicios?ventana=proximos|pasados
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE ACOTA POR LA FICHA, NO POR EL PARÁMETRO
 *
 * Si quien pregunta es un proveedor, el proveedor es el SUYO y ningún
 * parámetro lo cambia. Atender un `?supplier_id=` aquí convertiría esta ruta en
 * la forma de leer los servicios del transportista de enfrente — con los
 * puntos de recogida y el número de pasajeros de cada uno.
 *
 * El personal interno sí puede mirar el de un proveedor concreto, que es como
 * se atiende un «no me sale nada» por teléfono, y necesita rango para hacerlo.
 */
const VENTANAS = new Set<VentanaDeServicios>(["proximos", "pasados"]);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "proveedor:servicios", ctx.userId), limit: 60, windowMs: 60_000 });

    const sp = req.nextUrl.searchParams;
    let supplierId: string | null;
    if (esDeProveedor(ctx)) {
      supplierId = ctx.supplierId ?? null;
    } else if (esInterno(ctx)) {
      requireAtLeast(ctx, "operations");
      supplierId = (sp.get("supplier_id") || "").trim() || null;
    } else {
      // Ni proveedor ni interno —un socio, por ejemplo—: esto no es suyo.
      throw new TenantError("No tienes acceso a este recurso", 403);
    }
    if (!supplierId) throw new TenantError("Indica el proveedor.", 400);

    const pedida = (sp.get("ventana") || "proximos") as VentanaDeServicios;
    // Una ventana desconocida NO cae en «pasados» ni se inventa: cae en lo que
    // el portal enseña por defecto, que es lo que viene.
    const ventana: VentanaDeServicios = VENTANAS.has(pedida) ? pedida : "proximos";

    const servicios = await serviciosDeProveedor(ctx.companyId, supplierId, ventana);
    return ok({ supplier_id: supplierId, ventana, servicios });
  } catch (err) {
    return fail(err);
  }
}
