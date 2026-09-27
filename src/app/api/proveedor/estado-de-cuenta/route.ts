import { NextRequest } from "next/server";
import {
  requireTenant, requireTenantWrite, requireAtLeast, TenantError,
  esDeProveedor, esInterno,
} from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  liquidacionesDeProveedor, aceptarLiquidacion, registrarFacturaDeProveedor,
} from "@/lib/estado-cuenta-proveedor";

/**
 * EL ESTADO DE CUENTA DEL PROVEEDOR.
 *
 *   GET  /api/proveedor/estado-de-cuenta — sus liquidaciones.
 *   POST /api/proveedor/estado-de-cuenta — conformidad, o su factura con NCF.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE ACOTA POR LA FICHA, NO POR EL PARÁMETRO
 *
 * Igual que sus servicios: si quien pregunta es un proveedor, el proveedor es
 * el SUYO. Atender un `?supplier_id=` aquí sería la forma de leer lo que la
 * operadora le paga al transportista de enfrente.
 *
 * El personal interno sí puede mirar el de un proveedor concreto —y registrar
 * por teléfono la conformidad de quien no usa el portal, que queda a su nombre
 * en la bitácora—, igual que gerencia puede abrir una disputa en nombre de un
 * socio desde 0076.
 */
const ACCIONES = new Set(["aceptar", "facturar"]);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:cuenta", ctx.userId), limit: 60, windowMs: 60_000,
    });

    let supplierId: string | null;
    if (esDeProveedor(ctx)) {
      supplierId = ctx.supplierId ?? null;
    } else if (esInterno(ctx)) {
      // Lo que se le paga a un proveedor es información de gerencia, no de
      // despacho: el mismo rango que abre cualquier otra liquidación.
      requireAtLeast(ctx, "manager");
      supplierId = (req.nextUrl.searchParams.get("supplier_id") || "").trim() || null;
    } else {
      throw new TenantError("No tienes acceso a este recurso", 403);
    }
    if (!supplierId) throw new TenantError("Indica el proveedor.", 400);

    return ok({ supplier_id: supplierId, liquidaciones: await liquidacionesDeProveedor(ctx.companyId, supplierId) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esDeProveedor(ctx) && !esInterno(ctx)) {
      throw new TenantError("No tienes acceso a este recurso", 403);
    }
    if (esInterno(ctx)) requireAtLeast(ctx, "manager");
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:cuenta:accion", ctx.userId), limit: 30, windowMs: 60_000,
    });

    const body = await readJson<{
      liquidacion?: unknown; accion?: unknown; ncf?: unknown; numero?: unknown;
    }>(req);
    const liquidacion = String(body?.liquidacion ?? "").trim();
    const accion = String(body?.accion ?? "");
    if (!liquidacion) throw new TenantError("Indica la liquidación", 400);
    if (!ACCIONES.has(accion)) throw new TenantError("Acción desconocida", 400);

    /**
     * DISPUTAR NO ESTÁ AQUÍ, y es a propósito: ya existe
     * `/api/settlements/:id/dispute` desde 0076, y lo abre la misma
     * comprobación de beneficiario que abrió el estado de cuenta. Escribir otra
     * ruta para lo mismo sería tener dos sitios donde vive la regla de cuándo
     * se puede disputar, y el que se quede viejo es el que decide.
     */
    if (accion === "aceptar") {
      return ok(await aceptarLiquidacion(ctx, liquidacion));
    }

    const ncf = String(body?.ncf ?? "");
    const numero = typeof body?.numero === "string" ? body.numero : null;
    return ok(await registrarFacturaDeProveedor(ctx, liquidacion, { ncf, numero }));
  } catch (err) {
    return fail(err);
  }
}
