/**
 * EL SALDO PREPAGO DEL TOUR CENTER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA, Y QUÉ NO
 *
 * El control de CRÉDITO existe y funciona desde 0031: el socio vende ahora y
 * debe después, con un techo (`creditCheck`). Lo que no había es lo contrario —
 * el socio que ingresa dinero por adelantado y va gastando— y es como trabaja
 * la mitad de los tour centers de la costa: transfieren el lunes y venden toda
 * la semana contra ese depósito.
 *
 * Sin eso, a un socio prepago había que llevarle el saldo en una libreta y
 * mirarla antes de cada venta. Como el cupo antes de 6.4 y el contrato antes de
 * 6.1: el acuerdo existía fuera del sistema.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SALDO NO SE GUARDA: SE SUMA
 *
 * No hay columna `balance`. Hay un libro de movimientos y el saldo es su suma.
 *
 * Una columna con el saldo es un número que puede discrepar de sus movimientos,
 * y cuando discrepa nadie sabe cuál de los dos es el bueno — pasa el día que
 * una escritura falla a mitad, o que alguien la corrige a mano. Un saldo
 * derivado no puede descuadrarse: se recalcula.
 *
 * (Y hay un `balance: 0` en el sembrador de demostración que no va a ninguna
 * columna: ni está en `PARTNER_RELATIONSHIP_COLUMNS` ni en
 * `PARTNER_ORG_COLUMNS`, así que `toPartnerRecord` lo tira. Era justo esa
 * columna imaginaria.)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL IMPORTE SIEMPRE ES POSITIVO
 *
 * El signo lo pone el TIPO de movimiento, no el número. Con importes con signo,
 * una recarga de −500 vacía el monedero sin que nada parezca raro: es «una
 * recarga», y en el listado se lee como una recarga. Con el importe siempre
 * positivo eso no se puede ni escribir.
 *
 * Todo lo de aquí es puro. Quien lee la base y escribe es `monedero-service`.
 */

/** Los cuatro movimientos, y qué le hacen al saldo. */
export const SIGNO_DEL_MOVIMIENTO = {
  /** El socio ingresa dinero. Lo apunta la operadora al ver la transferencia. */
  topup: 1,
  /** Una venta lo gasta. */
  consumption: -1,
  /** Una cancelación devuelve lo que aquella venta gastó. */
  refund: 1,
  /**
   * Una corrección a mano, siempre con motivo.
   *
   * Resta, porque un ajuste que SUMA es una recarga y tiene que entrar por la
   * puerta de las recargas, donde queda el número de la transferencia. Un
   * ajuste positivo sería la forma de regalarle saldo a un socio sin que se vea
   * de dónde salió.
   */
  adjustment: -1,
} as const;

export type TipoDeMovimiento = keyof typeof SIGNO_DEL_MOVIMIENTO;

export const TIPOS_DE_MOVIMIENTO = Object.keys(SIGNO_DEL_MOVIMIENTO) as TipoDeMovimiento[];

