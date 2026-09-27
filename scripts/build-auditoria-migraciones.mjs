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

/* ═══════════════════════════════════ «que me falta»: un veredicto por migracion */

/**
 * LO ÚLTIMO QUE CADA FICHERO ESCRIBE, Y NADA MÁS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA OTRO
 *
 * Para contestar «¿qué me falta por ejecutar?» había que pegar diez consultas
 * —siete de columnas y tres de funciones— y cruzar los resultados a ojo. Y el
 * resumen de columnas lo avisa él mismo: de 0077 en adelante lo que cada
 * migración aporta son funciones y disparadores, que van al FINAL del fichero,
 * mientras la columna la crea la primera línea. Una migración de cinco partes
 * de la que solo se ejecutó la primera salía en verde.
 *
 * Aquí se elige, por cada migración, el objeto que aparece MÁS TARDE en su
 * texto —que en un script lineal es lo último que se ejecuta— y se comprueba
 * ese. Si está, la migración llegó al final; si no, no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO CUENTA LO QUE ESTA MIGRACIÓN ESTRENA
 *
 * Un `create or replace function` sobre una función que ya existía, o un
 * `create trigger` que rehace uno de antes, se ven en el catálogo aunque esta
 * migración no se haya ejecutado nunca. Usarlos daría «OK» a ciegas, que es
 * peor que no mirar. Se descartan, y si a una migración no le queda nada que
 * estrene, lo DICE en vez de callarse: «no se puede comprobar así».
 */
const ESTRENA_TIPO = { fn: 'funcion', trg: 'disparador', tbl: 'tabla', col: 'columna', idx: 'indice' };

const ultimoDe = new Map();      // numero -> [tipo, nombre] | null
const porMigracion = new Map();  // numero -> candidatos que estrena
const primeraVezGlobal = new Map();

for (const archivo of [...ficheros].sort()) {
  const numero = archivo.slice(0, 4);
  const texto = fs.readFileSync(path.join(MIGRACIONES_DIR, archivo), "utf8")
    .replace(/^\s*--.*$/gm, "");

  const candidatos = [];
  const anota = (tipo, nombre, pos) => {
    const clave = `${tipo}:${nombre}`;
    const estrena = !primeraVezGlobal.has(clave);
    if (estrena) primeraVezGlobal.set(clave, numero);
    candidatos.push({ tipo, nombre, pos, estrena });
  };

  for (const m of texto.matchAll(/^create (?:or replace )?function\s+([a-z_]+)\.([a-z_0-9]+)/gm)) {
    anota("fn", `${m[1]}.${m[2]}`, m.index);
  }
  for (const m of texto.matchAll(/^create trigger\s+([a-z_0-9]+)/gm)) anota("trg", m[1], m.index);
  for (const m of texto.matchAll(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gim)) {
    anota("tbl", m[1], m.index);
  }
  for (const m of texto.matchAll(/^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gim)) {
    anota("idx", m[1], m.index);
  }
  for (const m of texto.matchAll(/^alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gim)) {
    anota("col", `${m[1]}.${m[2]}`, m.index);
  }

  if (Number(numero) < 21) continue;
  porMigracion.set(numero, candidatos.filter((c) => c.estrena));
}

/**
 * Y LO QUE UNA MIGRACIÓN POSTERIOR BORRA YA NO PRUEBA NADA.
 *
 * Medido contra una base con las 98 aplicadas: 0038 y 0081 salían FALTA. Y era
 * cierto que sus disparadores no estaban —`ledger_entry_cash_session_same_tenant`
 * y `cash_session_same_tenant` los borra 0095 para rehacerlos con otro nombre—,
 * pero la conclusión era falsa: esas dos migraciones SÍ se habían ejecutado.
 *
 * Un falso «FALTA» es tan malo como un falso «OK»: manda a ejecutar otra vez
 * algo que ya está y, sobre todo, enseña a desconfiar de la consulta, que es la
 * forma de que la próxima vez nadie la mire. Así que un objeto que cualquier
 * migración posterior borra se descarta como prueba, y si a una migración no le
 * queda ninguno, lo dice.
 */
