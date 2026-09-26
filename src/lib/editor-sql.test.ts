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

/** El cuerpo entre etiquetas de dólar, normalizado para poder comparelo. */
function cuerpoDeFuncion(sql: string): string | null {
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$\s*;/.exec(sql);
  if (!m) return null;
  return m[2].replace(/\r\n/g, "\n").trim();
}

/**
 * LA FUNCIÓN QUE NO CABE EN UN PEGADO.
 *
 * `create or replace function` es indivisible, y `dashboard_summary` son 20 kB.
 * El editor trunca mucho antes —ya falló a los 7,3 kB—, así que esa copia deja
 * el texto en una tabla auxiliar, trozo a trozo, y la última parte lo ejecuta.
 *
 * Partir la copia no puede aflojar la garantía: lo que se compara entonces es
 * la CONCATENACIÓN de los trozos, en orden, que es exactamente lo que la base
 * va a ejecutar. Si alguien retoca un trozo, deja de coincidir igual que antes.
 */
function cuerpoMontadoPorTrozos(partes: { nombre: string; sql: string }[]): string | null {
  const trozos: { n: number; txt: string }[] = [];
  for (const { sql } of partes) {
    const m = /insert\s+into\s+app\.editor_sql_\w+\s*\(n,\s*txt\)\s*values\s*\((\d+),\s*\$trozo\$([\s\S]*?)\$trozo\$\)/.exec(sql);
    if (m) trozos.push({ n: Number(m[1]), txt: m[2] });
  }
  if (trozos.length === 0) return null;
  trozos.sort((a, b) => a.n - b.n);
  // Los números tienen que ser 1..N sin huecos: un trozo perdido montaría media
  // función sin que nadie lo notara hasta ejecutarla.
  if (trozos.some((t, i) => t.n !== i + 1)) return null;
  return cuerpoDeFuncion(trozos.map((t) => t.txt).join(""));
}

describe("las copias para el editor de Supabase", () => {
  it("dicen lo mismo que su migración", () => {
    const partes = existsSync(EDITOR)
      ? readdirSync(EDITOR).filter((f) => f.endsWith(".sql"))
      : [];
    expect(partes.length, "no hay copias para el editor").toBeGreaterThan(0);

    /**
     * Aquí viven dos cosas distintas, y la regla no es la misma para las dos:
     *
     *  · Las COPIAS de una migración (`00NN_…`), que tienen que decir
     *    exactamente lo mismo que ella.
     *  · Los scripts de MANTENIMIENTO (`limpieza_…`), que no copian nada: hacen
     *    un trabajo puntual contra una base que ya existe.
     *
     * Exigirle una migración detrás a un script de limpieza sería pedirle que
     * sea lo que no es. Lo que SÍ comparten —y se comprueba abajo para todos—
     * es tener que pasar por el editor de Supabase sin romperse.
     */
    const copias = partes.filter((f) => /^\d{4}_/.test(f));
    const mantenimiento = partes.filter((f) => !/^\d{4}_/.test(f));

    const sinNombreClaro = mantenimiento.filter((f) => !/^[a-z][a-z0-9_]*\.sql$/.test(f));
    expect(sinNombreClaro, "scripts con nombres que no dicen qué hacen").toEqual([]);

    const huerfanas: string[] = [];
    const numeros = new Set<string>();
    for (const parte of copias) {
      const n = /^(\d{4})_/.exec(parte)![1];
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

      const suyas = partes
        .filter((f) => f.startsWith(`${n}_`))
        .map((f) => ({ nombre: f, sql: readFileSync(`${EDITOR}/${f}`, "utf8") }));
      const enElEditor = [
        ...suyas.map((x) => cuerpoDeFuncion(x.sql)),
        cuerpoMontadoPorTrozos(suyas),
      ].filter(Boolean) as string[];

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
      // Tiene que poder decir que algo va MAL, con la palabra que toque según
      // lo que verifique: una migración que no se aplicó «FALTA»; una empresa
      // que debía irse «SIGUE AHÍ». Una verificación cuyas filas solo saben
      // decir OK no es una verificación.
      expect(sql, `${v}: ninguna fila sabe decir que algo va mal`)
        .toMatch(/FALTA|SIGUE AHÍ|HAY |NO se|no deberia/);
    }
  });
});
