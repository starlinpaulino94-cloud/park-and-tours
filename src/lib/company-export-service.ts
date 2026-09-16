import "server-only";
import { tenantQuery, atLeast, type TenantContext } from "@/lib/tenant";
import { getResource, readRoleFor } from "@/lib/resources";
import { buildListSort } from "@/lib/erp-query";
import { buildExport } from "@/lib/export";
import { createZip, type ZipEntry } from "@/lib/zip";
import {
  companyExportPlan, inventoryCsv, filesToWrite, readmeText, companyExportFilename,
  type CompanyExportRow,
} from "@/lib/company-export";

/**
 * El volcado de la empresa: consultar las ochenta y ocho tablas y armar el ZIP.
 *
 * Las decisiones de QUÉ sale están en `company-export.ts`, que es puro y se
 * prueba entero. Aquí solo queda lo que necesita base de datos.
 */

/**
 * Tope por tabla.
 *
 * Existe por una razón concreta: esto corre dentro de una función con límite de
 * tiempo y de memoria. Sin tope, la empresa que más datos tiene —la que más
 * necesita llevárselos— es justo la que recibiría un error. Con tope, recibe un
 * archivo completo salvo en las tablas enormes, y el LEEME le dice cuáles son y
 * cómo sacarlas por rango de fechas.
 */
export const ROWS_PER_TABLE = 5_000;
const PAGE = 500;

/**
 * Cuántas tablas se consultan a la vez.
 *
 * En serie, ochenta y ocho consultas agotan el tiempo de la función; todas a la
 * vez, agotan el grupo de conexiones de Postgres y la exportación tumba el
 * sistema para los demás. Seis es un número que cabe en los dos límites.
 */
const CONCURRENCY = 6;

/** Recorre una lista con un número fijo de tareas en vuelo. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface CompanyExport {
  bytes: Uint8Array;
  filename: string;
  rows: CompanyExportRow[];
  /** Registros exportados en total. */
  total: number;
  /** Tablas que salieron recortadas por el tope. */
  truncated: string[];
}

export async function buildCompanyExport(
  ctx: TenantContext,
  companyName: string,
  now: Date = new Date()
): Promise<CompanyExport> {
  const plan = companyExportPlan();

  const results = await mapLimit(plan, CONCURRENCY, async (target): Promise<CompanyExportRow & { csv: string }> => {
    const def = getResource(target.resource);
    if (!def) return { target, rows: 0, note: "el recurso ya no existe", csv: "" };

    // La misma autorización de lectura que el listado. El volcado exige rol de
    // administrador, así que en la práctica no se salta nada; está igual porque
    // un rol nuevo con menos alcance no debe convertir este botón en la puerta
    // de atrás para leer lo que su pantalla le niega.
    const required = readRoleFor(def.table);
    if (required && !atLeast(ctx.role, required)) {
      return { target, rows: 0, note: "sin permiso para leerla", csv: "" };
    }

    // Sin expandir relaciones: el volcado es fiel y rápido, y los
    // identificadores se cruzan entre las tablas del propio archivo.
    const rows: Record<string, unknown>[] = [];
    const sort = buildListSort(def, new URLSearchParams());
    let truncated = false;
    for (let offset = 0; offset < ROWS_PER_TABLE; offset += PAGE) {
      const batch = await tenantQuery<Record<string, unknown>>(ctx.companyId, def.table, {
        _filter: {},
        _sort: sort,
        _limit: PAGE,
        _offset: offset,
      });
      rows.push(...batch);
      if (batch.length < PAGE) break;
      if (rows.length >= ROWS_PER_TABLE) truncated = true;
    }

    if (rows.length === 0) return { target, rows: 0, note: "", csv: "" };

    // Con marcas de tiempo: aquí sí son parte del registro.
    const { csv } = buildExport(target.resource, rows, { keepTimestamps: true });
    return {
      target,
      rows: rows.length,
      note: truncated ? `recortada en ${ROWS_PER_TABLE} registros` : "",
      csv,
    };
  });

  const rows: CompanyExportRow[] = results.map(({ target, rows: count, note }) => ({ target, rows: count, note }));

  const entries: ZipEntry[] = [
    // El LEEME primero: es lo que se ve al abrir el archivo.
    { name: "LEEME.txt", content: readmeText({ company: companyName, at: now, rows, rowLimit: ROWS_PER_TABLE }) },
    { name: "_inventario.csv", content: inventoryCsv(rows) },
    ...results.filter((r) => r.rows > 0).map((r) => ({ name: r.target.path, content: r.csv })),
  ];

  return {
    bytes: createZip(entries, now),
    filename: companyExportFilename(companyName, now),
    rows,
    total: filesToWrite(rows).reduce((sum, r) => sum + r.rows, 0),
    truncated: rows.filter((r) => r.note.startsWith("recortada")).map((r) => r.target.table),
  };
}
