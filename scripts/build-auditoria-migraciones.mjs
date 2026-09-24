#!/usr/bin/env node
/**
 * Escribe `supabase/editor/auditoria_migraciones*.sql` a partir del inventario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ
 *
 * Responde «¿qué migraciones me faltan por ejecutar?» desde el editor SQL de
 * Supabase. `verify-migrations.mjs` responde lo mismo, pero necesita la llave
 * de servicio en el entorno — y quien aplica las migraciones a mano lo hace
 * desde el editor, donde no hay Node ni variables de entorno.
 *
 * Se GENERA porque una copia escrita a mano se queda atrás a la primera
 * migración nueva, y entonces dice «todo aplicado» sin haber mirado lo último.
 * `schema-contract.test.ts` comprueba que lo de disco es lo que esto produce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES COSAS APRENDIDAS A BASE DE QUE FALLARA EN EL EDITOR
 *
 *  1. LA CONSULTA VA PRIMERO y la explicación detrás del punto y coma final.
 *     La primera vez que esto falló, lo que había llegado al editor era solo la
 *     cabecera de comentarios: «syntax error at end of input», línea 0, que no
 *     se parece en nada a la causa. Con el orden al revés, un pegado a medias
 *     todavía trae la consulta.
 *  2. CORTO. El tope real del editor está por debajo de lo que parecía, así que
 *     cada trozo se aprieta y la consulta se escribió con lo justo.
 *  3. NADA DE EMOJI. `⚠️` lleva detrás un selector de variación (U+FE0F) que
 *     algunos portapapeles parten por la mitad, y entonces lo que se pega ya no
 *     es lo que se copió. Los estados se dicen con palabras.
 *
 * Uso:  node scripts/build-auditoria-migraciones.mjs [directorio]
 */
import fs from "node:fs";
import path from "node:path";
import { MIGRATION_CHECKS } from "./migration-checks.mjs";

/**
 * Dónde escribir. Por defecto su sitio; con un argumento, otro directorio.
 *
 * Ese argumento existe para la prueba que comprueba que lo de disco está al
 * día: regenerando encima de los ficheros buenos, otra prueba que los esté
 * leyendo en ese instante ve uno a medio escribir. Pasó, y una prueba que falla
 * una de cada cuatro veces se acaba volviendo a ejecutar hasta que pasa.
 */
const SALIDA = path.resolve(process.cwd(), process.argv[2] || "supabase/editor");
fs.mkdirSync(SALIDA, { recursive: true });

/** Bytes de comprobaciones por trozo, con margen de sobra. */
const TOPE = 3000;

const MIGRACIONES_DIR = path.resolve(process.cwd(), "supabase/migrations");
const ficheros = fs.readdirSync(MIGRACIONES_DIR).filter((f) => f.endsWith(".sql"));
const comilla = (s) => `'${String(s).replace(/'/g, "''")}'`;
const numeroDe = (migration) => /^[\d/]+/.exec(migration)?.[0] ?? migration;

function sqlDe(migration) {
  // El inventario nombra «0034/0035 — …»: vale el primero de los dos.
  const numero = /^(\d{4})/.exec(migration)?.[1];
  const archivo = numero && ficheros.find((f) => f.startsWith(`${numero}_`));
  return archivo ? fs.readFileSync(path.join(MIGRACIONES_DIR, archivo), "utf8") : null;
}

/**
 * La ÚLTIMA columna que el fichero de la migración escribe.
 *
 * Es lo que el resumen comprueba: estas migraciones fallan porque el editor
 * trunca el pegado, y entonces lo que falta es el final. Por posición en el
 * texto, que en un script lineal es el orden de ejecución.
 */
function ultimaColumnaDe(grupo) {
  const candidatos = [];
  for (const [tabla, columnas] of grupo.columns ?? []) {
    for (const col of columnas) candidatos.push([tabla, col]);
  }
  if (candidatos.length === 0) return null;
  const texto = sqlDe(grupo.migration);
  if (!texto) return candidatos[candidatos.length - 1];
  let mejor = candidatos[candidatos.length - 1];
  let mejorPos = -1;
  for (const [tabla, col] of candidatos) {
    const pos = texto.lastIndexOf(col);
    if (pos > mejorPos) { mejorPos = pos; mejor = [tabla, col]; }
  }
  return mejor;
}

const grupos = [...MIGRATION_CHECKS].sort((a, b) => a.migration.localeCompare(b.migration));

/* ═══════════════════════════════════ el resumen: un solo pegado */

