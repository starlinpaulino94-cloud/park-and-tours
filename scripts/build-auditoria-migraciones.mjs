#!/usr/bin/env node
/**
 * Escribe `supabase/editor/auditoria_migraciones_N.sql` a partir del inventario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE ESCRIBE A MANO
 *
 * Ya existe `verify-migrations.mjs`, que pregunta lo mismo a la base — pero
 * necesita la llave de servicio en el entorno, y quien aplica las migraciones a
 * mano lo está haciendo desde el editor SQL de Supabase, donde no hay Node ni
 * variables de entorno. Esto le da la misma respuesta pegando un texto.
 *
 * Y se GENERA porque una copia escrita a mano se queda atrás a la primera
 * migración nueva, y entonces dice «todo aplicado» sin haber mirado lo último
 * — que es justo el verde del que nadie debe fiarse. `schema-contract.test.ts`
 * comprueba que lo que hay en disco es lo que este script produce hoy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EN VARIOS TROZOS
 *
 * El editor de Supabase trunca los pegados largos y no avisa: sale «syntax
 * error at end of input» o, peor, corre la mitad. Seiscientas comprobaciones no
 * caben en uno solo.
 *
 * Uso:  node scripts/build-auditoria-migraciones.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { MIGRATION_CHECKS } from "./migration-checks.mjs";

/**
 * Dónde escribir. Por defecto, su sitio; con un argumento, otro directorio.
 *
 * Ese argumento existe para la PRUEBA que comprueba que lo de disco está al
 * día: si regenerase encima de los ficheros buenos, otra prueba que esté
 * leyéndolos en ese instante vería uno a medio escribir. Pasó una vez, y una
 * prueba que falla una de cada cuatro veces es peor que no tenerla — se acaba
 * volviendo a ejecutar hasta que pasa.
 */
const SALIDA = path.resolve(process.cwd(), process.argv[2] || "supabase/editor");
fs.mkdirSync(SALIDA, { recursive: true });
/** El editor trunca por encima de 8000; se deja margen para la cabecera. */
const TOPE = 6800;

const comilla = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Una fila por objeto que la migración tiene que haber dejado en la base. */
function filasDe(grupo) {
  const filas = [];
  for (const tabla of grupo.tables ?? []) {
    filas.push([grupo.migration, "tabla", tabla, ""]);
  }
  for (const [tabla, columnas] of grupo.columns ?? []) {
    // Las columnas de una tabla viajan juntas en un solo texto: una fila por
    // columna multiplicaría por seis el tamaño del pegado, y el editor lo corta.
    filas.push([grupo.migration, "columnas", tabla, columnas.join(",")]);
  }
  for (const nombre of grupo.rpc ?? []) {
    filas.push([grupo.migration, "funcion", nombre, ""]);
  }
  for (const [tabla, columna, valor] of grupo.enums ?? []) {
    filas.push([grupo.migration, "valor", tabla, `${columna}=${valor}`]);
  }
  return filas;
}

const CABECERA = (n, total) => `-- Auditoría de migraciones · parte ${n} de ${total}
--
-- GENERADO por \`scripts/build-auditoria-migraciones.mjs\`. No lo edites a mano:
-- se regenera y perderías el cambio, y hay una prueba que lo comprueba.
--
-- QUÉ RESPONDE
--   ¿Qué migraciones me faltan por ejecutar?
--
-- Pega este trozo en el editor SQL de Supabase y ejecútalo. Cada fila es una
-- migración: «✅ aplicada» o «❌ FALTA», y en la tercera columna exactamente lo
-- que no encontró. Solo LEE: no escribe, no borra, no consume nada.
--
-- Un «PARCIAL» quiere decir que la migración se aplicó a medias — casi siempre
-- porque el editor truncó el pegado. Se vuelve a ejecutar entera: todas están
-- escritas para poder correrse dos veces.
--
-- Ejecuta las ${total} partes; cada una cubre un tramo distinto.

`;

