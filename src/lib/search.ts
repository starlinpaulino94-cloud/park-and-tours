/**
 * BUSCAR COMO BUSCA UNA PERSONA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * La búsqueda de todos los listados hacía `ilike '%lo que escribiste%'` contra
 * cada campo POR SEPARADO. Tres consecuencias, y las tres se sufren en el
 * mostrador con un cliente delante:
 *
 *  1. **Los acentos importaban.** «jose perez» no encontraba a «José Pérez».
 *     La ficha existe y el sistema dice que no — y entonces alguien la crea otra
 *     vez, y ya hay dos.
 *  2. **El orden importaba.** «pérez josé» tampoco, porque ningún campo suelto
 *     contiene esa cadena.
 *  3. **No usaba ningún índice.** Un `LIKE` que empieza por comodín lee la
 *     tabla entera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE BUSCA AHORA
 *
 * Contra una columna generada que la base mantiene sola (0062): todos los
 * campos buscables de la fila, juntos, en minúsculas y sin acentos.
 *
 * Lo que se escribe se parte en PALABRAS y se exigen TODAS. Es lo que hace que
 * el orden deje de importar, y también lo que evita el falso positivo del
 * camino contrario: buscar «ana maria» y que salga todo el que se llame Ana.
 *
 * Todo lo de aquí es puro y es el espejo exacto de `app.search_normalize`. Si
 * los dos se separan, la búsqueda deja de encontrar lo que hay guardado — en
 * silencio, porque una búsqueda sin resultados no parece un fallo.
 */

/**
 * La misma tabla de caracteres que la función de la base, en el mismo orden.
 *
 * Cubre el español y lo que llega de los pasaportes que pasan por una operadora
 * dominicana: francés, portugués, italiano y alemán. Un turista se llama
 * «Müller» o «Gonçalves», y su ficha la teclea alguien que no tiene esas letras
 * a mano.
 */
export const ACCENTED = "ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿŠšŽž";
export const PLAIN    = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyySsZz";

const TABLE: Record<string, string> = {};
for (let i = 0; i < ACCENTED.length; i++) TABLE[ACCENTED[i]] = PLAIN[i] ?? ACCENTED[i];

/** Minúsculas y sin acentos, igual que la columna generada de la base. */
export function normalizeSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) out += TABLE[ch] ?? ch;
  return out.toLowerCase();
}

/**
 * Las palabras que hay que encontrar TODAS.
 *
 * Se descartan las de una sola letra: «j p» buscando a José Pérez traería media
 * agenda, y quien escribe una inicial suelta no está buscando, está tecleando.
 *
 * Y se topan en seis: cada palabra es una condición más contra la base, y quien
 * pega una dirección entera en el buscador no espera que se use palabra por
 * palabra.
 */
export const MAX_TERMS = 6;
export const MIN_TERM_LENGTH = 2;

export function searchTerms(query: unknown): string[] {
  return normalizeSearch(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TERM_LENGTH)
    .slice(0, MAX_TERMS);
}

/**
 * Los caracteres con significado en un `LIKE` de PostgREST.
 *
 * Un `%` escrito por una persona significa el símbolo del porcentaje —«tour 50%
 * descuento»—, no «lo que sea». Sin escaparlo, buscar «%» devolvería la tabla
 * entera y buscar «50%» encontraría cosas que no contienen ese texto.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/**
 * El filtro contra la columna normalizada.
 *
 * Devuelve `null` cuando no hay nada que buscar: un filtro vacío que no filtra
 * es peor que ninguno, porque parece que sí.
 */
export function normalizedFilter(
  column: string,
  query: unknown
): Record<string, unknown> | null {
  const terms = searchTerms(query);
  if (terms.length === 0) return null;
  // `_and` y no varias claves del mismo nombre: un objeto solo puede tener una
  // `search_text`, así que dos palabras se perderían quedándose con la última.
  return {
    _and: terms.map((term) => ({ [column]: { regex: escapeLike(term) } })),
  };
}

/**
 * El filtro de siempre, para las tablas que todavía no tienen columna
 * normalizada.
 *
 * Se conserva a propósito: ochenta recursos buscan por sus propios campos y
 * añadirles a todos una columna generada sería una migración enorme para
 * arreglar un problema que solo duele donde se buscan PERSONAS. Aquí al menos
 * se escapan los comodines, que antes no se escapaban.
 */
export function fallbackFilter(
  fields: string[],
  query: unknown
): Record<string, unknown> | null {
  const raw = typeof query === "string" ? query.trim() : "";
  if (!raw || fields.length === 0) return null;
  return { _or: fields.map((field) => ({ [field]: { regex: escapeLike(raw) } })) };
}

/**
 * Las tablas que tienen columna normalizada (0062).
 *
 * Vive aquí y no en `resources.ts` porque es una propiedad del ESQUEMA, no del
 * recurso: dos recursos pueden apuntar a la misma tabla, y lo que decide es si
 * esa tabla tiene la columna.
 */
export const NORMALIZED_TABLES = new Set(["customer", "seller", "product", "supplier"]);
export const NORMALIZED_COLUMN = "search_text";

/** El filtro de búsqueda que le toca a una tabla. */
export function searchFilterFor(
  table: string,
  fields: string[],
  query: unknown
): Record<string, unknown> | null {
  if (NORMALIZED_TABLES.has(table)) return normalizedFilter(NORMALIZED_COLUMN, query);
  return fallbackFilter(fields, query);
}