/**
 * El resumen NO distingue «falta entera» de «a medias».
 *
 * Con una o dos comprobaciones por migración esa distinción no diría nada, y el
 * agregado que hace falta para calcularla ocupa más que todas las
 * comprobaciones juntas. Quien necesite el detalle tiene las partes.
 */
const resumen = [];
const sinComprobacion = new Set();
for (const grupo of grupos) {
  const mig = numeroDe(grupo.migration);
  const conColumnas = new Set((grupo.columns ?? []).map(([t]) => t));
  const antes = resumen.length;
  for (const tabla of grupo.tables ?? []) {
    if (!conColumnas.has(tabla)) resumen.push(`  (${comilla(mig)},${comilla(tabla)},'')`);
  }
  const ultima = ultimaColumnaDe(grupo);
  if (ultima) resumen.push(`  (${comilla(mig)},${comilla(ultima[0])},${comilla(ultima[1])})`);
  /**
   * Una migración que no deja tabla ni columna —solo cambia una función o una
   * política— NO se calla: sale con su fila diciendo que aquí no se puede
   * comprobar. Omitirla haría que «no aparece» se leyera como «nada que hacer»,
   * que es justo lo contrario de lo que pasa.
   */
  if (resumen.length === antes) {
    resumen.push(`  (${comilla(mig)},'','')`);
    sinComprobacion.add(mig);
  }
}

/**
 * Y las migraciones que el inventario ni siquiera nombra: las que solo tocan
 * funciones o políticas. Van en el pie, para que quien lea el resultado sepa
 * que esas hay que mirarlas a mano y no dé por hecho que están.
 */
const numerosInventariados = new Set(grupos.flatMap((g) => numeroDe(g.migration).split("/")));
const fueraDelInventario = ficheros
  .map((f) => f.slice(0, 4))
  .filter((n) => Number(n) >= 21 && !numerosInventariados.has(n))
  .sort();

fs.writeFileSync(
  path.join(SALIDA, "auditoria_migraciones.sql"),
  `-- Que migraciones me faltan por ejecutar. GENERADO: no lo edites a mano.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee, no escribe nada.

with e(mig,obj,col) as (values
${resumen.join(",\n")}
)
select e.mig as migracion,
       case when to_regclass('public.' || e.obj) is null
              then 'FALTA - no existe ' || e.obj
            when e.obj = '' then 'SIN COMPROBACION AUTOMATICA - mirala a mano'
            when e.col <> '' and not exists (
              select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = e.obj
                 and c.column_name = e.col)
              then 'FALTA - ' || e.obj || ' sin ' || e.col
            else 'OK' end as estado
  from e order by 1, 2;

-- Si el pegado llego entero, la linea de arriba termina en "order by 1, 2;".
--
-- Comprueba, de cada migracion, la ULTIMA columna que su fichero escribe (y
-- las tablas que no declaran columnas). Lo ultimo es lo que importa: estas
-- migraciones fallan porque el editor trunca el pegado, y entonces lo que
-- falta es siempre el final.
--
-- CUIDADO CON EL "OK" DE LAS MIGRACIONES DE VARIOS TROZOS. De 0077 en
-- adelante lo que cada una aporta son funciones y disparadores, y van al final
-- del fichero: esta consulta mira una columna que crea la PRIMERA linea, asi
-- que dice OK aunque solo se ejecutara el primer trozo. Para eso estan
-- auditoria_funciones_N.sql, que miran lo ultimo de verdad.
--
-- "SIN COMPROBACION AUTOMATICA": esa migracion no deja tabla ni columna, solo
-- cambia una funcion o una politica. Se mira con su propio fichero de
-- verificacion en supabase/editor/.
--
-- Y estas migraciones no salen arriba por lo mismo, no hay nada que preguntar
-- por catalogo de tablas: ${fueraDelInventario.join(", ") || "ninguna"}
--
-- Para el detalle columna por columna: auditoria_migraciones_N.sql
`
);

/**
 * Reparte filas en trozos que quepan en el editor, cortando SIEMPRE entre
 * migraciones: media migración en un trozo y media en otro daría dos
 * veredictos sobre la misma, y los dos equivocados.
 */
function trocear(filas, tope) {
  const trozos = [];
  let actual = [];
  let tamano = 0;
  let migActual = null;
  for (const fila of filas) {
    const mig = /^ {2}\('([^']+)'/.exec(fila)?.[1] ?? "";
    if (actual.length > 0 && tamano > tope && mig !== migActual) {
      trozos.push(actual);
      actual = [];
      tamano = 0;
    }
    actual.push(fila);
    tamano += fila.length + 2;
    migActual = mig;
  }
  if (actual.length > 0) trozos.push(actual);
  return trozos;
}