const PIE = `
),
objetivo as (
  select e.migracion, e.tipo, e.objeto, e.detalle,
         nullif(trim(both from col), '') as columna
    from esperado e
    left join lateral unnest(
           case when e.tipo = 'columnas' then string_to_array(e.detalle, ',')
                else array[null]::text[] end
         ) as col on true
),
falta as (
  select o.migracion,
         case o.tipo
           when 'funcion' then 'función ' || o.objeto || '()'
           when 'valor'   then o.objeto || '.' || o.detalle
           else o.objeto || coalesce('.' || o.columna, '')
         end as que
    from objetivo o
   where case o.tipo
           when 'funcion' then not exists (
             select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = o.objeto)
           -- Un valor admitido: o es una etiqueta de un tipo enum de verdad, o
           -- lo admite una restricción \`check\`. El esquema usa las dos formas,
           -- así que se miran las dos. Darlo por bueno con solo comprobar que
           -- la tabla existe sería una comprobación que parece una garantía y
           -- no lo es.
           when 'valor' then
             not exists (
               select 1
                 from information_schema.columns c
                 join pg_type ty on ty.typname = c.udt_name
                 join pg_enum en on en.enumtypid = ty.oid
                where c.table_schema = 'public' and c.table_name = o.objeto
                  and c.column_name = split_part(o.detalle, '=', 1)
                  and en.enumlabel = split_part(o.detalle, '=', 2))
             and not exists (
               select 1 from pg_constraint k
                where k.conrelid = to_regclass('public.' || o.objeto)
                  and k.contype = 'c'
                  and pg_get_constraintdef(k) like '%' || split_part(o.detalle, '=', 1) || '%'
                  and pg_get_constraintdef(k) like '%''' || split_part(o.detalle, '=', 2) || '''%')
           else not exists (
             select 1 from information_schema.tables t
              where t.table_schema = 'public' and t.table_name = o.objeto)
             or (o.columna is not null and not exists (
             select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = o.objeto
                and c.column_name = o.columna))
         end
),
total as (
  select migracion, count(*) as objetos
    from objetivo group by migracion
),
ausentes as (
  select migracion, count(*) as n,
         string_agg(que, ', ' order by que) as detalle
    from falta group by migracion
)
select t.migracion,
       case when a.n is null then '✅ aplicada'
            when a.n >= t.objetos then '❌ FALTA ENTERA'
            else '⚠️ PARCIAL — vuelve a ejecutarla' end as estado,
       coalesce(a.detalle, '') as lo_que_no_esta
  from total t
  left join ausentes a on a.migracion = t.migracion
 order by t.migracion;
`;

/**
 * EL RESUMEN: un solo pegado que responde la pregunta de cabecera.
 *
 * Por migración se comprueban sus tablas, sus funciones, sus valores y la
 * ÚLTIMA columna que su fichero .sql escribe. Lo último es lo que importa: el
 * modo en que estas migraciones fallan de verdad es que el editor trunque el
 * pegado, y entonces lo que falta es siempre el final. Si el último objeto está,
 * el fichero se ejecutó entero.
 *
 * No sustituye al detalle: una migración que salga en rojo aquí se mira en las
 * partes, que sí dicen columna por columna qué falta.
 */
function ultimoObjetoDe(grupo, textoSql) {
  const candidatos = [];
  for (const [tabla, columnas] of grupo.columns ?? []) {
    for (const col of columnas) candidatos.push([tabla, col]);
  }
  if (candidatos.length === 0) return null;
  // Por posición en el fichero, que en un script lineal ES el orden de
  // ejecución. Sin fichero —no debería pasar— se queda el último declarado.
  if (!textoSql) return candidatos[candidatos.length - 1];
  let mejor = candidatos[candidatos.length - 1];
  let mejorPos = -1;
  for (const [tabla, col] of candidatos) {
    const pos = textoSql.lastIndexOf(col);
    if (pos > mejorPos) { mejorPos = pos; mejor = [tabla, col]; }
  }
  return mejor;
}

const MIGRACIONES_DIR = path.resolve(process.cwd(), "supabase/migrations");
const ficheros = fs.readdirSync(MIGRACIONES_DIR).filter((f) => f.endsWith(".sql"));
function sqlDe(migration) {
  // El inventario nombra «0034/0035 — …»: vale el primero de los dos.
  const numero = /^(\d{4})/.exec(migration)?.[1];
  const archivo = numero && ficheros.find((f) => f.startsWith(`${numero}_`));
  return archivo ? fs.readFileSync(path.join(MIGRACIONES_DIR, archivo), "utf8") : null;
}

// ── el reparto en trozos ─────────────────────────────────────────────────────
// Se corta POR MIGRACIÓN y nunca por dentro de una: media migración en un trozo
// y media en otro daría dos veredictos distintos sobre la misma, y los dos
// equivocados.
const grupos = [...MIGRATION_CHECKS].sort((a, b) => a.migration.localeCompare(b.migration));
const trozos = [];
let actual = [];
let tamano = 0;
for (const grupo of grupos) {
  const filas = filasDe(grupo).map(
    ([m, tipo, objeto, detalle]) =>
      `  (${comilla(m)}, ${comilla(tipo)}, ${comilla(objeto)}, ${comilla(detalle)})`
  );
  const texto = filas.join(",\n");
  if (actual.length > 0 && tamano + texto.length > TOPE - PIE.length) {
    trozos.push(actual);
    actual = [];
    tamano = 0;
  }
  actual.push(texto);
  tamano += texto.length + 2;
}
if (actual.length > 0) trozos.push(actual);

