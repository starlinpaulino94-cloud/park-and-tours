import { describe, it, expect, vi } from "vitest";

// `expand.ts` arrastra el proveedor de datos al importarse; aquí solo se
// necesitan sus mapas de relaciones.
vi.mock("@/lib/supabase/data-provider", () => ({ spQuery: vi.fn() }));
vi.mock("@/lib/user-directory", () => ({ resolveUserNames: vi.fn() }));
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_FIELD_ALIASES, TABLE_FIELD_ALIASES } from "@/lib/supabase/query-translator";
import { IMPORT_TARGETS } from "@/lib/import";
import { RESOURCES } from "@/lib/resources";
import {
  RELATION_RESOURCE, TABLE_RELATION_RESOURCE, USER_REF_FIELDS, childForeignKey,
} from "@/lib/supabase/expand";

/**
 * Lo que la aplicación escribe contra las columnas que existen de verdad.
 *
 * PostgREST rechaza el INSERT/UPDATE COMPLETO cuando una sola columna del
 * payload no existe, así que un campo de más no degrada la escritura: la anula.
 * Y nada lo avisa antes de producción, porque TypeScript valida el objeto
 * contra la interfaz de `types.ts`, no contra el esquema.
 *
 * Así se acumularon dos fallos de la misma familia, encontrados cruzando las dos
 * cosas a mano:
 *
 *  - El mapa de alias cubría 26 de las 72 columnas de referencia del esquema.
 *    Las demás viajaban con su nombre pelado (`quote`, `staff`, `supplier`…) y
 *    PostgREST no las encontraba: guardar una línea de cotización, asignar una
 *    tarea a un lead o registrar una compra devolvía 400.
 *  - Faltaban 93 columnas que la aplicación daba por hechas, entre ellas las 10
 *    que `booking-service.ts` escribe al crear una reserva y las 7 que la caja
 *    necesita para abrirse y cerrarse. 0021 ya había parcheado tres de oído;
 *    0030 hizo el barrido completo.
 *
 * Esta prueba reconstruye el esquema leyendo las migraciones en cada ejecución y
 * compara las dos fuentes de escritura —el CRUD genérico de `resources.ts` y
 * los payloads literales de cada `tenantCreate`/`tenantUpdate`— contra él.
 * Cualquier campo nuevo sin su columna rompe aquí.
 */

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const SRC = path.join(ROOT, "src");

/** `partner` no es una tabla: vive en `organizations` con su propio traductor. */
const VIRTUAL_RESOURCES = new Set(["partner"]);

/** Nombre de recurso -> tabla real (espejo de `TABLE_MAP` en data-backend.ts). */
const TABLE_MAP: Record<string, string> = { company: "organizations", order: "sales_order" };

/** Claves que el traductor descarta antes de llegar a Postgres. */
const DROPPED = new Set(["_id", "id", "createdAt", "updatedAt", "created_at", "updated_at", "company", "organization_id"]);

const CONSTRAINT = /^(primary|unique|check|foreign|constraint|exclude|like)\b/i;

/** Corta una lista por las comas de nivel superior, respetando paréntesis. */
function splitTopLevel(body: string, open = "(", close = ")"): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (open.includes(ch)) depth++;
    else if (close.includes(ch)) depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Toma el cuerpo entre paréntesis que empieza en `from` (que ya está abierto). */
function balanced(text: string, from: number): { body: string; end: number } {
  let depth = 1, i = from;
  while (i < text.length && depth > 0) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    i++;
  }
  return { body: text.slice(from, i - 1), end: i };
}

/**
 * Columnas reales por tabla, leídas de las migraciones.
 *
 * Solo hay altas: ninguna migración borra ni renombra columnas, así que la unión
 * de `create table` y `add column` es el esquema vigente.
 */
