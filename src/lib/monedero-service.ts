import "server-only";
import { tenantQuery, tenantCreate, TenantError } from "@/lib/tenant";
import {
  saldoDe, puedeGastar, movimientoInvalido,
  type MovimientoDeMonedero, type TipoDeMovimiento, type VeredictoDeSaldo,
} from "@/lib/monedero-socio";

/**
 * EL MONEDERO CONTRA LA BASE.
 *
 * Aquí solo se lee y se escribe. Las reglas —el signo de cada tipo, que no hay
 * descubierto, que la moneda tiene que coincidir— viven en `monedero-socio.ts`
 * y se prueban sin base de datos.
 */

export interface MovimientoGuardado extends MovimientoDeMonedero {
  _id?: string;
  movement_type?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  order_id?: string | null;
  reference?: string | null;
  note?: string | null;
  created_at?: string | null;
}

const LIMITE = 500;

/** Los movimientos de un socio, lo más nuevo arriba. */
export async function movimientosDe(
  companyId: string,
  partnerId: string,
  limite = LIMITE
): Promise<MovimientoGuardado[]> {
  return tenantQuery<MovimientoGuardado>(companyId, "partner_wallet_movement", {
    _filter: { partner: partnerId },
    _sort: { created_at: "desc" },
    _limit: limite,
  });
}

/**
 * LA MONEDA DEL MONEDERO SALE DEL CONTRATO, NUNCA DEL MOVIMIENTO.
 *
 * Vive aquí y no en cada llamante porque son cinco —la pantalla del socio, la de
 * la operadora, el resumen del portal, la venta y la cancelación— y la moneda
 * tiene que ser la misma en los cinco. Con cada uno resolviéndola a su manera, el
 * saldo que se enseña y el saldo con el que se autoriza una venta pueden ser
 * números distintos.
 */
export async function monedaDelMonederoDe(
  companyId: string,
  partnerId: string
): Promise<string | null> {
  const [socio] = await tenantQuery<{ currency?: string | null }>(companyId, "partner", {
    _filter: { _id: partnerId }, _limit: 1,
  });
  const moneda = String(socio?.currency || "").trim().toLowerCase();
  return moneda || null;
}

/**
 * El saldo de un socio.
 *
 * Se suman TODOS los movimientos, no los `LIMITE` últimos: un saldo calculado
 * sobre una página es un saldo que crece solo cuando el socio lleva más de
 * quinientos movimientos, y crece hacia arriba —se pierden consumos viejos—,
 * que es el lado caro del error.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE SUMA UNA SOLA MONEDA
 *
 * `saldoDe` suma lo que se le dé, sin mirar la moneda — es su contrato y está
 * bien. Lo que faltaba es que ALGUIEN filtrara antes, y nadie lo hacía: el saldo
 * salía de sumar todos los movimientos del socio, así que una fila en otra moneda
 * sumaba 30.000 pesos a un saldo de dólares. El módulo puro avisa de ese escenario
 * en su cabecera y lo defendía solo al ESCRIBIR; al leer —que es lo que autoriza
 * la venta— no había nada.
 *
 * Y una fila en otra moneda no se ignora en silencio: es dinero que nadie puede
 * cuadrar, y queda dicho en la consola para que se vea al investigar el descuadre.
 */
export async function saldoDeSocio(
  companyId: string,
  partnerId: string,
  moneda?: string | null
): Promise<number> {
  const todos = await tenantQuery<MovimientoGuardado>(companyId, "partner_wallet_movement", {
    _filter: { partner: partnerId },
    _limit: 100_000,
  });

  const delMonedero = (moneda ?? (await monedaDelMonederoDe(companyId, partnerId)) ?? "").toLowerCase();
  // Sin moneda declarada no se puede filtrar sin inventarse una: se suma todo y
  // se dice, que es lo mismo que hacía antes pero sabiéndolo.
  if (!delMonedero) {
    console.error(`[monedero] el socio ${partnerId} no tiene moneda declarada: el saldo suma todas.`);
    return saldoDe(todos);
  }

  const suyos = todos.filter((m) => String(m.currency || "").toLowerCase() === delMonedero);
  if (suyos.length !== todos.length) {
    console.error(
      `[monedero] el socio ${partnerId} tiene ${todos.length - suyos.length} movimiento(s) ` +
      `en otra moneda que ${delMonedero.toUpperCase()}: no entran en el saldo y hay que cuadrarlos a mano.`
    );
  }
  return saldoDe(suyos);
}

/**
 * Impide que un socio prepago venda por encima de su saldo.
 *
 * 402 y no 403: no le faltan permisos —le falta dinero—, y el mensaje dice
 * cuánto, que es lo que necesita para ir a transferirlo.
 */
