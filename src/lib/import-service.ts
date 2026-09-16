import "server-only";
import { tenantQuery, tenantCreate, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { getResource } from "@/lib/resources";
import { assertWithinLimit } from "@/lib/plan-service";
import { writeAudit } from "@/lib/audit";
import type { ImportTarget, Prepared, PreparedRow } from "@/lib/import";

/**
 * El importador contra la base: cruzar con lo que ya existe y escribir.
 *
 * Todo lo que decide —qué es válido, qué es un duplicado, cómo se lee un número
 * o una fecha— vive en `import.ts` y es puro. Aquí solo quedan las dos cosas
 * que necesitan la base: saber qué filas ya están y meterlas.
 */

/** Cuántas filas se escriben a la vez. */
const BATCH = 25;

const keyOf = (field: string, value: string) => `${field}:${value.trim().toLowerCase()}`;

/**
 * Busca cuáles de las filas del archivo YA existen en la empresa.
 *
 * Se consulta por lotes y solo por los valores que trae el archivo, no la tabla
 * entera: una cartera de diez mil clientes no cabe en memoria y no hace falta.
 */
export async function resolveExisting(
  companyId: string,
  target: ImportTarget,
  rows: PreparedRow[]
): Promise<Map<string, string>> {
  const resource = getResource(target.resource);
  if (!resource) throw new Error(`Recurso desconocido: ${target.resource}`);

  const byField = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.dedupe) continue;
    const set = byField.get(row.dedupe.field) ?? new Set<string>();
    set.add(row.dedupe.value);
    byField.set(row.dedupe.field, set);
  }

  const found = new Map<string, string>();
  for (const [field, values] of byField) {
    const list = [...values];
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const matches = await tenantQuery<Record<string, unknown>>(companyId, resource.table, {
        _filter: { [field]: { in: chunk } },
        _limit: chunk.length,
      });
      for (const match of matches) {
        const value = match[field];
        if (typeof value === "string" && value.trim()) {
          // La primera gana: con dos fichas del mismo correo —que no debería
          // pasar pero pasa— se actualiza una y no se crea una tercera.
          const key = keyOf(field, value);
          if (!found.has(key)) found.set(key, String((match as { _id?: string })._id ?? ""));
        }
      }
    }
  }
  return found;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  failed: { line: number; message: string }[];
}

export interface RunOptions {
  /** Qué hacer con las filas que ya existen. */
  onExisting: "update" | "skip";
}

/**
 * Escribe las filas válidas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TECHO SE COMPRUEBA ANTES DE LA PRIMERA FILA
 *
 * Con sitio para diez y un archivo de sesenta, fallar en la número once deja al
 * cliente con diez productos importados, cincuenta fuera y ninguna forma de
 * saber cuáles. Se pide permiso para TODAS las creaciones de golpe y, si no
 * cabe, no entra ninguna.
 *
 * UNA FILA QUE FALLA NO DETIENE LAS DEMÁS. El archivo ya pasó por la validación
 * pura, así que lo que falle aquí es algo que solo la base sabía —una
 * restricción, una referencia— y es raro. Cortar en ese punto dejaría la
 * importación a medias sin poder repetirla: al reintentar, lo ya escrito se
 * detecta como duplicado, así que repetir es seguro.
 */
export async function runImport(
  ctx: TenantContext & { companyId: string },
  target: ImportTarget,
  prepared: Prepared,
  existing: Map<string, string>,
  options: RunOptions
): Promise<ImportOutcome> {
  const resource = getResource(target.resource);
  if (!resource) throw new Error(`Recurso desconocido: ${target.resource}`);

  const toCreate: PreparedRow[] = [];
  const toUpdate: { row: PreparedRow; id: string }[] = [];

  for (const row of prepared.valid) {
    const key = row.dedupe ? keyOf(row.dedupe.field, row.dedupe.value) : null;
    const id = key ? existing.get(key) : undefined;
    if (id) {
      if (options.onExisting === "update") toUpdate.push({ row, id });
    } else {
      toCreate.push(row);
    }
  }

  if (target.limitMetric && toCreate.length > 0) {
    await assertWithinLimit(ctx, target.limitMetric, toCreate.length);
  }

  const outcome: ImportOutcome = { created: 0, updated: 0, failed: [] };

  const settle = async <T>(items: T[], run: (item: T) => Promise<void>, lineOf: (item: T) => number) => {
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(run));
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          outcome.failed.push({ line: lineOf(batch[index]), message });
        }
      });
    }
  };

  await settle(
    toCreate,
    async (row) => {
      // El payload se arma aparte y no en línea: dentro de la llamada, el
      // `"source"` del `includes` se lee como el nombre de la tabla —la guarda
      // de esquema lo cazó— y además así se ve de un vistazo qué se escribe.
      const payload: Record<string, unknown> = { ...row.values };
      // La procedencia queda escrita: sirve para revertir una importación
      // equivocada y para no confundir lo migrado con lo capturado a mano.
      if (resource.writable.includes("source") && !payload.source) payload.source = "import";
      await tenantCreate(ctx.companyId, resource.table, payload);
      outcome.created++;
    },
    (row) => row.line
  );

  await settle(
    toUpdate,
    async ({ row, id }) => {
      // Solo los campos que el archivo trae: una columna ausente no puede
      // borrar lo que la ficha ya tenía, que es la forma más rápida de que una
      // importación de teléfonos deje a todo el mundo sin correo.
      await tenantUpdate(ctx.companyId, resource.table, id, row.values);
      outcome.updated++;
    },
    ({ row }) => row.line
  );

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "data_imported",
    entityType: resource.table,
    description:
      `Importación de ${target.label.toLowerCase()}: ${outcome.created} creados, ` +
      `${outcome.updated} actualizados, ${outcome.failed.length} con error ` +
      `(${prepared.rows.length} filas en el archivo)`,
    severity: "warning",
    metadata: {
      target: target.key,
      rows: prepared.rows.length,
      created: outcome.created,
      updated: outcome.updated,
      failed: outcome.failed.length,
      skipped: prepared.rows.length - prepared.valid.length,
    },
  });

  console.log(
    `[import] ${ctx.email} importó ${target.key}: ${outcome.created} creados, ` +
    `${outcome.updated} actualizados, ${outcome.failed.length} fallidos`
  );
  return outcome;
}
