#!/usr/bin/env node
/**
 * Saca los bloques SQL de un documento para que el CI los EJECUTE.
 *
 * `docs/operaciones/DESDE_EL_EDITOR_SQL.md` se le entrega a alguien que no
 * puede entrar al sistema, para que lo pegue en el editor de Supabase. Se usa
 * el peor día, por quien menos margen tiene, y contra producción. Que además
 * esté desactualizado no es un riesgo hipotético: ya pasó una vez que se pegó
 * el fichero equivocado y lo único que salió fue un error de sintaxis.
 *
 * Así que los bloques se ejecutan de verdad en `scripts/db-test.sh`, contra un
 * Postgres con todas las migraciones. Un `\set` colado, una columna renombrada
 * o una tabla que cambia de nombre rompen el CI en vez de romperle el día a
 * alguien.
 *
 * Los correos y los slugs de los ejemplos no existen, así que las escrituras
 * afectan a cero filas: lo que se comprueba es que TODAS analizan y encajan con
 * el esquema.
 *
 * Un bloque con `ci:skip` en su primera línea se salta, y el motivo va escrito
 * ahí mismo. Es para lo que depende de Supabase y no de Postgres.
 *
 *   node scripts/extract-doc-sql.mjs <fichero.md>   → SQL por la salida estándar
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("uso: extract-doc-sql.mjs <fichero.md>"); process.exit(1); }

const md = fs.readFileSync(file, "utf8");
const bloques = [...md.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);

if (!bloques.length) {
  console.error(`✗ ${file} no tiene ningún bloque sql marcado. ¿Se renombró el documento?`);
  process.exit(1);
}

const salida = [];
let saltados = 0;
for (const [i, bloque] of bloques.entries()) {
  if (/^\s*--\s*ci:skip/m.test(bloque.split("\n").slice(0, 2).join("\n"))) { saltados++; continue; }

  /**
   * Una orden de `psql` en un documento que se pega en el editor de Supabase es
   * EL defecto, no un detalle de formato: el editor contesta
   * `syntax error at or near "\"` y quien lo pegó se queda sin diagnóstico.
   */
  const meta = bloque.split("\n").find((l) => /^\s*\\[a-z]/.test(l));
  if (meta) {
    console.error(`✗ ${file}, bloque ${i + 1}: orden de psql que el editor de Supabase no entiende:\n    ${meta.trim()}`);
    process.exit(1);
  }

  salida.push(`-- ── ${file} · bloque ${i + 1} ──`, bloque.trimEnd(), "");
}

console.error(`  ${bloques.length - saltados} bloques extraídos${saltados ? `, ${saltados} saltados (ci:skip)` : ""}`);
process.stdout.write(salida.join("\n") + "\n");