function readSchema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (t: string, c: string) => {
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t)!.add(c);
  };

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");

    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      const { body, end } = balanced(sql, create.lastIndex);
      create.lastIndex = end;
      for (const raw of splitTopLevel(body)) {
        const line = raw.trim();
        if (!line || CONSTRAINT.test(line)) continue;
        const name = /^(\w+)/.exec(line);
        if (name) add(m[1], name[1]);
      }
    }

    const alter = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi;
    while ((m = alter.exec(sql))) {
      for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) add(m[1], c[1]);
    }
  }
  return tables;
}

const SCHEMA = readSchema();

/** Todas las migraciones concatenadas, sin comentarios: para buscar literales. */
const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, ""))
  .join("\n");

/** Columnas declaradas `boolean` en las migraciones. */
function readBooleanColumns(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/^\s*(\w+)\s+boolean\b/gim)) out.add(m[1]);
    for (const m of sql.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+boolean\b/gi)) out.add(m[1]);
  }
  return out;
}

const BOOLEAN_COLUMNS = readBooleanColumns();

/**
 * Columnas `not null` sin valor por defecto que son el CÓDIGO de un documento.
 *
 * `name` o `title` los teclea quien rellena el formulario; un código —el número
 * de una orden, de una reserva, de una cotización— no: lo genera el servidor y
 * no puede repetirse dentro del inquilino. Cuando ninguna de las dos cosas
 * ocurre, la pantalla ofrece un botón de alta que la base rechaza.
 */
function readRequiredCodeColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const isCode = (c: string) => c === "code" || c === "number" || c === "reference" || /_number$/.test(c);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      const { body, end } = balanced(sql, create.lastIndex);
      create.lastIndex = end;
      for (const raw of splitTopLevel(body)) {
        const line = raw.trim();
        if (!line || CONSTRAINT.test(line)) continue;
        const col = /^(\w+)\s+text\s+not null\s*$/.exec(line);
        if (col && isCode(col[1])) out.set(m[1], [...(out.get(m[1]) ?? []), col[1]]);
      }
    }
  }
  return out;
}

const REQUIRED_CODE_COLUMNS = readRequiredCodeColumns();

function columnFor(table: string, field: string): string {
  return TABLE_FIELD_ALIASES[table]?.[field] ?? DEFAULT_FIELD_ALIASES[field] ?? field;
}

