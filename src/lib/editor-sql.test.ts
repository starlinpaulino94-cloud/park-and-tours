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

  it("registran los MISMOS disparadores que su migración", () => {
    /**
     * ────────────────────────────────────────────────────────────────────────
     * LA REGLA DE ARRIBA NO CUBRE UNA MIGRACIÓN SIN FUNCIÓN
     *
     * `cuerpoDeFuncion` compara el cuerpo entre `$$`, así que una migración que
     * solo registra disparadores —0102— pasaba por la regla sin que nada
     * comparase nada: `continue`. Y una copia de disparadores es exactamente
     * igual de peligrosa cuando envejece, porque el disparador se identifica
     * por NOMBRE y pegar uno con menos columnas QUITA las que ya había.
     *
     * Se comparan las sentencias `create trigger … enforce_same_tenant_refs(…)`
     * de las dos partes, normalizadas: mismo conjunto, en los dos sentidos.
     */
    const disparadores = (sql: string) => {
      const re =
        /create\s+trigger\s+\w+\s+before\s+insert\s+or\s+update\s+of\s+[^;]*?\s+on\s+\w+\s+for\s+each\s+row\s+execute\s+function\s+app\.enforce_same_tenant_refs\s*\([^;]*?\)\s*;/gi;
      return new Set(
        [...sinComentarios(sql).matchAll(re)].map((m) => m[0].replace(/\s+/g, " ").trim().toLowerCase())
      );
    };

    const partes = readdirSync(EDITOR).filter((f) => f.endsWith(".sql"));
    const divergentes: string[] = [];
    const encontrados = new Map<string, number>();
    for (const n of new Set(partes.filter((f) => /^\d{4}_/.test(f)).map((f) => f.slice(0, 4)))) {
      const migracion = readdirSync(MIGRACIONES).find((f) => f.startsWith(`${n}_`))!;
      const enLaMigracion = disparadores(readFileSync(`${MIGRACIONES}/${migracion}`, "utf8"));
      if (enLaMigracion.size === 0) continue; // esa migración no registra disparadores

      const enElEditor = disparadores(
        partes.filter((f) => f.startsWith(`${n}_`))
          .map((f) => readFileSync(`${EDITOR}/${f}`, "utf8")).join("\n")
      );
      for (const d of enLaMigracion) {
        if (!enElEditor.has(d)) divergentes.push(`${n}: la copia no trae · ${d.slice(0, 90)}…`);
      }
      for (const d of enElEditor) {
        if (!enLaMigracion.has(d)) divergentes.push(`${n}: la copia trae de más · ${d.slice(0, 90)}…`);
      }
      // Y que se hayan encontrado: una expresión regular rota daría dos
      // conjuntos vacíos y esta comprobación pasaría por no mirar nada.
      expect(enElEditor.size, `${n}: la copia no registra ningún disparador`).toBe(enLaMigracion.size);
      encontrados.set(n, enLaMigracion.size);
    }
    expect(divergentes, "copias de disparadores que se quedaron atrás").toEqual([]);
    /**
     * Y QUE SE HAYA MIRADO ALGO.
     *
     * Con la expresión regular rota los dos conjuntos salen vacíos, el `continue`
     * de arriba se lleva la migración entera y la comprobación pasa sin comparar
     * nada. Sobrevivió a la mutación. 0102 registra 25 disparadores y su copia
     * tiene que traer los 25: si ese número deja de salir, lo que falló es la
     * guarda, no la copia.
     */
    expect(encontrados.get("0102"), "0102 dejó de comparar sus 25 disparadores").toBe(25);
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

/**
 * LAS COPIAS DEL SEMBRADOR TAMPOCO PUEDEN ENVEJECER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES EL MISMO RIESGO QUE CON LAS MIGRACIONES, CON PEOR FINAL
 *
 * Arriba se sujeta que la copia de una función en `supabase/editor` diga lo
 * mismo que su migración. Los trozos del sembrador de demostración se copian
 * igual —el editor trunca el pegado grande, así que van partidos— y hasta ahora
 * nada comprobaba que dijeran lo mismo que el trozo del que salieron.
 *
 * El que se ejecuta en CI es el del sembrador. El que se PEGA es el de
 * `editor/`. Es decir: el que nadie comprueba es justamente el que alguien va a
 * correr contra su base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE COMPARAN LAS SENTENCIAS, NO EL TEXTO
 *
 * Los comentarios son distintos a propósito: el trozo explica el hueco que
 * llena y la copia explica cómo pegarla. Lo que no puede diferir es el SQL.
 */
describe("las copias del sembrador dicen lo mismo que el sembrador", () => {
  /** El SQL desnudo: sin comentarios y con los espacios normalizados. */
  const sentencias = (ruta: string) =>
    readFileSync(ruta, "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

  const COPIAS: { trozo: string; partes: string[] }[] = [
    { trozo: "demo_14.sql", partes: ["demo_socios_1.sql", "demo_socios_2.sql"] },
    { trozo: "demo_15.sql", partes: ["demo_embudo_1.sql", "demo_embudo_2.sql"] },
  ];

  it.each(COPIAS)("$trozo y sus partes de editor", ({ trozo, partes }) => {
    const origen = sentencias(`supabase/seed/demo_partes/${trozo}`);
    const copia = partes.map((p) => sentencias(`${EDITOR}/${p}`)).join(" ");
    expect(copia, `${partes.join(" + ")} ya no dice lo mismo que ${trozo}`).toBe(origen);
  });

  it("y ninguna parte pasa del tope que el editor traga", () => {
    // Medido: el editor de Supabase ya falló con un pegado de 7,3 kB. Se deja
    // el tope en 8 kB porque por debajo de eso no ha fallado nunca.
    for (const { partes } of COPIAS) {
      for (const p of partes) {
        const bytes = Buffer.byteLength(readFileSync(`${EDITOR}/${p}`, "utf8"));
        expect(bytes, `${p}: ${bytes} bytes, demasiado para un pegado`).toBeLessThanOrEqual(8000);
      }
    }
  });
});
