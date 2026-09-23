/**
 * EL IMPORTE ESCRITO EN LETRAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LO LLEVA UNA FACTURA
 *
 * «Son: DOS MIL QUINIENTOS PESOS CON 00/100» no es adorno. Una cifra en
 * números se altera cambiando un dígito; en letras hay que reescribir la
 * línea entera. Es la misma razón por la que los cheques lo llevan, y en la
 * República Dominicana es lo que se espera de una factura formal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DONDE ESTO SE SUELE HACER MAL
 *
 * El castellano tiene trampas que un `if` ingenuo se salta:
 *
 *  · 21 es «veintiuno», no «veinte y uno»; 16 es «dieciséis», no «diez y seis».
 *  · 100 es «cien», pero 101 es «ciento uno». «Cien uno» no existe.
 *  · 500 es «quinientos», 700 «setecientos» y 900 «novecientos»: no siguen el
 *    patrón de los demás.
 *  · 1.000 es «mil», nunca «un mil». Pero 21.000 sí es «veintiún mil».
 *  · Un millón lleva «un»: «un millón», y el plural es «millones».
 *  · Delante de un sustantivo masculino, «uno» se apocopa: «veintiún pesos».
 *
 * Y los centavos van en cifras sobre cien —«CON 45/100»—, que es la convención
 * del país: escribirlos en letras alarga la línea sin añadir seguridad.
 */

const UNIDADES = [
  "CERO", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
  "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS",
  "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

/** 0–999 en letras. `apocope` convierte el «uno» final en «un». */
function centenasEnLetras(n: number, apocope: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";

  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);

  if (resto > 0) {
    if (resto < 30) {
      partes.push(UNIDADES[resto]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }

  const texto = partes.join(" ");
  // «veintiún pesos», «treinta y un pesos»: la apócope solo afecta al UNO final.
  //
  // VEINTIUNO va PRIMERO y con su tilde. Al revés —que es como estaba— el
  // `UNO$` se lo comía antes, dejando «VEINTIUN» sin tilde y sin que el segundo
  // reemplazo llegara a mirar. Lo cazó la prueba.
  if (!apocope) return texto;
  return texto.endsWith("VEINTIUNO")
    ? texto.replace(/VEINTIUNO$/, "VEINTIÚN")
    : texto.replace(/UNO$/, "UN");
}

/** La parte entera en letras, sin moneda. */
export function enteroEnLetras(n: number): string {
  const entero = Math.floor(Math.abs(n));
  if (entero === 0) return "CERO";

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    // «UN MILLÓN», no «UNO MILLÓN»; y en plural, «MILLONES».
    partes.push(millones === 1 ? "UN MILLÓN" : `${centenasEnLetras(millones, true)} MILLONES`);
  }
  if (miles > 0) {
    // «MIL», nunca «UN MIL». Pero «VEINTIÚN MIL» sí lleva su número delante.
    partes.push(miles === 1 ? "MIL" : `${centenasEnLetras(miles, true)} MIL`);
  }
  if (resto > 0) partes.push(centenasEnLetras(resto, true));

  return partes.join(" ");
}

/** Cómo se llama cada moneda en una factura. */
const MONEDAS: Record<string, { singular: string; plural: string }> = {
  dop: { singular: "PESO DOMINICANO", plural: "PESOS DOMINICANOS" },
  usd: { singular: "DÓLAR ESTADOUNIDENSE", plural: "DÓLARES ESTADOUNIDENSES" },
  eur: { singular: "EURO", plural: "EUROS" },
};

/**
 * El importe completo, listo para la línea de la factura.
 *
 * Ejemplo: `montoEnLetras(2500, "dop")` →
 * «SON: DOS MIL QUINIENTOS PESOS DOMINICANOS CON 00/100».
 *
 * Los centavos se REDONDEAN a dos decimales antes de escribirlos, porque es lo
 * que enseña el total impreso: una línea en letras que no coincida con la cifra
 * de al lado es peor que no tenerla.
 */
export function montoEnLetras(importe: number | null | undefined, moneda = "dop"): string {
  const valor = Number(importe);
  if (!Number.isFinite(valor)) return "SON: CERO CON 00/100";

  const abs = Math.abs(valor);
  // Se redondea el TOTAL, no cada parte: con 0.995 la parte entera tiene que
  // subir a 1, y truncando por separado saldría «CERO CON 100/100».
  const centavosTotales = Math.round(abs * 100);
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;

  const nombre = MONEDAS[String(moneda).toLowerCase()] ?? { singular: "PESO", plural: "PESOS" };
  const unidad = entero === 1 ? nombre.singular : nombre.plural;

  const signo = valor < 0 ? "MENOS " : "";
  return `SON: ${signo}${enteroEnLetras(entero)} ${unidad} CON ${String(centavos).padStart(2, "0")}/100`;
}
