import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  parseDelimited, autoMap, prepareRows, summarize, targetByKey, IMPORT_TARGETS,
  type Mapping,
} from "@/lib/import";
import { resolveExisting, runImport } from "@/lib/import-service";

/**
 * POST /api/import — la vista previa y la importación, en una sola ruta.
 *
 * `dryRun: true` no escribe NADA: devuelve el mapeo propuesto, los problemas
 * fila por fila y el resumen de lo que pasaría. La pantalla siempre pide esto
 * primero, y la confirmación repite la misma petición con `dryRun: false`.
 *
 * El archivo viaja como TEXTO en el cuerpo y no como multipart: ya viene leído
 * por el navegador para poder enseñar la vista previa, y mandarlo dos veces en
 * dos formatos distintos solo añade una forma de que la vista previa y lo que
 * se escribe no coincidan.
 *
 * Es escritura (`requireTenantWrite`) incluso en la vista previa: una empresa
 * con la suscripción bloqueada no puede importar, y descubrirlo DESPUÉS de
 * mapear cuarenta columnas sería una pérdida de tiempo gratuita.
 */

/** Tope del archivo. Por encima, el navegador y la ruta sufren sin necesidad. */
const MAX_CHARS = 5_000_000;
const MAX_ROWS = 5_000;

interface Body {
  target?: string;
  csv?: string;
  /** Mapeo elegido a mano. Sin él, se propone automáticamente. */
  mapping?: Mapping;
  delimiter?: string;
  dryRun?: boolean;
  onExisting?: "update" | "skip";
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "import", ctx.userId), limit: 20, windowMs: 60_000 });

    const body = await readJson<Body>(req);
    const target = targetByKey(body.target || "");
    if (!target) {
      throw new TenantError(
        `Destino desconocido. Los disponibles son: ${IMPORT_TARGETS.map((t) => t.key).join(", ")}`,
        400
      );
    }
    // El mismo rango que escribir ese recurso a mano: importar mil clientes no
    // puede ser más fácil que crear uno.
    requireAtLeast(ctx, target.minRole);

    const csv = body.csv || "";
    if (!csv.trim()) throw new TenantError("El archivo está vacío", 400);
    if (csv.length > MAX_CHARS) {
      throw new TenantError(
        "El archivo es demasiado grande. Divídelo en partes de unas 5 000 filas.", 413
      );
    }

    const parsed = parseDelimited(csv, body.delimiter);
    if (parsed.headers.length === 0) throw new TenantError("No se encontró la fila de cabecera", 400);
    if (parsed.rows.length > MAX_ROWS) {
      throw new TenantError(
        `El archivo trae ${parsed.rows.length} filas y el máximo por tanda es ${MAX_ROWS}. Divídelo.`, 413
      );
    }

    const mapping = body.mapping && Object.keys(body.mapping).length > 0
      ? body.mapping
      : autoMap(parsed.headers, target);

    const prepared = prepareRows(parsed, mapping, target);
    const existing = await resolveExisting(ctx.companyId, target, prepared.valid);
    const summary = summarize(prepared, new Set(existing.keys()));

    if (body.dryRun !== false) {
      return ok({
        dryRun: true,
        headers: parsed.headers,
        delimiter: parsed.delimiter,
        mapping,
        summary,
        // Solo los primeros problemas: un archivo con mil errores no se corrige
        // leyendo mil líneas en pantalla, se corrige viendo el patrón.
        issues: prepared.issues.slice(0, 50),
        issuesTotal: prepared.issues.length,
        preview: prepared.rows.slice(0, 10).map((r) => ({
          line: r.line, values: r.values, issues: r.issues.length,
        })),
      });
    }

    if (prepared.valid.length === 0) {
      throw new TenantError("No hay ninguna fila válida que importar. Revisa los errores.", 400);
    }

    const outcome = await runImport(ctx, target, prepared, existing, {
      onExisting: body.onExisting === "skip" ? "skip" : "update",
    });

    return ok({ dryRun: false, summary, outcome });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/import — los destinos disponibles, sus campos y su ejemplo. */
export async function GET() {
  try {
    const { requireTenant } = await import("@/lib/tenant");
    const ctx = await requireTenant();
    const { sampleCsv } = await import("@/lib/import");
    const { atLeast } = await import("@/lib/tenant");
    return ok(
      IMPORT_TARGETS.filter((t) => atLeast(ctx.role, t.minRole)).map((t) => ({
        key: t.key,
        label: t.label,
        description: t.description,
        fields: t.fields.map((f) => ({
          name: f.name, label: f.label, type: f.type, required: !!f.required, values: f.values,
        })),
        sample: sampleCsv(t),
      }))
    );
  } catch (err) {
    return fail(err);
  }
}
