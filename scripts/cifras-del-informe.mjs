#!/usr/bin/env node
/**
 * LAS CIFRAS DEL INFORME, SACADAS DEL REPOSITORIO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * `PRODUCTION_READINESS.md` tenía un apartado titulado «Cobertura, MEDIDA» con
 * seis cifras escritas a mano. Las seis estaban mal, y no por poco:
 *
 *   · «en el repositorio hay 67 migraciones»  →  102
 *   · «la 0067 es la última»                  →  la 0102
 *   · «servicios sin ninguna prueba: 20»      →  0 de 40
 *   · «rutas de API: 152»                     →  176
 *   · «pruebas SQL: 10 ficheros»              →  24
 *   · «seis ficheros con 18 recorridos»       →  siete con 19
 *
 * Y la peor de todas estaba en la lista de tareas previas a la primera venta:
 * «la 0067 es la última». Con 35 migraciones por detrás, eso no es un dato
 * desactualizado: es una instrucción que deja la base a medio migrar y hace
 * creer que está al día.
 *
 * Una cifra escrita a mano en un documento envejece peor que el código,
 * porque nada falla cuando deja de ser verdad. Este script las deriva, y
 * `ui-contracts.test.ts` compara lo que dice el documento con lo que sale de
 * aquí: el día que cualquiera se mueva, la prueba se pone roja.
 *
 * Uso: node scripts/cifras-del-informe.mjs   (imprime JSON)
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
const leer = (rel) => readFileSync(path.join(RAIZ, rel), "utf8");
const listar = (rel) => (existsSync(path.join(RAIZ, rel)) ? readdirSync(path.join(RAIZ, rel)) : []);

/** Todo fichero bajo una raíz que cumpla el predicado, recorriendo carpetas. */
function ficheros(raiz, cumple) {
  const salida = [];
  const pila = [raiz];
  while (pila.length) {
    const dir = pila.pop();
    for (const nombre of readdirSync(path.join(RAIZ, dir))) {
      const rel = `${dir}/${nombre}`;
      if (statSync(path.join(RAIZ, rel)).isDirectory()) pila.push(rel);
      else if (cumple(rel)) salida.push(rel);
    }
  }
  return salida;
}

const migraciones = listar("supabase/migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

/**
 * Las tablas y su RLS.
 *
 * Hay DOS formas de activarla y contar solo una da un número falso: la ayuda
 * `app.enable_tenant_rls`, que es la de las tablas con inquilino, y el
 * `enable row level security` a mano de las que no lo tienen —`organizations`,
 * `plan`, `stripe_event`…— y llevan su propia política.
 */
/**
 * SIN COMENTARIOS, Y NO ES UN DETALLE.
 *
 * La primera versión escaneaba el SQL crudo, así que una llamada comentada
 * —`-- select app.enable_tenant_rls('public.customer');`— seguía contando como
 * tabla protegida. Lo cazó la mutación: comentar el RLS de `customer` no movía
 * el número. Un recuento que no distingue código de comentario no mide el
 * sistema, mide el fichero.
 */
const sinComentarios = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

const sqlMigraciones = sinComentarios(
  migraciones.map((f) => leer(`supabase/migrations/${f}`)).join("\n")
);
/**
 * Los nombres van SIEMPRE con su esquema.
 *
 * La primera versión de esto capturaba `([a-z_]+)` a secas, así que
 * `create table app.rate_limit_bucket` entraba como una tabla llamada «app» y
 * el limitador desaparecía del recuento de RLS. Un fallo de medición que
 * habría publicado una cifra falsa en el mismo documento que esto existe para
 * corregir.
 */
const conEsquema = (nombre) => (nombre.includes(".") ? nombre : `public.${nombre}`);

const tablas = new Set(
  [...sqlMigraciones.matchAll(/^create table (?:if not exists )?([a-z_]+(?:\.[a-z_]+)?)/gm)]
    .map((m) => conEsquema(m[1]))
);
const conAyuda = new Set(
  [...sqlMigraciones.matchAll(/app\.enable_tenant_rls\('([a-z_]+(?:\.[a-z_]+)?)'/g)]
    .map((m) => conEsquema(m[1]))
);
const aMano = new Set(
  [...sqlMigraciones.matchAll(/alter table ([a-z_]+(?:\.[a-z_]+)?)[^;]*?enable row level security/g)]
    .map((m) => conEsquema(m[1]))
);

const servicios = listar("src/lib").filter((f) => /-service\.ts$/.test(f));
const sinPrueba = servicios.filter((f) => !existsSync(path.join(RAIZ, "src/lib", f.replace(/\.ts$/, ".test.ts"))));

const specs = listar("tests/e2e").filter((f) => f.endsWith(".spec.ts"));
const recorridos = specs
  .map((f) => (leer(`tests/e2e/${f}`).match(/^\s*test\(/gm) || []).length)
  .reduce((a, b) => a + b, 0);

const cifras = {
  migraciones: migraciones.length,
  ultimaMigracion: migraciones.at(-1)?.slice(0, 4) ?? "",
  tablas: tablas.size,
  tablasConRlsDeInquilino: [...conAyuda].filter((t) => tablas.has(t)).length,
  tablasConPoliticaPropia: [...aMano].filter((t) => tablas.has(t)).length,
  // Las que no tienen ninguna de las dos. Es el número que de verdad importa.
  tablasSinRls: [...tablas].filter((t) => !conAyuda.has(t) && !aMano.has(t)).sort(),
  servicios: servicios.length,
  serviciosSinPrueba: sinPrueba.map((f) => f.replace(/\.ts$/, "")).sort(),
  rutasDeApi: ficheros("src/app/api", (f) => f.endsWith("/route.ts")).length,
  pruebasSql: listar("supabase/tests").filter((f) => f.endsWith(".test.sql")).length,
  ficherosE2e: specs.length,
  recorridosE2e: recorridos,
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log(JSON.stringify(cifras, null, 2));
}
export default cifras;
