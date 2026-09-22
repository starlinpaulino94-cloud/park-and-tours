/**
 * EL CIERRE DEL DÍA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ DOCUMENTO ES ÉSTE
 *
 * Al final de la jornada alguien tiene que poder firmar una hoja que diga qué
 * operó, qué se vendió, qué entró en dinero y qué quedó pendiente. Hasta ahora
 * eso se reconstruía abriendo cinco pantallas y apuntando en un cuaderno, que
 * es exactamente el sitio donde se pierde.
 *
 * No es el resumen del panel con otro nombre. El panel enseña el estado ACTUAL
 * y cambia cada vez que se mira; esto es una FOTO de un día concreto, pensada
 * para imprimirse, firmarse y archivarse. Dos personas que impriman el cierre
 * del mismo día tienen que obtener la misma hoja.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE DOCUMENTO TIENE QUE GRITAR
 *
 * El descuadre de efectivo. Si el sistema dice que entraron RD$40.000 en
 * efectivo y en la caja hay RD$38.500, eso es el hallazgo del día, y una hoja
 * que lo deje como dos números en dos secciones distintas no lo está diciendo.
 * Aquí se calcula, se nombra y sale arriba.
 *
 * Todo lo de aquí es PURO: recibe filas y devuelve el documento. Quien lee la
 * base es `cierre-dia-service.ts`.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * QUÉ CUENTA COMO DINERO ENTRADO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA REGLA NO SE INVENTA AQUÍ
 *
 * El panel ya la tiene, en la vista financiera de la migración 0023: cuenta
 * solo los cobros `completed`, y los de tipo `refund` o `credit_note` los
 * RESTA. Escribir aquí una regla distinta —«todo lo que no esté rechazado»—
 * haría que el cierre del martes y el panel del martes dieran cifras distintas
 * del mismo día. Dos documentos del mismo sistema contradiciéndose es peor que
 * uno solo equivocado: no hay forma de saber cuál creer.
 *
 * Un cobro `authorized` tampoco entra: la tarjeta está autorizada, el dinero no
 * está. Y en una caja que se cuenta a mano, lo que no está no se puede contar.
 */

/** Cobros que devuelven dinero: suman en negativo. */
export const TIPOS_QUE_DEVUELVEN = new Set(["refund", "credit_note"]);

/** Solo un cobro completado es dinero que llegó. */
export function esDineroEntrado(estado?: string | null): boolean {
  return String(estado ?? "").toLowerCase() === "completed";
}

/** El signo del cobro: una devolución resta. */
export function signoDe(tipo?: string | null): 1 | -1 {
  return TIPOS_QUE_DEVUELVEN.has(String(tipo ?? "").toLowerCase()) ? -1 : 1;
}

/* ══════════════════════════════════════════════════════ lo que operó */

export interface SalidaDia {
  status?: string | null;
  capacity?: unknown;
  booked_pax?: unknown;
  actual_pax?: unknown;
  no_show_pax?: unknown;
}

export interface ResumenOperacion {
  programadas: number;
  operadas: number;
  canceladas: number;
  cupo: number;
  vendido: number;
  operado: number;
  noShow: number;
  /** Ocupación real sobre el cupo, en porcentaje; null si no hubo cupo. */
  ocupacion: number | null;
}

/** Salidas que no llegaron a operar. El resto cuenta como operado. */
const NO_OPERO = new Set(["cancelled", "canceled", "draft", "scheduled", "planned"]);

export function resumirOperacion(salidas: SalidaDia[]): ResumenOperacion {
  let operadas = 0, canceladas = 0, cupo = 0, vendido = 0, operado = 0, noShow = 0;
  for (const s of salidas) {
    const estado = String(s.status ?? "").toLowerCase();
    if (estado === "cancelled" || estado === "canceled") canceladas++;
    else if (!NO_OPERO.has(estado)) operadas++;
    cupo += num(s.capacity);
    vendido += num(s.booked_pax);
    operado += num(s.actual_pax);
    noShow += num(s.no_show_pax);
  }
  return {
    programadas: salidas.length, operadas, canceladas,
    cupo, vendido, operado, noShow,
    // Sin cupo no hay ocupación. Devolver 0 diría «se fueron vacías», que es
    // una afirmación distinta de «no se puede calcular».
    ocupacion: cupo > 0 ? round2((operado / cupo) * 100) : null,
  };
}

