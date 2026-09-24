import { requireTenant, requireAtLeast, TenantError, esInterno } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadRunSheet } from "@/lib/dispatch-service";

/**
 * GET /api/operations/routes/:id/run-sheet — la hoja que el conductor se lleva.
 *
 * Paradas en orden con la hora, el hotel, la habitación, los pax y a quién
 * busca. Sin ella, el conductor decide el recorrido en la calle.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA RUTA EXIGÍA SESIÓN Y NADA MÁS
 *
 * Y lo que devuelve son nombres, habitaciones y teléfonos de clientes. Mientras
 * los únicos con sesión eran empleados de la operadora, eso era un permiso que
 * faltaba; desde 0084 hay proveedores con cuenta, así que era la lista de
 * clientes del día a un identificador de distancia.
 *
 * Bajo `/api/operations/` está lo de LA CASA, así que aquí se cierra por
 * completo: rango de operaciones y nada de actores externos. El chofer tiene su
 * propia ruta en el portal del proveedor, y el ámbito que la acota —solo sus
 * rutas, solo alrededor del servicio, y anotada cada apertura— vive en
 * `loadRunSheet`, por donde pasan las dos.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    if (!esInterno(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    requireAtLeast(ctx, "operations");
    return ok(await loadRunSheet(ctx, id));
  } catch (err) {
    return fail(err);
  }
}