/** `tabla.columna` que la aplicación escribiría, o null si existe. */
function miss(resourceOrTable: string, field: string): string | null {
  const table = TABLE_MAP[resourceOrTable] ?? resourceOrTable;
  const columns = SCHEMA.get(table);
  if (!columns) return `${table} (tabla inexistente)`;
  const column = columnFor(table, field);
  return columns.has(column) ? null : `${table}.${column}`;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("el esquema cubre todo lo que la aplicación escribe", () => {
  it("las columnas de referencia tienen su alias", () => {
    // Toda columna `<campo>_id` del esquema necesita entrada en el mapa, o el
    // campo viaja sin el sufijo y PostgREST no lo encuentra.
    const targets = new Set(Object.values(DEFAULT_FIELD_ALIASES));
    for (const overrides of Object.values(TABLE_FIELD_ALIASES)) {
      for (const col of Object.values(overrides)) targets.add(col);
    }

    const unmapped: string[] = [];
    for (const [table, columns] of SCHEMA) {
      for (const column of columns) {
        if (column === "organization_id" || !column.endsWith("_id")) continue;
        // Columnas de identidad (`document_id`, `tax_id`, `external_id`…) no son
        // referencias: se escriben con su propio nombre y no necesitan alias.
        if (!SCHEMA.has(column.slice(0, -3)) && !targets.has(column)) continue;
        if (!targets.has(column)) unmapped.push(`${table}.${column}`);
      }
    }
    expect(unmapped, "columnas de referencia sin alias en DEFAULT_FIELD_ALIASES").toEqual([]);
  });

  it("cada alias apunta a una columna que existe", () => {
    // `parent_partner` existe solo para que `toPartnerPayload` lo descarte: el
    // partner vive en `organizations` y ese dato no se guarda en ninguna columna.
    const VIRTUAL_ALIASES = new Set(["parent_partner"]);

    const all = new Set<string>();
    for (const columns of SCHEMA.values()) for (const c of columns) all.add(c);
    const dangling = Object.entries(DEFAULT_FIELD_ALIASES)
      .filter(([field, col]) => !VIRTUAL_ALIASES.has(field) && !all.has(col))
      .map(([field, col]) => `${field} -> ${col}`);
    expect(dangling, "alias que apuntan a una columna inexistente").toEqual([]);
  });

  it("los campos escribibles de resources.ts existen como columnas", () => {
    const src = readFileSync(path.join(SRC, "lib/resources.ts"), "utf8");
    const problems: string[] = [];

    for (const block of src.matchAll(/^ {2}(\w+):\s*\{\n([\s\S]*?)^ {2}\},/gm)) {
      const [, name, body] = block;
      if (VIRTUAL_RESOURCES.has(name)) continue;
      const table = /table:\s*"(\w+)"/.exec(body)?.[1] ?? name;
      for (const key of ["writable", "numeric", "dates", "search"]) {
        const list = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(body);
        if (!list) continue;
        for (const f of list[1].matchAll(/"(\w+)"/g)) {
          const gap = miss(table, f[1]);
          if (gap) problems.push(`${name}.${key}: ${f[1]} -> ${gap}`);
        }
      }
    }
    expect(problems, "resources.ts declara campos sin columna").toEqual([]);
  });

  it("los payloads de tenantCreate/tenantUpdate existen como columnas", () => {
    const problems: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      const call = /tenant(?:Create|Update)(?:<[^>]*>)?\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = call.exec(src))) {
        const { body: args, end } = balanced(src, call.lastIndex);
        call.lastIndex = end;

        const table = /"(\w+)"/.exec(args)?.[1];
        if (!table) continue;
        const objStart = args.indexOf("{", args.indexOf(`"${table}"`));
        if (objStart < 0) continue;
        const { body } = balanced(args, objStart + 1);

        for (const raw of splitTopLevel(body, "{[(", "}])")) {
          // Solo claves literales: un `...spread` o una clave calculada no se
          // puede resolver leyendo el texto, y se deja pasar a propósito.
          const field = /^\s*(\w+)\s*[:,]/.exec(`${raw.trim()},`)?.[1];
          if (!field || DROPPED.has(field)) continue;
          const gap = miss(table, field);
          if (gap) problems.push(`${path.relative(ROOT, file)}: ${field} -> ${gap}`);
        }
      }
    }
    expect(problems, "un payload escribe columnas que no existen").toEqual([]);
  });

  it("ninguna columna booleana se compara contra \"yes\"/\"no\"", () => {
    // PostgREST devuelve los booleanos como true/false, así que `x === "yes"`
    // es siempre falso y el control que depende de él queda desactivado en
    // silencio. Ya pasó con `approval_request.requires_two` (la doble firma
    // nunca se exigía) y seguía vivo en `warehouse.allows_negative`,
    // `asset.blocks_capacity`, `attraction.requires_waiver` y `plan.is_premium`.
    const problems: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(\w+)\s*(?:===|!==|==|!=)\s*"(yes|no)"/g)) {
        if (BOOLEAN_COLUMNS.has(m[1])) {
          problems.push(`${path.relative(ROOT, file)}: ${m[1]} vs "${m[2]}"`);
        }
      }
      for (const m of src.matchAll(/(\w+)\s*:\s*[^,;\n]*\?\s*"yes"\s*:\s*"no"/g)) {
        if (BOOLEAN_COLUMNS.has(m[1])) {
          problems.push(`${path.relative(ROOT, file)}: escribe "yes"/"no" en ${m[1]}`);
        }
      }
      // Y el literal directo, que es como se escribían y filtraban los asientos
      // contables: Postgres convertía 'no' al guardar, pero devolvía false.
      for (const m of src.matchAll(/(\w+)\s*:\s*"(yes|no)"/g)) {
        if (BOOLEAN_COLUMNS.has(m[1])) {
          problems.push(`${path.relative(ROOT, file)}: ${m[1]}: "${m[2]}" en una columna booleana`);
        }
      }
    }
    expect(problems, "columna booleana tratada como texto yes/no").toEqual([]);
  });

  it("todo campo booleano escribible está declarado en su recurso", () => {
    // El formulario genérico manda "yes"/"no"; sin la declaración no se
    // convierten, y la columna queda a merced de la conversión de Postgres.
    const src = readFileSync(path.join(SRC, "lib/resources.ts"), "utf8");
    const missing: string[] = [];

    for (const block of src.matchAll(/^ {2}(\w+):\s*\{\n([\s\S]*?)^ {2}\},/gm)) {
      const [, name, body] = block;
      if (VIRTUAL_RESOURCES.has(name)) continue;
      const table = TABLE_MAP[/table:\s*"(\w+)"/.exec(body)?.[1] ?? name] ?? /table:\s*"(\w+)"/.exec(body)?.[1] ?? name;
      const columns = SCHEMA.get(table);
      if (!columns) continue;

      const writable = /writable:\s*\[([^\]]*)\]/.exec(body);
      if (!writable) continue;
      const declared = new Set(
        [...(/booleans:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1])
      );

      for (const field of [...writable[1].matchAll(/"(\w+)"/g)].map((m) => m[1])) {
        const column = TABLE_FIELD_ALIASES[table]?.[field] ?? DEFAULT_FIELD_ALIASES[field] ?? field;
        if (columns.has(column) && BOOLEAN_COLUMNS.has(column) && !declared.has(field)) {
          missing.push(`${name}.booleans debe incluir "${field}"`);
        }
      }
    }
    expect(missing, "campo booleano escribible sin declarar").toEqual([]);
  });

  it("todo documento con código obligatorio sabe de dónde sale ese código", () => {
    /**
     * PostgREST rechaza el INSERT entero cuando falta una columna `not null`, y
     * el formulario genérico solo manda los campos que declara. Así se rompió el
     * alta de cotizaciones en cuanto se le puso el botón: `quote.code` es `not
     * null` y único por inquilino, y ni la pantalla lo pedía ni nadie lo
     * generaba, de modo que "Nueva cotización" devolvía un error de base.
     *
     * Solo hay dos respuestas válidas, y esta prueba obliga a elegir una:
     * generarlo en una acción del servidor, o pedirlo en el formulario.
     */
    const GENERATED_BY_ACTION: Record<string, string> = {
      sales_order: "booking-service genera order_number",
      booking: "booking-service genera booking_number",
      voucher: "lo emite la reserva",
      quote: "/api/quotes lo genera con uniqueCode",
      gift_card: "/api/gift-cards lo genera",
      access_ticket: "/api/tickets lo genera",
      settlement: "el proceso de liquidación lo genera",
      payment: "el cobro genera su referencia",
      approval_request: "lo genera el flujo de aprobaciones",
      stripe_event: "viene del webhook de Stripe",
      subscription_invoice: "la numera la facturación de la plataforma",
      purchase_order_line: "es hija de su orden de compra",
    };

    const resources = readFileSync(path.join(SRC, "lib/resources.ts"), "utf8");
    const tableOf = new Map<string, string>();
    for (const block of resources.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},/gm)) {
      const table = /table:\s*"(\w+)"/.exec(block[2])?.[1];
      if (table) tableOf.set(block[1], table);
    }
    expect(tableOf.size, "no se pudo leer resources.ts").toBeGreaterThan(50);

    // Pantallas que ofrecen un formulario para un recurso, con los campos que declara.
    const formFields = new Map<string, string>();
    for (const file of sourceFiles(path.join(ROOT, "src/app"))) {
      const src = readFileSync(file, "utf8");
      const resource = /resource="(\w+)"/.exec(src)?.[1];
      if (!resource || !/fields=\{\[/.test(src)) continue;
      formFields.set(resource, (formFields.get(resource) ?? "") + src);
    }

    const broken: string[] = [];
    for (const [resource, table] of tableOf) {
      const columns = REQUIRED_CODE_COLUMNS.get(table);
      if (!columns || !formFields.has(resource)) continue;
      if (table in GENERATED_BY_ACTION) continue;
      const src = formFields.get(resource)!;
      for (const column of columns) {
        // El formulario de alta tiene que declarar el campo, con el nombre de la
        // columna o con el alias con el que viaja.
        if (!new RegExp(`name:\\s*"${column}"`).test(src)) {
          broken.push(`${resource}: el formulario no manda ${table}.${column}, que es not null`);
        }
      }
    }
    expect(broken, "altas que la base va a rechazar por falta del código").toEqual([]);
  });

  it("el verificador de migraciones comprueba cosas que existen", async () => {
    /**
     * `scripts/verify-migrations.mjs` le pregunta a la base REAL si quedó todo
     * tras aplicar las migraciones. Su lista está escrita a mano, así que un
     * nombre mal puesto haría que reportara un fallo inexistente — y hacer
     * dudar de una base que está bien es peor que no comprobarla.
     *
     * Aquí se verifica lo contrario: que cada tabla, columna y valor de enum que
     * el script busca lo haya creado alguna migración.
     */
    const { MIGRATION_CHECKS } = await import("../../scripts/migration-checks.mjs");
    const problems: string[] = [];

    for (const group of MIGRATION_CHECKS as {
      migration: string;
      tables?: string[];
      columns?: [string, string[]][];
      enums?: [string, string, string][];
      rpc?: string[];
    }[]) {
      for (const table of group.tables ?? []) {
        if (!SCHEMA.has(table)) problems.push(`${group.migration}: tabla ${table} no existe`);
      }
      for (const [table, columns] of group.columns ?? []) {
        const known = SCHEMA.get(table);
        if (!known) { problems.push(`${group.migration}: tabla ${table} no existe`); continue; }
        for (const column of columns) {
          if (!known.has(column)) problems.push(`${group.migration}: ${table}.${column} no existe`);
        }
      }
      for (const [table, column, value] of group.enums ?? []) {
        const known = SCHEMA.get(table);
        if (!known?.has(column)) {
          problems.push(`${group.migration}: ${table}.${column} no existe`);
          continue;
        }
        // El valor tiene que estar declarado en algún sitio del SQL: en el enum,
        // en un check, o añadido con `alter type ... add value`.
        if (!new RegExp(`'${value}'`).test(ALL_SQL)) {
          problems.push(`${group.migration}: el valor '${value}' no aparece en ninguna migración`);
        }
      }
      for (const name of group.rpc ?? []) {
        if (!new RegExp(`create or replace function public\\.${name}\\b`, "i").test(ALL_SQL)) {
          problems.push(`${group.migration}: la función public.${name} no se crea en ninguna migración`);
        }
      }
    }

    expect(problems, "el verificador busca cosas que ninguna migración crea").toEqual([]);
  });

  it("cada relación declarada en resources.ts se puede resolver", () => {
    // Un `expand` que no corresponde a ninguna referencia real no fallaba
    // mientras las expansiones se ignoraban: ahora dispara una consulta que la
    // base rechaza. Se valida el camino completo, incluidas las anidadas.
    const src = readFileSync(path.join(SRC, "lib/resources.ts"), "utf8");
    const blocks = new Map<string, string>();
    for (const block of src.matchAll(/^ {2}(\w+):\s*\{\n([\s\S]*?)^ {2}\},/gm)) blocks.set(block[1], block[2]);

    const tableOf = (resource: string) => {
      const body = blocks.get(resource);
      const declared = body ? /table:\s*"(\w+)"/.exec(body)?.[1] : undefined;
      return TABLE_MAP[declared ?? resource] ?? declared ?? resource;
    };

    /** Objeto literal de una clave, con sus llaves equilibradas. */
    const objectAt = (body: string, key: string): string | null => {
      const at = body.indexOf(`${key}: {`);
      if (at < 0) return null;
      const open = body.indexOf("{", at);
      let depth = 0;
      for (let i = open; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}") { depth--; if (depth === 0) return body.slice(open + 1, i); }
      }
      return null;
    };

    const problems: string[] = [];

    function walk(resource: string, spec: string, trail: string, depth: number) {
      if (depth > 3) return;
      const table = tableOf(resource);
      const columns = SCHEMA.get(table);
      if (!columns) { problems.push(`${trail}: tabla ${table} desconocida`); return; }

      for (const part of splitTopLevel(spec, "{[(", "}])")) {
        const key = /^\s*(\w+)\s*:/.exec(part)?.[1];
        if (!key || key.startsWith("_")) continue;

        const here = `${trail}.${key}`;
        if (USER_REF_FIELDS.has(key)) continue;

        const target = TABLE_RELATION_RESOURCE[table]?.[key] || RELATION_RESOURCE[key]
          || (blocks.has(key) ? key : null);
        const column = TABLE_FIELD_ALIASES[table]?.[key] ?? DEFAULT_FIELD_ALIASES[key] ?? `${key}_id`;

        if (columns.has(column)) {
          // Uno-a-uno: la columna existe, pero tiene que apuntar a un recurso.
          if (!target) { problems.push(`${here}: ${table}.${column} existe pero ${key} no es un recurso`); continue; }
        } else if (target) {
          // Uno-a-muchos: la tabla hija tiene que apuntar de vuelta al padre.
          const childTable = tableOf(target);
          const fk = childForeignKey(resource, childTable);
          if (!SCHEMA.get(childTable)?.has(fk)) {
            problems.push(`${here}: ${childTable} no tiene ${fk} para volver a ${resource}`);
            continue;
          }
        } else {
          problems.push(`${here}: no es columna de ${table} ni un recurso conocido`);
          continue;
        }

        const nested = objectAt(spec, key);
        if (nested && target) walk(target, nested, here, depth + 1);
      }
    }

    for (const [resource, body] of blocks) {
      if (VIRTUAL_RESOURCES.has(resource)) continue;
      for (const key of ["expand", "expandOne"]) {
        const spec = objectAt(body, key);
        if (spec) walk(resource, spec, `${resource}.${key}`, 0);
      }
    }

    expect(problems, "resources.ts declara relaciones que no se pueden resolver").toEqual([]);
  });
});