export interface MovimientoDeMonedero {
  movement_type?: string | null;
  amount?: number | string | null;
  currency?: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * El saldo: la suma de los movimientos, con el signo de cada tipo.
 *
 * Un movimiento de tipo desconocido NO se cuenta, y no es una omisión: si
 * mañana alguien añade un tipo a la base sin añadirlo aquí, contarlo como suma
 * le regalaría saldo al socio y contarlo como resta se lo quitaría. Las dos
 * cosas son peor que dejarlo fuera y que el descuadre se vea al comparar con el
 * listado.
 */
export function saldoDe(movimientos: MovimientoDeMonedero[] | null | undefined): number {
  if (!movimientos?.length) return 0;
  let total = 0;
  for (const m of movimientos) {
    const signo = SIGNO_DEL_MOVIMIENTO[(m.movement_type ?? "") as TipoDeMovimiento];
    if (!signo) continue;
    // En valor absoluto: el signo es del tipo. Si una fila vieja o escrita a
    // mano trae el importe negativo, tomarlo tal cual invertiría el movimiento.
    total += signo * Math.abs(num(m.amount));
  }
  return round2(total);
}

/** Cómo paga este socio. Se declara en la relación, igual que `pricing_model`. */
export type ModoDePago = "credit" | "prepaid";

/**
 * Lo desconocido es CRÉDITO.
 *
 * Es lo que hace hoy el sistema con todos los socios. Entender el hueco como
 * prepago les cortaría la venta a todos de golpe el día del despliegue — con
 * saldo cero, que es como nacerían todos los monederos.
 */
export function modoDePago(relacion: { payment_mode?: string | null } | null | undefined): ModoDePago {
  return relacion?.payment_mode === "prepaid" ? "prepaid" : "credit";
}

export function esPrepago(relacion: { payment_mode?: string | null } | null | undefined): boolean {
  return modoDePago(relacion) === "prepaid";
}

export interface VeredictoDeSaldo {
  allowed: boolean;
  saldo: number;
  importe: number;
  /** Lo que quedaría. Negativo cuando no llega — el socio quiere ver cuánto le falta. */
  despues: number;
  reason: string | null;
}

/**
 * ¿Le llega el saldo para esta venta?
 *
 * No hay descubierto: el prepago es prepago, y dejar pasar «solo esta» es cómo
 * un depósito se convierte en un crédito que nadie pactó. Quien quiera vender a
 * deber tiene el otro modo.
 *
 * El céntimo de tolerancia es el mismo que usa `creditCheck`, y por lo mismo:
 * los redondeos de una venta con varias líneas no pueden tumbarla por 0,004.
 */
export function puedeGastar(saldo: number, importe: number): VeredictoDeSaldo {
  const tengo = round2(num(saldo));
  const gasto = round2(Math.max(num(importe), 0));
  const despues = round2(tengo - gasto);

  if (despues < -0.009) {
    return {
      allowed: false, saldo: tengo, importe: gasto, despues,
      reason: `Saldo insuficiente: tienes ${tengo} y esta venta necesita ${gasto}. Te faltan ${round2(gasto - tengo)}.`,
    };
  }
  return { allowed: true, saldo: tengo, importe: gasto, despues, reason: null };
}

/**
 * Qué le pasa a un movimiento antes de escribirlo. Devuelve el motivo o `null`.
 *
 * LA MONEDA ES LO QUE MÁS CALLA. Un monedero en dólares al que se le apunta una
 * recarga en pesos suma 30.000 a un saldo de dólares: el socio cree que tiene
 * treinta mil y la operadora descubre el agujero liquidando. Se rechaza, y no
 * se convierte: convertir aquí sería inventarse un tipo de cambio que nadie
 * pactó y enterrarlo en una fila.
 */
export function movimientoInvalido(
  movimiento: { movement_type?: string | null; amount?: number | string | null; currency?: string | null },
  monedaDelMonedero: string
): string | null {
  const tipo = (movimiento.movement_type ?? "") as TipoDeMovimiento;
  if (!SIGNO_DEL_MOVIMIENTO[tipo]) return "Tipo de movimiento desconocido.";

  const importe = num(movimiento.amount);
  // Cero no es un movimiento: es una fila que ensucia el listado sin decir
  // nada. Y negativo es la puerta de atrás — el signo lo pone el tipo.
  if (!(importe > 0)) return "El importe tiene que ser mayor que cero.";
  if (importe !== Math.abs(importe)) return "El importe se escribe en positivo; el signo lo pone el tipo.";

  const moneda = String(movimiento.currency || "").trim().toLowerCase();
  const esperada = String(monedaDelMonedero || "").trim().toLowerCase();
  if (!moneda) return "Indica la moneda del movimiento.";
  if (!esperada) return "El monedero no tiene moneda declarada.";
  if (moneda !== esperada) {
    return `El monedero está en ${esperada.toUpperCase()} y el movimiento viene en ${moneda.toUpperCase()}.`;
  }
  return null;
}
