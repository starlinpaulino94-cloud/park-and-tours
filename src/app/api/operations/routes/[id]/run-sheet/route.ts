import { requireTenant } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadRunSheet } from "@/lib/dispatch-service";

/**
 * GET /api/operations/routes/:id/run-sheet — la hoja que el conductor se lleva.
 *
 * Paradas en orden con la hora, el hotel, la habitación, los pax y a quién
 * busca. Sin ella, el conductor decide el recorrido en la calle.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    return ok(await loadRunSheet(ctx.companyId, id));
  } catch (err) {
    return fail(err);
  }
}
