import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery, TenantError } from "@/lib/tenant";
import { getResource, assertCanReadTable } from "@/lib/resources";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { buildListFilter, buildListSort } from "@/lib/erp-query";
import { projectRows } from "@/lib/field-projection";
import { buildExport, exportFilename } from "@/lib/export";
import { writeAudit } from "@/lib/audit";

/**
 * GET /api/export/:resource — el listado que se está viendo, como CSV.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UNA LECTURA, Y ESO IMPORTA
 *
 * Usa `requireTenant` y no `requireTenantWrite` a propósito. Desde 0042, una
 * empresa con la suscripción bloqueada conserva «consultar y exportar»: si esta
 * ruta exigiera suscripción al día, la promesa que la pantalla roja le hace al
 * cliente sería falsa justo cuando más importa, y llevarse sus propios datos
 * dejaría de ser posible precisamente al dejar de pagar. Eso no se hace.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXPORTA LO QUE SE VE, NO LA PÁGINA
 *
 * Los mismos parámetros que el listado —búsqueda, filtros, rango de fechas,
 * orden— resueltos por el MISMO `buildListFilter`, así que el archivo no puede
 * traer filas distintas de las que la pantalla enseña. Lo que cambia es el
 * tamaño: se recorre en lotes hasta `MAX_ROWS` en vez de una página, porque
 * exportar veinticinco filas de trescientas no es exportar.
 */

/** Tope por archivo. Por encima, se exporta filtrando por rango de fechas. */
const MAX_ROWS = 10_000;
const PAGE = 500;

export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    const def = getResource(resource);
    if (!def) throw new TenantError(`Recurso desconocido: ${resource}`, 404);

    const ctx = await requireTenant();
    // Más estricto que el listado: un archivo completo es más caro de servir.
    await assertRateLimit({ key: rateLimitKey(req, `export:${def.table}`, ctx.userId), limit: 10, windowMs: 60_000 });

    // La autorización de lectura, en `resources.ts`: la escribían por su cuenta
    // el listado, el detalle y la exportación, y basta con que una se quede
    // atrás para que un rol lea por un camino lo que el otro le niega.
    assertCanReadTable(ctx, def.table);

    const sp = req.nextUrl.searchParams;
    const filter = buildListFilter(def, ctx, sp);
    const sort = buildListSort(def, sp);

    const rows: Record<string, unknown>[] = [];
    if (!filter._none) {
      // En lotes: una sola consulta de diez mil filas con relaciones expandidas
      // agota el tiempo de la función antes de devolver nada.
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const batch = await tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
          ...(def.expand || {}),
          _filter: filter,
          _sort: sort,
          _limit: PAGE,
          _offset: offset,
        });
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
    }

    /**
     * El recorte de columnas, también aquí.
     *
     * El exportador no sabe recortar por su cuenta: sin esta línea, el archivo
     * se llevaría el coste de cada excursión y la comisión de cada compañero
     * mientras la pantalla los esconde. Y nadie lo revisaría, porque «lo
     * exportó el sistema».
     */
    const { csv } = buildExport(resource, projectRows(def.table, ctx, rows));
    const filename = exportFilename(resource);

    // Queda en la bitácora: sacar la cartera de clientes en un archivo es
    // exactamente el movimiento que alguien querría poder revisar después.
    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "data_exported",
      entityType: def.table,
      description: `Exportación de ${def.table}: ${rows.length} registro(s)`,
      severity: rows.length > 500 ? "warning" : "info",
      metadata: { resource, rows: rows.length, filters: Object.keys(filter) },
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Un archivo con datos del inquilino no se guarda en ninguna caché
        // intermedia: la siguiente persona pediría el mismo recurso y podría
        // recibir el archivo de otra empresa.
        "Cache-Control": "no-store, private",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
