import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, TenantError, esDeProveedor } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { flotaDelProveedor, asignarFlotaDeProveedor } from "@/lib/asignacion-proveedor-service";
import { TABLA_DEL_TIPO, type TipoDeServicio } from "@/lib/asignacion-proveedor";

/**
 * /api/proveedor/asignacion — el transportista dice qué guagua y quién la conduce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO EL PROVEEDOR, Y SOLO EN LO SUYO
 *
 * Igual que la respuesta de 0087: aquí NO entra el personal interno, ni con
 * rango. La operadora ya puede asignar por la pantalla genérica de recursos —con
 * las mismas comprobaciones de papeles y de choque—, y añadirle esta puerta solo
 * crearía un segundo camino que hay que mantener al día.
 *
 * El proveedor sale de la FICHA (`ctx.supplierId`), nunca del cuerpo de la
 * petición. De quién es el servicio y de quién es la guagua lo decide
 * `supplier_id` en la base, no el rango ni el desplegable del navegador.
 */
const TIPOS = new Set<TipoDeServicio>(["recurso", "ruta"]);

/** Su flota, para llenar el desplegable. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    if (!esDeProveedor(ctx) || !ctx.supplierId) {
      throw new TenantError("Solo el proveedor consulta su flota", 403);
    }
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:flota", ctx.userId), limit: 120, windowMs: 60_000,
    });
    return ok(await flotaDelProveedor(ctx.companyId, ctx.supplierId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esDeProveedor(ctx) || !ctx.supplierId) {
      throw new TenantError("Solo el proveedor asigna su flota", 403);
    }
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:asignacion", ctx.userId), limit: 60, windowMs: 60_000,
    });

    const body = await readJson<Record<string, unknown>>(req);
    const tipo = String(body?.tipo ?? "") as TipoDeServicio;
    const id = String(body?.id ?? "").trim();
    if (!TIPOS.has(tipo)) throw new TenantError("Tipo de servicio desconocido", 400);
    if (!id) throw new TenantError("Indica el servicio", 400);
    // Que la tabla exista se comprueba aquí y no dentro: un tipo desconocido es
    // un error de quien llama, y contestarlo en la puerta evita que el servicio
    // tenga que razonar sobre una tabla que no existe.
    if (!TABLA_DEL_TIPO[tipo]) throw new TenantError("Tipo de servicio desconocido", 400);

    /**
     * Lo que se pasa al servicio son los campos CRUDOS, y es él quien los
     * recorta con la lista blanca de ese tipo de servicio. Recortarlos aquí
     * habría puesto la regla en la puerta, y hay dos puertas posibles —esta y el
     * día que haya una app— que entonces tendrían que acordarse las dos.
     */
    const asignado = await asignarFlotaDeProveedor(ctx, {
      tipo, id,
      vehicle: body?.vehicle,
      staff: body?.staff,
      driver: body?.driver,
      guide: body?.guide,
    });
    return ok(asignado);
  } catch (err) {
    return fail(err);
  }
}