/* ═══════════════════════════════════ funciones y disparadores */

/**
 * LO QUE EL INVENTARIO DE COLUMNAS NO PUEDE VER, Y ES LA MITAD DE LO QUE FALLA.
 *
 * `migration-checks.mjs` sirve a `verify-migrations.mjs`, que habla por
 * PostgREST y no ve los catálogos: por eso solo declara tablas y columnas. Pero
 * de 0077 en adelante lo que cada migración aporta son FUNCIONES Y
 * DISPARADORES, y van al FINAL del fichero.
 *
 * Eso convierte el resumen en una trampa: comprueba que la columna exista —la
 * crea la primera línea— y da «OK» a una migración de la que solo se ejecutó el
 * primer trozo. Aquí se mira lo último de verdad.
 *
 * Y se lee de los propios ficheros de migración, no de una lista a mano: una
 * lista a mano se queda atrás a la primera migración nueva, que es justo lo que
 * esto existe para evitar.
 */
const definidoEn = new Map();   // nombre -> primera migración que lo define
const objetosPorMigracion = [];
for (const archivo of [...ficheros].sort()) {
  const numero = archivo.slice(0, 4);
  /**
   * Se leen TODAS, también las anteriores a la 0021, para saber quién define
   * cada cosa por primera vez. Saltándoselas, `app.can_read_partner` parecía
   * nacer en 0072 —que solo la reemplaza— y ver la función habría dado por
   * ejecutada una migración que igual no se ejecutó.
   */
  const texto = fs.readFileSync(path.join(MIGRACIONES_DIR, archivo), "utf8")
    .replace(/^\s*--.*$/gm, "");
  const encontrados = [];
  for (const m of texto.matchAll(/^create (?:or replace )?function\s+([a-z_]+)\.([a-z_0-9]+)/gm)) {
    encontrados.push(["fn", `${m[1]}.${m[2]}`]);
  }
  for (const m of texto.matchAll(/^create trigger\s+([a-z_0-9]+)/gm)) {
    encontrados.push(["trg", m[1]]);
  }
  for (const [tipo, nombre] of encontrados) {
    const clave = `${tipo}:${nombre}`;
    if (!definidoEn.has(clave)) definidoEn.set(clave, numero);
    // Y se comprueban las de 0021 en adelante, que son las que se aplican a
    // mano; lo anterior a eso vino con la base.
    if (Number(numero) >= 21) {
      objetosPorMigracion.push([numero, tipo, nombre, definidoEn.get(clave) === numero]);
    }
  }
}

// Una sola fila por objeto y migración: un fichero puede recrear el mismo
// disparador dos veces y no son dos comprobaciones.
const vistos = new Set();
const filasObj = [];
for (const [mig, tipo, nombre, propio] of objetosPorMigracion) {
  const clave = `${mig}|${tipo}|${nombre}`;
  if (vistos.has(clave)) continue;
  vistos.add(clave);
  filasObj.push(`  (${comilla(mig)},${comilla(tipo)},${comilla(nombre)},${propio ? "true" : "false"})`);
}

const PIE_FN = `
)
select o.mig as migracion,
       case when o.tipo = 'fn' then 'funcion ' else 'disparador ' end || o.nom as objeto,
       case when o.tipo = 'fn' then
              case when exists (select 1 from pg_proc p
                                  join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = split_part(o.nom, '.', 1)
                                   and p.proname = split_part(o.nom, '.', 2))
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo reemplaza' end
                   else 'FALTA' end
            else
              case when exists (select 1 from pg_trigger g
                                 where g.tgname = o.nom and not g.tgisinternal)
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo rehace' end
                   else 'FALTA' end
       end as estado
  from o order by 1, 2;

-- "FALTA" = ese trozo de la migracion no se ejecuto. Vuelve a ejecutarla
-- entera: todas aguantan correrse dos veces.
--
-- "solo lo reemplaza/rehace" = el objeto ya existia de una migracion anterior,
-- asi que verlo no prueba que esta se ejecutara. Se mira con el fichero de
-- verificacion de esa migracion en supabase/editor/.
--
-- Si el pegado llego entero, la consulta termina en "order by 1, 2;".
`;

