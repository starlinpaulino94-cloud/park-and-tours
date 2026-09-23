import { IMPORT_TARGETS } from "@/lib/import";

/**
 * La exportación, como decisión pura: qué columnas salen, cómo se escribe cada
 * valor y cómo se arma el archivo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES UN ADORNO
 *
 * Tres razones distintas, y las tres son de negocio:
 *
 *  1. EL CONTADOR PIDE EXCEL. El primer mes. Siempre. Un ERP del que no se
 *     puede sacar una hoja de cálculo obliga a teclear dos veces.
 *  2. ES LA PROMESA DEL BLOQUEO POR PLAN. Desde 0042, una empresa que no paga
 *     pierde la escritura y conserva «consultar y exportar». Si exportar no
 *     existe de verdad, esa promesa es un texto bonito en una pantalla roja.
 *  3. ES LO QUE HACE REVERSIBLE LA MUDANZA. Un cliente que sabe que puede
 *     llevarse sus datos entra sin miedo. Uno que sospecha que no, no entra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SALE TIENE QUE PODER VOLVER A ENTRAR
 *
 * Las cabeceras y los formatos son los MISMOS que entiende `import.ts`: fechas
 * en DD/MM/AAAA, números con punto decimal y sin separador de miles, etiquetas
 * separadas por `;`. Así el ciclo natural —exportar, corregir en Excel,
 * reimportar— funciona sin que nadie traduzca nada a mano, y el importador
 * detecta por correo o código que son las mismas fichas y las actualiza en vez
 * de duplicarlas. Hay una prueba que recorre ese círculo entero.
 */

/* --------------------------------------------------------- el archivo CSV */

/**
 * El BOM que Excel necesita para leer los acentos.
 *
 * Sin él, un archivo UTF-8 abierto con doble clic en Excel muestra «PÃ©rez» en
 * vez de «Pérez», y la primera reacción de quien lo abre es que el sistema
 * guardó mal los nombres. Se escribe como secuencia de escape y no como el
 * carácter —que es invisible en el fuente— por lo mismo que lo vigila la guarda
 * de `ui-contracts`.
 */
export const EXCEL_BOM = "\uFEFF";

/**
 * Una celda, escrita según RFC 4180.
 *
 * Se entrecomilla SIEMPRE que el valor lleve separador, comilla o salto de
 * línea. Lo que rompe un CSV en la práctica no es el caso raro: es la dirección
 * con coma y la nota con un salto, que aparecen en el primer archivo real.
 */
export function csvCell(value: string, delimiter = ","): string {
  if (value === "") return "";
  const needsQuotes = value.includes(delimiter) || value.includes('"')
    || value.includes("\n") || value.includes("\r");
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export interface CsvOptions {
  delimiter?: string;
  /** El BOM va por defecto: el destino de esto es Excel. */
  bom?: boolean;
}

export interface ExportOptions extends CsvOptions {
  /**
   * Saca también `created_at` y `updated_at`.
   *
   * En el listado estorban —ocupan dos columnas que nadie mira—, pero en el
   * volcado de «llévate tus datos» son parte del registro: cuándo se creó una
   * reserva es un dato del negocio, y quien recibe el volcado no puede
   * reconstruirlo de ninguna otra parte.
   */
  keepTimestamps?: boolean;
  /**
   * La lista blanca de campos, en su orden.
   *
   * Sin ella, las columnas salen de las claves que TRAIGAN las filas: el
   * archivo se lleva cualquier columna que un día se añada a la tabla. Es lo
   * correcto para el ERP interno —quien exporta quiere todo lo que tiene— y lo
   * contrario de lo que hace falta para un actor externo.
   *
   * Cuando está, manda: solo salen estos campos, en este orden, y los que no
   * estén en los datos simplemente no aparecen.
   */
  fields?: readonly string[];
}

/** Arma el archivo entero a partir de las cabeceras y las filas ya formateadas. */
export function toCsv(
  headers: string[],
  rows: string[][],
  options: CsvOptions = {}
): string {
  const delimiter = options.delimiter ?? ",";
  const lines = [
    headers.map((h) => csvCell(h, delimiter)).join(delimiter),
    ...rows.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)),
  ];
  // CRLF: es lo que esperan Excel y las herramientas de Windows, y el lector de
  // `import.ts` lo acepta igual que el salto simple.
  return (options.bom === false ? "" : EXCEL_BOM) + lines.join("\r\n");
}

/* ----------------------------------------------------- formato de valores */