/* ═══════════════════════════════════════════════════ lo que se vendió */

export interface VentaDia {
  total?: unknown;
  channel?: string | null;
  status?: string | null;
}

export interface LineaCanal {
  canal: string;
  documentos: number;
  importe: number;
}

/**
 * Lo vendido, repartido por canal.
 *
 * El desempate es alfabético a propósito: sin él, dos canales con el mismo
 * importe bailan de sitio entre dos impresiones del MISMO día, y dos copias
 * dejan de poder compararse línea a línea.
 */
export function ventasPorCanal(ventas: VentaDia[]): LineaCanal[] {
  const mapa = new Map<string, LineaCanal>();
  for (const v of ventas) {
    const canal = String(v.channel ?? "").trim() || "sin_canal";
    const linea = mapa.get(canal) ?? { canal, documentos: 0, importe: 0 };
    linea.documentos++;
    linea.importe = round2(linea.importe + num(v.total));
    mapa.set(canal, linea);
  }
  return [...mapa.values()].sort(
    (a, b) => b.importe - a.importe || a.canal.localeCompare(b.canal, "es"),
  );
}

/* ════════════════════════════════════════════════════ lo que se cobró */

export interface CobroDia {
  amount?: unknown;
  method?: string | null;
  status?: string | null;
  payment_type?: string | null;
}

export interface LineaMetodo {
  metodo: string;
  cobros: number;
  importe: number;
}

export interface ResumenCobros {
  lineas: LineaMetodo[];
  total: number;
  /** Solo lo cobrado en efectivo: es lo único que se puede contar en una caja. */
  efectivo: number;
  /** Cobros descartados por no estar completados, para no mentir por omisión. */
  descartados: number;
}

export function resumirCobros(cobros: CobroDia[]): ResumenCobros {
  const mapa = new Map<string, LineaMetodo>();
  let total = 0, efectivo = 0, descartados = 0;

  for (const c of cobros) {
    if (!esDineroEntrado(c.status)) { descartados++; continue; }
    const metodo = String(c.method ?? "").trim() || "other";
    const importe = round2(num(c.amount) * signoDe(c.payment_type));
    const linea = mapa.get(metodo) ?? { metodo, cobros: 0, importe: 0 };
    linea.cobros++;
    linea.importe = round2(linea.importe + importe);
    mapa.set(metodo, linea);
    total = round2(total + importe);
    if (metodo === "cash") efectivo = round2(efectivo + importe);
  }

  return {
    lineas: [...mapa.values()].sort(
      (a, b) => b.importe - a.importe || a.metodo.localeCompare(b.metodo, "es"),
    ),
    total, efectivo, descartados,
  };
}

/* ═════════════════════════════════════════════════ el cuadre de caja */

export interface SesionCaja {
  status?: string | null;
  counted_cash?: unknown;
  expected_cash?: unknown;
  opening_amount?: unknown;
  closed_at?: string | null;
}

export interface CuadreCaja {
  /** Efectivo que el sistema dice que entró hoy. */
  segunSistema: number;
  /** Efectivo contado al cerrar las cajas. */
  contado: number;
  /** Fondo con el que abrieron, que NO es venta del día. */
  fondo: number;
  diferencia: number;
  veredicto: "cuadra" | "falta" | "sobra" | "sin_cierre";
  /** Cajas que siguen abiertas: mientras las haya, el cuadre es provisional. */
  abiertas: number;
}

/** Un peso de diferencia en una caja de mostrador no es un hallazgo. */
export const TOLERANCIA_CAJA = 1;

/**
 * El cuadre del efectivo del día.
 *
 * Al contado se le RESTA el fondo de apertura: el dinero con el que la caja
 * abrió no lo vendió nadie hoy, y sumarlo haría que toda caja con fondo
 * pareciera tener un sobrante exactamente igual a su fondo. Es el error que
 * convierte un descuadre real en ruido de fondo que se aprende a ignorar.
 */
