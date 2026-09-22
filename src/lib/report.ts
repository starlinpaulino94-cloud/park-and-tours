import { companyTimeZone, zonedParts, zoneOffsetMs } from "@/lib/time";

/**
 * EL PERÍODO DE UN REPORTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES «UN PAR DE FECHAS»
 *
 * Un reporte se pide en días de calendario —«del 1 al 30 de septiembre»— pero
 * los datos son INSTANTES. Traducir lo uno a lo otro tiene dos trampas, y las
 * dos ya mordieron en este sistema:
 *
 *   1. EL ÚLTIMO DÍA SE CAE. Comparar `<= '2026-09-30'` es comparar contra la
 *      MEDIANOCHE del 30, así que todo lo que pasó ese día —o sea, el día
 *      entero— queda fuera. El reporte sale, parece bien, y le falta una
 *      jornada. Por eso el rango es SEMIABIERTO: desde la medianoche del
 *      primer día hasta la medianoche del día siguiente al último.
 *
 *   2. EL DÍA SE CUENTA EN LA ZONA DE LA EMPRESA, NO EN UTC. Una venta de las
 *      21:00 del 30 en Santo Domingo es la 01:00 del 1 en UTC. Con los cortes
 *      en UTC, esa venta se va al mes siguiente. Es el mismo defecto que hubo
 *      que corregir en las declaraciones fiscales.
 *
 * Todo lo de aquí es puro: recibe el día, la zona y «hoy», y no toca reloj ni
 * base de datos. Así se puede probar el 31 de diciembre sin esperar al 31 de
 * diciembre.
 */

/** Un período, en días de calendario de la empresa (`YYYY-MM-DD`). */
export interface Periodo {
  desde: string;
  hasta: string;
}

/** Los límites que se le mandan a la base: semiabiertos, `desde <= t < hasta`. */
export interface LimitesConsulta {
  gte: string;
  lt: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** El día de calendario de un instante, en la zona de la empresa. */
export function diaLocal(instante: Date, tz: string): string {
  const p = zonedParts(instante, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * La medianoche local de un día, resuelta a instante UTC.
 *
 * Se refina una vez porque el desfase de la zona puede cambiar entre la
 * referencia y la medianoche —un cambio de horario de verano—, y ahí un error
 * de una hora mueve un evento de día.
 */
function medianoche(dia: string, tz: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  const pared = Date.UTC(y, m - 1, d, 0, 0, 0);
  const primera = new Date(pared - zoneOffsetMs(new Date(pared), tz));
  return new Date(pared - zoneOffsetMs(primera, tz));
}

/** El día siguiente, en calendario (sirve para cerrar el rango por arriba). */
export function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
  return siguiente.toISOString().slice(0, 10);
}

/**
 * Los límites para consultar. `lt` es la medianoche del día SIGUIENTE al
 * último: es lo que hace que el último día entre entero.
 */
export function limitesConsulta(p: Periodo, tz: string): LimitesConsulta {
  return {
    gte: medianoche(p.desde, tz).toISOString(),
    lt: medianoche(diaSiguiente(p.hasta), tz).toISOString(),
  };
}

/**
 * Normaliza lo que llega de la pantalla o de la URL.
 *
 * Sin nada, el mes en curso — que es lo que se pide nueve de cada diez veces.
 * Con las fechas al revés, se enderezan en vez de devolver un reporte vacío:
 * quien escribe «del 30 al 1» quiere del 1 al 30, no quiere nada.
 */
export function normalizarPeriodo(
  desde: string | null | undefined,
  hasta: string | null | undefined,
  hoy: Date,
  tz: string,
): Periodo {
  const d = desde && DIA.test(desde) ? desde : null;
  const h = hasta && DIA.test(hasta) ? hasta : null;
  const hoyLocal = diaLocal(hoy, tz);

  if (!d && !h) {
    const p = zonedParts(hoy, tz);
    return { desde: `${p.year}-${String(p.month).padStart(2, "0")}-01`, hasta: hoyLocal };
  }
  // Con un solo extremo, el otro es hoy. Un reporte abierto por arriba se lee
  // como «hasta ahora», que es lo que espera quien pone solo el desde.
  if (d && !h) return d > hoyLocal ? { desde: d, hasta: d } : { desde: d, hasta: hoyLocal };
  if (!d && h) return { desde: h, hasta: h };
  return d! <= h! ? { desde: d!, hasta: h! } : { desde: h!, hasta: d! };
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Cómo se lee el período en el papel.
 *
 * Un solo día se dice como un día. Dentro del mismo mes no se repite el mes.
 * Es lo que separa un encabezado que se entiende de uno que hay que descifrar.
 */
export function etiquetaPeriodo(p: Periodo): string {
  const [ay, am, ad] = p.desde.split("-").map(Number);
  const [by, bm, bd] = p.hasta.split("-").map(Number);
  if (p.desde === p.hasta) return `${ad} de ${MESES[am - 1]} de ${ay}`;
  if (ay === by && am === bm) return `${ad} al ${bd} de ${MESES[am - 1]} de ${ay}`;
  if (ay === by) return `${ad} de ${MESES[am - 1]} al ${bd} de ${MESES[bm - 1]} de ${ay}`;
  return `${ad} de ${MESES[am - 1]} de ${ay} al ${bd} de ${MESES[bm - 1]} de ${by}`;
}

/** Nombre del archivo que se descarga: lleva el período, para no confundirlos. */
export function nombreArchivo(slug: string, p: Periodo, ext = "csv"): string {
  const limpio = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return p.desde === p.hasta
    ? `${limpio}-${p.desde}.${ext}`
    : `${limpio}-${p.desde}_a_${p.hasta}.${ext}`;
}

/** Atajos del selector. Se calculan con «hoy» explícito para poder probarlos. */
export function atajos(hoy: Date, tz: string): { clave: string; etiqueta: string; periodo: Periodo }[] {
  const hoyLocal = diaLocal(hoy, tz);
  const p = zonedParts(hoy, tz);
  const primeroDeEsteMes = `${p.year}-${String(p.month).padStart(2, "0")}-01`;
  const ayer = diaLocal(new Date(medianoche(hoyLocal, tz).getTime() - 1), tz);
  const mesAnterior = p.month === 1
    ? { y: p.year - 1, m: 12 }
    : { y: p.year, m: p.month - 1 };
  const primeroMesAnterior = `${mesAnterior.y}-${String(mesAnterior.m).padStart(2, "0")}-01`;
  const ultimoMesAnterior = diaLocal(new Date(medianoche(primeroDeEsteMes, tz).getTime() - 1), tz);

  return [
    { clave: "hoy", etiqueta: "Hoy", periodo: { desde: hoyLocal, hasta: hoyLocal } },
    { clave: "ayer", etiqueta: "Ayer", periodo: { desde: ayer, hasta: ayer } },
    { clave: "mes", etiqueta: "Este mes", periodo: { desde: primeroDeEsteMes, hasta: hoyLocal } },
    { clave: "mes-anterior", etiqueta: "Mes anterior", periodo: { desde: primeroMesAnterior, hasta: ultimoMesAnterior } },
  ];
}

/** La zona de la empresa, reexportada para que las pantallas no importen dos módulos. */
export { companyTimeZone };