/**
 * Un valor de la base, escrito como lo espera una hoja de cálculo Y como lo
 * vuelve a leer el importador.
 *
 * Las decisiones que importan:
 *
 *  · FECHA en DD/MM/AAAA. Es como se lee aquí y como `parseDate` la entiende.
 *    Una marca de tiempo completa se recorta a la fecha salvo que lleve hora
 *    distinta de medianoche, porque «31/12/2026 00:00» en una columna de
 *    cumpleaños es ruido.
 *  · NÚMERO con punto decimal y SIN separador de miles. Con separador, Excel en
 *    español lo lee como texto y la columna deja de sumar; sin él, entra como
 *    número en cualquier configuración regional.
 *  · REFERENCIA por su nombre, no por su uuid. Un uuid no le dice nada a quien
 *    abre el archivo, y al reimportar se cruza por nombre o código igual.
 *  · LISTA separada por `;` dentro de una celda, que es lo que `import.ts`
 *    parte de vuelta.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "boolean") return value ? "sí" : "no";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Sin notación científica y sin separador de miles.
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }

  if (Array.isArray(value)) {
    return value.map((v) => formatValue(v)).filter(Boolean).join("; ");
  }

  if (typeof value === "object") {
    const ref = value as Record<string, unknown>;
    // Una referencia expandida: se escribe como la reconoce una persona.
    //
    // La cadena se recorre saltando lo VACÍO, no solo lo nulo: un `??` aquí se
    // quedaría en el `join` de nombre y apellido —que devuelve "" cuando no hay
    // ninguno de los dos, y "" no es nullish—, así que un cliente con solo
    // correo habría salido como un uuid.
    const candidatos = [
      ref.name, ref.code, ref.title,
      [ref.first_name, ref.last_name].filter(Boolean).join(" "),
      ref.email,
    ];
    for (const candidato of candidatos) {
      if (typeof candidato === "string" && candidato.trim()) return candidato.trim();
    }
    if (typeof ref._id === "string") return ref._id;
    return "";
  }

  const text = String(value);

  // ¿Es una marca de tiempo ISO? Se escribe en el formato de aquí.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (iso) {
    const [, year, month, day, hour, minute] = iso;
    const fecha = `${day}/${month}/${year}`;
    return hour && !(hour === "00" && minute === "00") ? `${fecha} ${hour}:${minute}` : fecha;
  }

  return text;
}

/* ------------------------------------------------------------- columnas */

export interface ExportColumn {
  field: string;
  header: string;
}

/**
 * Campos que nunca salen: no le dicen nada a nadie y ensucian el archivo.
 *
 * `organization_id` es el inquilino —el mismo en todas las filas—, y los
 * identificadores internos solo tienen sentido dentro de esta base.
 */
const HIDDEN = new Set(["organization_id", "tenant_org_id"]);

/** Las marcas de tiempo: fuera del listado, dentro del volcado completo. */
const TIMESTAMPS = new Set(["createdAt", "updatedAt", "created_at", "updated_at"]);

/**
 * Cabeceras fijas para las columnas que no son del negocio.
 *
 * `prettify` las dejaría en «Created at», que en un archivo en español canta —y
 * en el volcado que se lleva un cliente, canta el doble.
 */
const FIXED_HEADERS: Record<string, string> = {
  _id: "Id interno",
  created_at: "Creado el",
  createdAt: "Creado el",
  updated_at: "Actualizado el",
  updatedAt: "Actualizado el",
};

/** Cabecera legible a partir del nombre de la columna, si no hay nada mejor. */
export function prettify(field: string): string {
  if (FIXED_HEADERS[field]) return FIXED_HEADERS[field];
  const clean = field.replace(/_id$/, "").replace(/_/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Las columnas del archivo.
 *
 * Cuando el recurso también se puede IMPORTAR, sus campos usan exactamente la
 * cabecera que el importador reconoce: así el archivo exportado se puede
 * corregir y volver a subir sin tocar la primera fila. El resto de campos salen
 * después, con su nombre legible, porque quien exporta quiere todo lo que tiene
 * y no solo lo que un día decidimos que se podía importar.
 */
export function exportColumns(
  resourceKey: string,
  rows: Record<string, unknown>[],
  options: ExportOptions = {}
): ExportColumn[] {
  const target = IMPORT_TARGETS.find((t) => t.resource === resourceKey);
  const importable = new Map((target?.fields ?? []).map((f) => [f.name, f.label]));

  /**
   * Con lista blanca, se acaba la deducción.
   *
   * Va ANTES de recorrer las filas y no después de filtrar el resultado: así
   * el orden es el DECLARADO y no el que traigan los datos, que cambia entre
   * dos exportaciones del mismo listado según qué fila venga primero con qué
   * campos rellenos. Un archivo cuyas columnas bailan no se puede comparar con
   * el del mes pasado.
   */
  if (options.fields) {
    const presentes = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) presentes.add(key);
    return options.fields
      .filter((field) => presentes.has(field))
      .map((field) => ({ field, header: importable.get(field) ?? prettify(field) }));
  }

  // Las claves presentes en los datos, en el orden en que aparecen: una fila
  // puede traer campos que otra no (columnas opcionales).
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (HIDDEN.has(key) || seen.includes(key)) continue;
      if (!options.keepTimestamps && TIMESTAMPS.has(key)) continue;
      seen.push(key);
    }
  }

  const columns: ExportColumn[] = [];
  // Primero, en el orden del importador: es el orden que espera quien va a
  // reimportar, y el que hace que la plantilla y el export se parezcan.
  for (const [field, label] of importable) {
    if (seen.includes(field)) columns.push({ field, header: label });
  }
  for (const field of seen) {
    if (importable.has(field)) continue;
    columns.push({ field, header: prettify(field) });
  }
  return columns;
}

/** El archivo completo de un listado. */
export function buildExport(
  resourceKey: string,
  rows: Record<string, unknown>[],
  options: ExportOptions = {}
): { csv: string; columns: ExportColumn[] } {
  const columns = exportColumns(resourceKey, rows, options);
  const csv = toCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((c) => formatValue(row[c.field]))),
    options
  );
  return { csv, columns };
}

/** Nombre del archivo: recurso y fecha, sin espacios ni acentos. */
export function exportFilename(resourceKey: string, now: Date = new Date()): string {
  return `${resourceKey}-${now.toISOString().slice(0, 10)}.csv`;
}