export async function assertSaldo(
  companyId: string,
  partnerId: string,
  importe: number,
  /**
   * La moneda de la VENTA, para compararla con la del monedero.
   *
   * Es el parámetro que faltaba, y su ausencia dejaba muerta la única
   * comprobación que importa. La venta llamaba a `descontarVenta` pasando la
   * moneda de la venta COMO moneda del monedero, así que se comparaba consigo
   * misma — exactamente lo que el comentario de `apuntarMovimiento` dice que no
   * puede hacerse nunca—. Una venta en pesos contra un monedero en dólares pasaba
   * el control y descontaba 30.000 de un saldo en dólares.
   *
   * Y se comprueba AQUÍ, antes de la venta, no al descontar: `descontarVenta` se
   * traga sus errores a propósito —el cliente ya tiene su voucher— así que un
   * rechazo allí no impide nada. La barrera tiene que estar delante.
   */
  monedaDeLaVenta?: string | null
): Promise<VeredictoDeSaldo> {
  const delMonedero = await monedaDelMonederoDe(companyId, partnerId);
  if (!delMonedero) {
    throw Object.assign(new TenantError(
      "Este socio es prepago y su contrato no declara moneda: no se puede autorizar la venta contra su saldo.",
      409
    ), { code: "WALLET_NO_CURRENCY" });
  }

  const deLaVenta = String(monedaDeLaVenta || "").trim().toLowerCase();
  if (deLaVenta && deLaVenta !== delMonedero) {
    throw Object.assign(new TenantError(
      `El monedero está en ${delMonedero.toUpperCase()} y esta venta va en ${deLaVenta.toUpperCase()}: ` +
      "no se puede descontar sin un tipo de cambio pactado.",
      409
    ), { code: "WALLET_CURRENCY_MISMATCH", monedero: delMonedero, venta: deLaVenta });
  }

  const saldo = await saldoDeSocio(companyId, partnerId, delMonedero);
  const veredicto = puedeGastar(saldo, importe);
  if (!veredicto.allowed) {
    throw Object.assign(new TenantError(veredicto.reason || "Saldo insuficiente", 402), {
      code: "WALLET_INSUFFICIENT",
      saldo: veredicto.saldo,
      faltan: Math.abs(veredicto.despues),
    });
  }
  return veredicto;
}

export interface NuevoMovimiento {
  partnerId: string;
  tipo: TipoDeMovimiento;
  importe: number;
  moneda: string;
  orderId?: string | null;
  bookingId?: string | null;
  referencia?: string | null;
  nota?: string | null;
  userId?: string | null;
}

/**
 * Apunta un movimiento, validando contra la moneda del monedero.
 *
 * LANZA si el movimiento es inválido, y eso es a propósito: al revés que el
 * consumo de cupo —que nunca tumba una venta porque un cupo mal configurado no
 * puede dejar a un cliente sin reserva—, aquí se está moviendo DINERO. Una
 * recarga que se traga su error deja al socio creyendo que ingresó y a la
 * operadora sin el apunte.
 */
export async function apuntarMovimiento(
  companyId: string,
  movimiento: NuevoMovimiento,
  /**
   * La moneda del MONEDERO, que es la de la relación comercial.
   *
   * Entra como parámetro aparte y no se toma del propio movimiento: comparar el
   * movimiento consigo mismo es una comprobación que no puede fallar nunca, y
   * la que hace falta es justamente la otra — un monedero en dólares al que se
   * le apunta una recarga en pesos suma 30.000 a un saldo de dólares.
   */
  monedaDelMonedero: string
): Promise<MovimientoGuardado> {
  const motivo = movimientoInvalido(
    { movement_type: movimiento.tipo, amount: movimiento.importe, currency: movimiento.moneda },
    monedaDelMonedero
  );
  if (motivo) throw new TenantError(motivo, 400);

  return tenantCreate<MovimientoGuardado>(companyId, "partner_wallet_movement", {
    partner: movimiento.partnerId,
    movement_type: movimiento.tipo,
    amount: Math.abs(Number(movimiento.importe)),
    currency: String(movimiento.moneda).toLowerCase(),
    order_id: movimiento.orderId ?? null,
    booking_id: movimiento.bookingId ?? null,
    reference: movimiento.referencia ?? null,
    note: movimiento.nota ?? null,
    created_by: movimiento.userId ?? null,
  });
}

/**
 * Descuenta una venta del monedero.
 *
 * VA AL FINAL, cuando la venta ya existe, igual que el consumo de cupo:
 * descontar antes y que la saga se compensara dejaría al socio pagando una
 * reserva que no llegó a nacer.
 *
 * Y NO tumba la venta si falla el apunte. Es la excepción a la regla de arriba,
 * y tiene motivo: en este punto el cliente ya tiene su reserva y su voucher, y
 * revertir todo por no poder escribir una fila de saldo sería cambiar un
 * descuadre —visible en el listado al día siguiente— por una reserva perdida
 * con el turista delante. El error queda en la consola y en el descuadre.
 *
 * El índice único de 0080 hace el resto: una orden descuenta UNA vez, aunque
 * esto se llame dos veces.
 */
export async function descontarVenta(
  companyId: string,
  movimiento: NuevoMovimiento,
  monedaDelMonedero: string
): Promise<MovimientoGuardado | null> {
  try {
    return await apuntarMovimiento(companyId, { ...movimiento, tipo: "consumption" }, monedaDelMonedero);
  } catch (err) {
    console.error(`[monedero] no se pudo descontar la venta de ${movimiento.partnerId}:`, err);
    return null;
  }
}

/**
 * Devuelve al monedero lo que una reserva cancelada había descontado.
 *
 * Por el importe de SU consumo, no por el total de la orden: cancelar una
 * reserva de una orden de tres no devuelve las tres. Y nunca tumba la
 * cancelación, por lo mismo que el consumo.
 */
export async function devolverAlMonedero(
  companyId: string,
  movimiento: NuevoMovimiento,
  monedaDelMonedero: string
): Promise<MovimientoGuardado | null> {
  if (!(Number(movimiento.importe) > 0)) return null;
  try {
    return await apuntarMovimiento(companyId, { ...movimiento, tipo: "refund" }, monedaDelMonedero);
  } catch (err) {
    console.error(`[monedero] no se pudo devolver el saldo de ${movimiento.partnerId}:`, err);
    return null;
  }
}
