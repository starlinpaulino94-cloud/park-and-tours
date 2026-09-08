import { describe, it, expect, vi } from "vitest";

// `expand.ts` arrastra el proveedor de datos al importarse; aquí solo se
// necesitan sus mapas de relaciones.
vi.mock("@/lib/supabase/data-provider", () => ({ spQuery: vi.fn() }));
vi.mock("@/lib/user-directory", () => ({ resolveUserNames: vi.fn() }));
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_FIELD_ALIASES, TABLE_FIELD_ALIASES } from "@/lib/supabase/query-translator";
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
    }
    expect(problems, "columna booleana tratada como texto yes/no").toEqual([]);
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