export function cuadrarCaja(efectivoCobrado: number, sesiones: SesionCaja[]): CuadreCaja {
  let contado = 0, fondo = 0, abiertas = 0, cerradas = 0;

  for (const s of sesiones) {
    const estado = String(s.status ?? "").toLowerCase();
    if (estado === "open") { abiertas++; continue; }
    cerradas++;
    contado = round2(contado + num(s.counted_cash));
    fondo = round2(fondo + num(s.opening_amount));
  }

  const neto = round2(contado - fondo);
  const diferencia = round2(neto - efectivoCobrado);

  let veredicto: CuadreCaja["veredicto"];
  if (cerradas === 0) veredicto = "sin_cierre";
  else if (Math.abs(diferencia) <= TOLERANCIA_CAJA) veredicto = "cuadra";
  else veredicto = diferencia < 0 ? "falta" : "sobra";

  return { segunSistema: efectivoCobrado, contado: neto, fondo, diferencia, veredicto, abiertas };
}

/* ═══════════════════════════════════════════════ el documento entero */

export interface EntradasCierre {
  fecha: string;
  salidas: SalidaDia[];
  ventas: VentaDia[];
  cobros: CobroDia[];
  sesionesCaja: SesionCaja[];
  incidencias: { severity?: string | null }[];
}

export interface CierreDia {
  fecha: string;
  operacion: ResumenOperacion;
  ventas: { lineas: LineaCanal[]; documentos: number; total: number };
  cobros: ResumenCobros;
  caja: CuadreCaja;
  incidencias: { total: number; graves: number };
  /** Lo que hay que mirar antes de firmar, ya redactado. */
  avisos: string[];
}

const GRAVES = new Set(["critical", "high", "major"]);

export function cerrarDia(e: EntradasCierre): CierreDia {
  const operacion = resumirOperacion(e.salidas);
  const lineasCanal = ventasPorCanal(e.ventas);
  const cobros = resumirCobros(e.cobros);
  const caja = cuadrarCaja(cobros.efectivo, e.sesionesCaja);
  const graves = e.incidencias.filter((i) => GRAVES.has(String(i.severity ?? "").toLowerCase())).length;

  const avisos: string[] = [];
  if (caja.veredicto === "falta") {
    avisos.push(`Falta efectivo en caja: ${Math.abs(caja.diferencia).toFixed(2)}.`);
  } else if (caja.veredicto === "sobra") {
    avisos.push(`Sobra efectivo en caja: ${Math.abs(caja.diferencia).toFixed(2)}.`);
  }
  if (caja.veredicto === "sin_cierre" && cobros.efectivo > 0) {
    // Efectivo cobrado y ninguna caja contada: no hay descuadre porque no hay
    // con qué comparar, y eso es peor que un descuadre. Decir «cuadra» aquí
    // sería firmar que alguien contó, cuando nadie contó.
    avisos.push(`Entraron ${cobros.efectivo.toFixed(2)} en efectivo y ninguna caja se cerró: nadie contó.`);
  }
  if (caja.abiertas > 0) {
    avisos.push(`${caja.abiertas} caja(s) sin cerrar: el cuadre de efectivo es provisional.`);
  }
  if (cobros.descartados > 0) {
    avisos.push(`${cobros.descartados} cobro(s) no cuentan como entrada (pendientes, rechazados o devueltos).`);
  }
  if (operacion.noShow > 0) {
    avisos.push(`${operacion.noShow} pasajero(s) no se presentaron.`);
  }
  if (operacion.canceladas > 0) {
    avisos.push(`${operacion.canceladas} salida(s) canceladas.`);
  }
  if (graves > 0) {
    avisos.push(`${graves} incidencia(s) graves del día.`);
  }

  return {
    fecha: e.fecha,
    operacion,
    ventas: {
      lineas: lineasCanal,
      documentos: lineasCanal.reduce((a, l) => a + l.documentos, 0),
      total: round2(lineasCanal.reduce((a, l) => a + l.importe, 0)),
    },
    cobros,
    caja,
    incidencias: { total: e.incidencias.length, graves },
    avisos,
  };
}