const borradoDespues = new Map();   // nombre -> primera migración que lo borra
for (const archivo of [...ficheros].sort()) {
  const numero = archivo.slice(0, 4);
  const texto = fs.readFileSync(path.join(MIGRACIONES_DIR, archivo), "utf8")
    .replace(/^\s*--.*$/gm, "");
  const anotaBorrado = (clave) => {
    if (!borradoDespues.has(clave)) borradoDespues.set(clave, numero);
  };
  for (const m of texto.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?([a-z_0-9]+)/gi)) {
    anotaBorrado(`trg:${m[1]}`);
  }
  for (const m of texto.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([a-z_]+)\.([a-z_0-9]+)/gi)) {
    anotaBorrado(`fn:${m[1]}.${m[2]}`);
  }
  for (const m of texto.matchAll(/drop\s+index\s+(?:if\s+exists\s+)?([a-z_0-9]+)/gi)) {
    anotaBorrado(`idx:${m[1]}`);
  }
  for (const m of texto.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi)) {
    anotaBorrado(`tbl:${m[1]}`);
  }
  for (const m of texto.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+drop\s+column\s+(?:if\s+exists\s+)?([a-z_0-9]+)/gi)) {
    anotaBorrado(`col:${m[1]}.${m[2]}`);
  }
}

for (const [numero, candidatos] of [...porMigracion.entries()].sort()) {
  const vivos = candidatos.filter((c) => {
    const quienLoBorra = borradoDespues.get(`${c.tipo}:${c.nombre}`);
    // Se borra en ESTA o en una posterior: en ambos casos deja de servir.
    return quienLoBorra === undefined || quienLoBorra < numero;
  });
  if (vivos.length === 0) { ultimoDe.set(numero, null); continue; }
  vivos.sort((a, b) => a.pos - b.pos);
  const ultimo = vivos[vivos.length - 1];
  ultimoDe.set(numero, [ultimo.tipo, ultimo.nombre]);
}

/**
 * LA HUELLA DE LAS QUE SOLO REEMPLAZAN.
 *
 * Una migración que no estrena nada —`create or replace function` sobre algo
 * que ya existía— no se puede comprobar mirando SI el objeto está: está desde
 * antes. Pero sí mirando QUÉ DICE: cada una de estas deja en el cuerpo de la
 * función una frase que antes no estaba, y `pg_get_functiondef` la devuelve.
 *
 * Es la misma comprobación que hace la propia migración al final de su fichero
 * y la que hace su `NNNN_parte_N_verificacion.sql`. Aquí se repite para que la
 * respuesta a «¿qué me falta?» no tenga huecos justo en las más nuevas, que son
 * las que uno está a punto de ejecutar.
 *
 * Se escribe a mano porque la frase distintiva la elige quien entiende el
 * cambio, no una expresión regular. Lo que NO queda a mano es acordarse de
 * añadirla: `schema-contract.test.ts` exige que toda migración sin objeto
 * propio tenga huella aquí o un fichero de verificación en `supabase/editor/`.
 *
 * SIEMPRE EN POSITIVO, NUNCA «ya no dice».
 *
 * 0097 llevaba «ya no dice `exists(select 1 from`», y contra una base parada en
 * la 0087 daba OK: la versión vieja tampoco lo decía. La ausencia de algo no
 * distingue «ya lo quité» de «nunca lo tuve», así que la huella tiene que ser
 * una frase que esta migración AÑADE.
 *
 *   [migración, objeto, 'dice', frase]
 *
 * La consulta busca la frase con `position`, no con `like`: la huella de 0097
 * es `select %I, true from %s` y en un patrón de `like` cada `%` es un comodín,
 * así que casaba con cualquier cosa y daba OK a ciegas. Es el mismo fallo que
 * el `ilike` sin escapar de `membego-service`, en otra ventana.
 */