for (const archivo of fs.readdirSync(SALIDA)) {
  if (/^auditoria_migraciones_\d+\.sql$/.test(archivo)) fs.unlinkSync(path.join(SALIDA, archivo));
}
trozos.forEach((trozo, i) => {
  const sql =
    CABECERA(i + 1, trozos.length) +
    "with esperado(migracion, tipo, objeto, detalle) as (values\n" +
    trozo.join(",\n") +
    PIE;
  const destino = path.join(SALIDA, `auditoria_migraciones_${i + 1}.sql`);
  fs.writeFileSync(destino, sql);
  console.log(`${path.relative(process.cwd(), destino)} — ${sql.length} bytes`);
});

// ── el resumen, en un solo fichero ───────────────────────────────────────────
const filasResumen = [];
for (const grupo of grupos) {
  /**
   * La clave es el NÚMERO a secas y no el nombre entero: el nombre se repite en
   * cada fila y son cien filas, y el pegado se pasaría del tope del editor. Lo
   * que hace falta aquí es saber CUÁL falta; el nombre está en las partes.
   *
   * Los valores de enum tampoco entran en el resumen — las migraciones que los
   * añaden traen además tablas o columnas, así que siguen cubiertas, y el
   * detalle sí los mira.
   */
  const clave = /^[\d/]+/.exec(grupo.migration)?.[0] ?? grupo.migration;
  for (const tabla of grupo.tables ?? []) filasResumen.push([clave, "tabla", tabla, ""]);
  for (const nombre of grupo.rpc ?? []) filasResumen.push([clave, "funcion", nombre, ""]);
  const ultimo = ultimoObjetoDe(grupo, sqlDe(grupo.migration));
  if (ultimo) filasResumen.push([clave, "columnas", ultimo[0], ultimo[1]]);
}

const PIE_RESUMEN = `
),
objetivo as (
  select e.migracion, e.tipo, e.objeto,
         nullif(trim(both from col), '') as columna
    from esperado e
    left join lateral unnest(
           case when e.tipo = 'columnas' then string_to_array(e.detalle, ',')
                else array[null]::text[] end
         ) as col on true
),
falta as (
  select o.migracion,
         case when o.tipo = 'funcion' then 'función ' || o.objeto || '()'
              else o.objeto || coalesce('.' || o.columna, '') end as que
    from objetivo o
   where case when o.tipo = 'funcion' then not exists (
             select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = o.objeto)
         else not exists (
             select 1 from information_schema.tables t
              where t.table_schema = 'public' and t.table_name = o.objeto)
             or (o.columna is not null and not exists (
             select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = o.objeto
                and c.column_name = o.columna))
         end
),
total as (select migracion, count(*) as objetos from objetivo group by migracion),
ausentes as (
  select migracion, count(*) as n, string_agg(que, ', ' order by que) as detalle
    from falta group by migracion
)
select t.migracion,
       case when a.n is null then '✅ aplicada'
            when a.n >= t.objetos then '❌ FALTA ENTERA'
            else '⚠️ A MEDIAS — vuelve a ejecutarla' end as estado,
       coalesce(a.detalle, '') as lo_que_no_esta
  from total t
  left join ausentes a on a.migracion = t.migracion
 order by t.migracion;
`;

const CABECERA_RESUMEN = `-- ¿Qué migraciones me faltan por ejecutar?
--
-- GENERADO por \`scripts/build-auditoria-migraciones.mjs\`. No lo edites a mano.
--
-- UN SOLO PEGADO. Pégalo en el editor SQL de Supabase y ejecútalo: cada fila es
-- una migración, con «✅ aplicada» o «❌ FALTA». Solo LEE.
--
-- QUÉ COMPRUEBA, Y POR QUÉ ESO BASTA
--   De cada migración: las tablas y funciones que crea, y la ÚLTIMA columna que
--   su fichero escribe. Lo último es lo que importa, porque la forma en que
--   estas migraciones fallan de verdad es que el editor trunque el pegado — y
--   entonces lo que falta es siempre el final.
--
-- QUÉ NO COMPRUEBA
--   Columna por columna, ni los valores nuevos de un enum. Para eso están las
--   partes \`auditoria_migraciones_N.sql\`, que lo miran todo y dicen
--   exactamente qué falta. Míralas si una sale en rojo, o antes de desplegar.

`;

fs.writeFileSync(
  path.join(SALIDA, "auditoria_migraciones.sql"),
  CABECERA_RESUMEN +
    "with esperado(migracion, tipo, objeto, detalle) as (values\n" +
    filasResumen
      .map(([m, tipo, objeto, detalle]) =>
        `  (${comilla(m)}, ${comilla(tipo)}, ${comilla(objeto)}, ${comilla(detalle)})`)
      .join(",\n") +
    PIE_RESUMEN
);
console.log(
  `supabase/editor/auditoria_migraciones.sql — ` +
  `${fs.readFileSync(path.join(SALIDA, "auditoria_migraciones.sql"), "utf8").length} bytes (resumen)`
);
