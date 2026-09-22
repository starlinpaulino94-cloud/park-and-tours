import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * LAS COPIAS PARA EL EDITOR DE SUPABASE NO PUEDEN MENTIR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTEN ESAS COPIAS
 *
 * El editor SQL de Supabase no es psql. Trunca los pegados largos, añade por su
 * cuenta un `enable row level security` cuando ve un `create table` —y si eso
 * cae dentro de un bloque `$$` revienta— y no enseña nada útil cuando una
 * comprobación no falla. Así que las migraciones que hay que aplicar a mano van
 * partidas en trozos pensados para ese editor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL RIESGO QUE ESTO CIERRA
 *
 * Una copia es una copia: el día que alguien toque la migración, la copia se
 * queda atrás y pasa a ser una instrucción EQUIVOCADA que alguien pegará en su
 * base de producción creyendo que es la buena. Aquí se comprueba que el cuerpo
 * de la función es el MISMO en las dos, carácter a carácter salvo la etiqueta
 * del dólar.
 */

const MIGRACIONES = "supabase/migrations";
const EDITOR = "supabase/editor";

/**
 * El SQL sin sus comentarios.
 *
 * Hace falta porque los comentarios de estas copias EXPLICAN el problema del
 * editor, y para explicarlo escriben `$$` y «create table». Sin quitarlos, la
 * guarda se dispara con la explicación en vez de con el código.
 */
function sinComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** El cuerpo entre etiquetas de dólar, normalizado para poder compararlo. */
function cuerpoDeFuncion(sql: string): string | null {
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$\s*;/.exec(sql);
  if (!m) return null;
  return m[2].replace(/\r\n/g, "\n").trim();
}

describe("las copias para el editor de Supabase", () => {
  it("dicen lo mismo que su migración", () => {
    const partes = existsSync(EDITOR)
      ? readdirSync(EDITOR).filter((f) => f.endsWith(".sql"))
      : [];
    expect(partes.length, "no hay copias para el editor").toBeGreaterThan(0);

    // Cada copia se llama 00NN_… y tiene que corresponder a una migración real.
    const huerfanas: string[] = [];
    const numeros = new Set<string>();
    for (const parte of partes) {
      const n = /^(\d{4})_/.exec(parte)?.[1];
      if (!n) { huerfanas.push(`${parte}: el nombre no empieza por el número de migración`); continue; }
      numeros.add(n);
      const migracion = readdirSync(MIGRACIONES).find((f) => f.startsWith(`${n}_`));
      if (!migracion) huerfanas.push(`${parte}: no existe la migración ${n}`);
    }
    expect(huerfanas, "copias sin migración detrás").toEqual([]);

    // Y el cuerpo de la función tiene que ser idéntico.
    const divergentes: string[] = [];
    for (const n of numeros) {
      const migracion = readdirSync(MIGRACIONES).find((f) => f.startsWith(`${n}_`))!;
      const esperado = cuerpoDeFuncion(readFileSync(`${MIGRACIONES}/${migracion}`, "utf8"));
      if (!esperado) continue; // esa migración no define ninguna función

      const enElEditor = partes
        .filter((f) => f.startsWith(`${n}_`))
        .map((f) => cuerpoDeFuncion(readFileSync(`${EDITOR}/${f}`, "utf8")))
        .filter(Boolean) as string[];

      if (enElEditor.length === 0) {
        divergentes.push(`${n}: la migración define una función y ninguna copia la trae`);
      } else if (!enElEditor.some((c) => c === esperado)) {
        divergentes.push(`${n}: el cuerpo de la función ya no coincide con la migración`);
      }
    }
    expect(divergentes, "copias que se quedaron atrás").toEqual([]);
  });

  it("no llevan nada que el editor de Supabase no trague", () => {
    /**
     * Las tres cosas aprendidas a base de que fallara:
     *  · `\set` y demás órdenes de psql: el editor no las entiende.
     *  · Tablas temporales: la conexión es agrupada y se pierden entre
     *    sentencias.
     *  · Pegados largos: se truncan y sale «syntax error at end of input».
     */
    const problemas: string[] = [];
    for (const parte of readdirSync(EDITOR).filter((f) => f.endsWith(".sql"))) {
      const bruto = readFileSync(`${EDITOR}/${parte}`, "utf8");
      const sql = sinComentarios(bruto);
      if (/^\s*\\/m.test(sql)) problemas.push(`${parte}: lleva órdenes de psql (\\…)`);
      if (/\bcreate\s+temp(orary)?\s+table\b/i.test(sql)) problemas.push(`${parte}: usa tablas temporales`);
      // El tamaño se mide sobre el archivo ENTERO: los comentarios también se
      // pegan, y también cuentan para el truncado.
      if (bruto.length > 8000) problemas.push(`${parte}: ${bruto.length} bytes, el editor lo truncaría`);
      // Un `create table` y un bloque $$ en el MISMO trozo es la combinación que
      // hace que el editor inyecte su `enable row level security` dentro del
      // bloque y reviente con «unterminated dollar-quoted string».
      if (/\bcreate\s+table\b/i.test(sql) && /\$\w*\$/.test(sql)) {
        problemas.push(`${parte}: mezcla un create table con un bloque $$`);
      }
    }
    expect(problemas, "copias que el editor de Supabase no podría correr").toEqual([]);
  });

  it("traen una verificación que se LEE, no un bloque mudo", () => {
    /**
     * Un bloque de comprobación que no falla deja «Success. No rows returned»,
     * que no distingue «funcionó» de «no se comprobó nada». La verificación
     * tiene que devolver filas que se puedan leer una a una.
     */
    const verificaciones = readdirSync(EDITOR).filter((f) => /verificacion/.test(f));
    expect(verificaciones.length, "ninguna copia trae verificación").toBeGreaterThan(0);
    for (const v of verificaciones) {
      const sql = sinComentarios(readFileSync(`${EDITOR}/${v}`, "utf8"));
      expect(sql, `${v}: la verificación tiene que ser un select`).toMatch(/^\s*(with|select)\b/mi);
      expect(sql, `${v}: sin bloques do $$, que no enseñan nada en el editor`).not.toMatch(/\bdo\s+\$/i);
      expect(sql, `${v}: cada fila tiene que decir si falta algo`).toMatch(/FALTA/);
    }
  });
});
