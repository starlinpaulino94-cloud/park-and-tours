/**
 * EL NÚMERO DE COMPROBANTE FISCAL, VALIDADO ANTES DE GUARDARLO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA VALIDARLO AQUÍ
 *
 * Los que EMITE la operadora los construye Postgres (`app.next_ncf`, 0037) y
 * salen bien por construcción. Este módulo es para los que RECIBE: el número
 * que el proveedor copia de su propia factura.
 *
 * Un dígito de más en un NCF recibido es un 606 rechazado por la DGII, y el
 * rechazo llega semanas después — cuando ya nadie se acuerda de qué factura
 * era. Comprobar la forma al escribirlo cuesta una expresión regular y ahorra
 * esa arqueología.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO COMPRUEBA Y LO QUE NO
 *
 * La FORMA: la letra, el tipo y la cantidad de dígitos. No comprueba que ese
 * comprobante exista de verdad ni que esté autorizado a quien dice —eso solo lo
 * sabe la DGII—, y decir que sí lo comprueba sería peor que no comprobar nada.
 */

/** Serie B: letra + dos dígitos de tipo + ocho de secuencia. */
const SERIE_B = /^B(0[1245]|1[145])\d{8}$/;
/** Comprobante electrónico: E + dos dígitos de tipo + diez de secuencia. */
const SERIE_E = /^E(3[124]|4[45])\d{10}$/;

/** Los tipos que el esquema admite, en minúscula como se guardan. */
export const TIPOS_DE_NCF = [
  "b01", "b02", "b04", "b11", "b14", "b15",
  "e31", "e32", "e34", "e44", "e45",
] as const;
export type TipoDeNcf = (typeof TIPOS_DE_NCF)[number];

/**
 * Qué es cada uno, en palabras. La pantalla lo necesita para que el proveedor
 * elija con conocimiento en vez de adivinar entre códigos.
 */
export const NOMBRE_DEL_TIPO: Record<TipoDeNcf, string> = {
  b01: "Crédito fiscal",
  b02: "Consumo",
  b04: "Nota de crédito",
  b11: "Comprobante de compras",
  b14: "Regímenes especiales",
  b15: "Gubernamental",
  e31: "Crédito fiscal electrónico",
  e32: "Consumo electrónico",
  e34: "Nota de crédito electrónica",
  e44: "Regímenes especiales electrónico",
  e45: "Gubernamental electrónico",
};

/** El NCF en su forma canónica: sin espacios y en mayúscula. */
export function normalizarNcf(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/**
 * El tipo que declara el propio número, o `null` si no se reconoce.
 *
 * Se saca del NÚMERO y no se pregunta aparte: un formulario con dos campos
 * —«tipo» y «número»— admite que digan cosas distintas, y entonces el 606 sale
 * con un tipo que no es el del comprobante.
 */
export function tipoDeNcf(valor: string | null | undefined): TipoDeNcf | null {
  const ncf = normalizarNcf(valor);
  if (!SERIE_B.test(ncf) && !SERIE_E.test(ncf)) return null;
  const tipo = ncf.slice(0, 3).toLowerCase() as TipoDeNcf;
  return TIPOS_DE_NCF.includes(tipo) ? tipo : null;
}

export type MotivoDeNcfInvalido = "vacio" | "forma" | "tipo";

export interface NcfValidado {
  ok: boolean;
  /** El número ya normalizado, listo para guardar. */
  ncf: string;
  tipo: TipoDeNcf | null;
  motivo?: MotivoDeNcfInvalido;
  mensaje?: string;
}

const MENSAJE: Record<MotivoDeNcfInvalido, string> = {
  vacio: "Escribe el número de comprobante fiscal de tu factura.",
  // El mensaje trae un EJEMPLO. «Formato inválido» obliga a buscar el formato
  // en algún sitio, y el sitio no existe.
  forma: "Ese NCF no tiene la forma correcta. Son 11 caracteres como B0100000001, o 13 si es electrónico como E310000000001.",
  tipo: "Ese tipo de comprobante no se puede registrar aquí.",
};

export function validarNcf(valor: string | null | undefined): NcfValidado {
  const ncf = normalizarNcf(valor);
  if (!ncf) return { ok: false, ncf: "", tipo: null, motivo: "vacio", mensaje: MENSAJE.vacio };
  if (!SERIE_B.test(ncf) && !SERIE_E.test(ncf)) {
    return { ok: false, ncf, tipo: null, motivo: "forma", mensaje: MENSAJE.forma };
  }
  const tipo = tipoDeNcf(ncf);
  if (!tipo) return { ok: false, ncf, tipo: null, motivo: "tipo", mensaje: MENSAJE.tipo };
  return { ok: true, ncf, tipo };
}