const trozosFn = trocear(filasObj, 2600);
for (const archivo of fs.readdirSync(SALIDA)) {
  if (/^auditoria_funciones_\d+\.sql$/.test(archivo)) fs.unlinkSync(path.join(SALIDA, archivo));
}
trozosFn.forEach((trozo, i) => {
  fs.writeFileSync(
    path.join(SALIDA, `auditoria_funciones_${i + 1}.sql`),
    `-- Funciones y disparadores de cada migracion, parte ${i + 1} de ${trozosFn.length}.\n` +
      `-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.\n\n` +
      "with o(mig,tipo,nom,propio) as (values\n" + trozo.join(",\n") + PIE_FN
  );
});

/* ═══════════════════════════════════ el detalle: todo, en trozos */

/** El final de la consulta del detalle. Cada trozo lo lleva entero. */
const PIE = `
), obj as (
  select e.mig, e.tipo, e.obj, nullif(trim(both from c), '') as col
    from e left join lateral unnest(
      case when e.tipo = 'col' then string_to_array(e.det, ',')
           else array[null]::text[] end) as c on true
), falta as (
  select o.mig, o.obj || coalesce('.' || o.col, '') as que from obj o
   where case when o.tipo = 'fn' then not exists (
                select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = o.obj)
              when o.tipo = 'val' then not exists (
                select 1 from pg_constraint k
                 where k.conrelid = to_regclass('public.' || o.obj) and k.contype = 'c'
                   and pg_get_constraintdef(k) like '%''' || o.det || '''%')
              else to_regclass('public.' || o.obj) is null
                or (o.col is not null and not exists (
                     select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = o.obj
                        and c.column_name = o.col)) end
), hay as (select mig, count(*) n from obj group by 1),
   no_hay as (select mig, count(*) n, string_agg(que, ', ') d from falta group by 1)
select h.mig as migracion,
       case when f.n is null then 'OK'
            when f.n >= h.n then 'FALTA ENTERA'
            else 'A MEDIAS - vuelve a ejecutarla' end as estado,
       coalesce(f.d, '') as lo_que_no_esta
  from hay h left join no_hay f on f.mig = h.mig order by 1;
`;

const fila = (mig, tipo, obj, det) =>
  `  (${comilla(mig)},${comilla(tipo)},${comilla(obj)},${comilla(det)})`;

// Se corta POR MIGRACIÓN y nunca por dentro de una: media migración en un trozo
// y media en otro daría dos veredictos sobre la misma, y los dos equivocados.
const trozos = [];
let actual = [];
let tamano = 0;
for (const grupo of grupos) {
  const mig = grupo.migration;
  const filas = [
    ...(grupo.tables ?? []).map((t) => fila(mig, "tab", t, "")),
    ...(grupo.columns ?? []).map(([t, cols]) => fila(mig, "col", t, cols.join(","))),
    ...(grupo.rpc ?? []).map((f) => fila(mig, "fn", f, "")),
    ...(grupo.enums ?? []).map(([t, , v]) => fila(mig, "val", t, v)),
  ].join(",\n");
  if (actual.length > 0 && tamano + filas.length > TOPE) {
    trozos.push(actual);
    actual = [];
    tamano = 0;
  }
  actual.push(filas);
  tamano += filas.length + 2;
}
if (actual.length > 0) trozos.push(actual);

for (const archivo of fs.readdirSync(SALIDA)) {
  if (/^auditoria_migraciones_\d+\.sql$/.test(archivo)) fs.unlinkSync(path.join(SALIDA, archivo));
}
trozos.forEach((trozo, i) => {
  const sql =
    `-- Auditoria de migraciones, parte ${i + 1} de ${trozos.length}. GENERADO.\n` +
    `-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.\n\n` +
    "with e(mig,tipo,obj,det) as (values\n" + trozo.join(",\n") + PIE +
    `\n-- Ejecuta las ${trozos.length} partes: cada una cubre un tramo distinto.\n` +
    `-- "A MEDIAS" quiere decir que ese pegado se trunco en su dia; vuelve a\n` +
    `-- ejecutar esa migracion entera, que todas aguantan correrse dos veces.\n`;
  fs.writeFileSync(path.join(SALIDA, `auditoria_migraciones_${i + 1}.sql`), sql);
});

for (const f of [
  "auditoria_migraciones.sql",
  ...trozosFn.map((_, i) => `auditoria_funciones_${i + 1}.sql`),
  ...trozos.map((_, i) => `auditoria_migraciones_${i + 1}.sql`),
]) {
  const bytes = fs.readFileSync(path.join(SALIDA, f), "utf8").length;
  console.log(`${f} — ${bytes} bytes${bytes > 5000 ? "  (pasado de tope)" : ""}`);
}
