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
 * El saldo de un socio.
 *
 * Se suman TODOS los movimientos, no los `LIMITE` últimos: un saldo calculado
 * sobre una página es un saldo que crece solo cuando el socio lleva más de
 * quinientos movimientos, y crece hacia arriba —se pierden consumos viejos—,
 * que es el lado caro del error.
 */
export async function saldoDeSocio(companyId: string, partnerId: string): Promise<number> {
  const todos = await tenantQuery<MovimientoGuardado>(companyId, "partner_wallet_movement", {
    _filter: { partner: partnerId },
    _limit: 100_000,
  });
  return saldoDe(todos);
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
  importe: number
): Promise<VeredictoDeSaldo> {
  const saldo = await saldoDeSocio(companyId, partnerId);
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