describe("el importador escribe columnas que existen", () => {
  it("cada campo importable es una columna real de su tabla", () => {
    /**
     * El importador resuelve su tabla en ejecución (`resource.table`), así que
     * la guarda de payloads no puede verificarlo leyendo el texto: para ella es
     * una llamada opaca. Esto es lo que SÍ se puede comprobar, y cubre el mismo
     * riesgo: un campo con el nombre mal escrito en `IMPORT_TARGETS` pasaría la
     * validación pura —que solo mira el tipo— y fallaría en la fila 1 de la
     * primera importación de un cliente nuevo, que es el peor momento posible.
     */
    const problems: string[] = [];
    for (const target of IMPORT_TARGETS) {
      for (const field of target.fields) {
        const gap = miss(target.resource, field.name);
        if (gap) problems.push(`${target.key}.${field.name} -> ${gap}`);
      }
      // Y el recurso tiene que aceptar escribirlo: una columna que existe pero
      // que `resources.ts` no declara escribible se descarta en silencio al
      // guardar, y la importación diría «creado» sin ese dato.
      const def = RESOURCES[target.resource];
      if (!def) { problems.push(`${target.key}: recurso ${target.resource} inexistente`); continue; }
      for (const field of target.fields) {
        if (!def.writable.includes(field.name)) {
          problems.push(`${target.key}.${field.name} no es escribible en resources.ts`);
        }
      }
    }
    expect(problems, "el importador declara campos que no se pueden escribir").toEqual([]);
  });
});