const HUELLAS = [
  ["0028", "public.dashboard_summary", "dice", "'otros', 'otros'"],
  ["0093", "app.custom_access_token_hook", "dice", "user_active_workspace"],
  ["0095", "app.enforce_same_tenant_refs", "dice", "tenant_org_id"],
  ["0096", "public.dashboard_summary", "dice", "b.status, b.booking_date, b.channel"],
  ["0097", "app.enforce_same_tenant_refs", "dice", "select %I, true from %s"],
];
const conHuella = new Map(HUELLAS.map((h) => [h[0], h]));

const filasFalta = [...ultimoDe.entries()].sort().map(([numero, ultimo]) =>
  ultimo !== null
    ? `  (${comilla(numero)},${comilla(ultimo[0])},${comilla(ultimo[1])},'')`
    : conHuella.has(numero)
      ? `  (${comilla(numero)},'src',` +
        `${comilla(conHuella.get(numero)[1])},${comilla(conHuella.get(numero)[3])})`
      : `  (${comilla(numero)},'?','','')`
);

const PIE_FALTA = `
), v as (
  select u.mig,
         case u.tipo
           when '?' then 'NO SE PUEDE COMPROBAR ASI'
           when 'src' then case when position(u.huella in coalesce((
                  select pg_get_functiondef(p.oid) from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2)), '')) > 0
                then 'OK' else 'FALTA' end
           when 'fn' then case when exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
           when 'trg' then case when exists (
                  select 1 from pg_trigger g where g.tgname = u.nom and not g.tgisinternal)
                then 'OK' else 'FALTA' end
           when 'idx' then case when exists (
                  select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = u.nom)
                then 'OK' else 'FALTA' end
           when 'tbl' then case when to_regclass('public.' || u.nom) is not null
                then 'OK' else 'FALTA' end
           else case when exists (
                  select 1 from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = split_part(u.nom, '.', 1)
                     and c.column_name = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
         end as estado,
         case u.tipo when 'fn' then 'funcion ' when 'trg' then 'disparador '
                     when 'idx' then 'indice ' when 'tbl' then 'tabla '
                     when 'src' then 'en el cuerpo de '
                     when '?' then '' else 'columna ' end || u.nom
         || case when u.tipo = 'src' then ': ' || u.huella else '' end as ultimo
    from u
)
select v.mig as migracion, v.estado,
       case when v.estado = 'NO SE PUEDE COMPROBAR ASI'
            then 'solo reemplaza cosas que ya existian: mirala con su fichero de verificacion'
            else 'lo ultimo que escribe: ' || v.ultimo end as detalle
  from v
 order by case v.estado when 'FALTA' then 0 when 'NO SE PUEDE COMPROBAR ASI' then 1 else 2 end,
          v.mig;

-- Si el pegado llego entero, la consulta termina en "v.mig;".
--
-- COMO SE LEE. Las que FALTAN salen arriba. De cada migracion se comprueba lo
-- ULTIMO que su fichero escribe: si eso esta, la migracion llego al final.
-- Es lo que el resumen de columnas no podia ver, porque miraba una columna que
-- crea la PRIMERA linea y daba OK a una migracion ejecutada a medias.
--
-- "NO SE PUEDE COMPROBAR ASI" no quiere decir que este. Quiere decir que esa
-- migracion solo REEMPLAZA cosas que ya existian, asi que verlas en el
-- catalogo no prueba nada. Cada una tiene su fichero NNNN_parte_N_verificacion
-- en supabase/editor/: ese si lo dice.
--
-- Todas aguantan ejecutarse dos veces, asi que ante la duda, vuelve a correrla.
`;

const trozosFalta = trocear(filasFalta, 2400);
for (const archivo of fs.readdirSync(SALIDA)) {
  if (/^que_me_falta_\d+\.sql$/.test(archivo)) fs.unlinkSync(path.join(SALIDA, archivo));
}
trozosFalta.forEach((trozo, i) => {
  fs.writeFileSync(
    path.join(SALIDA, `que_me_falta_${i + 1}.sql`),
    `-- QUE MIGRACIONES ME FALTAN POR EJECUTAR, parte ${i + 1} de ${trozosFalta.length}.\n` +
      `-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.\n\n` +
      "with u(mig,tipo,nom,huella) as (values\n" + trozo.join(",\n") + PIE_FALTA
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
