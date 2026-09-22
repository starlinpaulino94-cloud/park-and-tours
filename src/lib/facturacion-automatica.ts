/**
 * CUÁNDO SE EMITE LA FACTURA SOLA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE ESTO TAPA
 *
 * El sistema sabía facturar —`invoice-service.ts` emite con su NCF, su ITBIS y
 * su secuencia— pero el punto de venta no lo llamaba NUNCA. Se cobraba y no
 * salía factura. Toda la máquina fiscal estaba montada y sin enchufar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ AL QUEDAR SALDADA Y NO AL PRIMER ABONO
 *
 * Un NCF no es un número cualquiera: consume secuencia, se declara en el 607 y
 * deshacerlo exige una nota de crédito que consume OTRO. Facturar en el primer
 * abono de una venta que luego se cancela deja dos comprobantes quemados y un
 * 607 que hay que explicar.
 *
 * Esperar a que la venta quede saldada evita eso sin perder ninguna factura:
 * el cliente que paga completo —que en un mostrador es casi siempre— la recibe
 * en el acto, y el que abona a cuenta la recibe cuando termina de pagar.
 *
 * La regla vive aquí, en una función pura y probada, y no dentro de la ruta de
 * cobros: el día que el negocio decida facturar al primer abono, se cambia en
 * un sitio con pruebas que dicen qué se está cambiando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y NUNCA TUMBA UN COBRO
 *
 * Quien llama tiene que tratar el fallo al facturar como mejor esfuerzo. Si la
 * secuencia de NCF está agotada, el dinero ENTRÓ igual: perder el registro del
 * cobro porque no se pudo emitir el comprobante convierte un problema
 * administrativo en un descuadre de caja. Se registra el cobro, se avisa del
 * fallo, y la factura se emite a mano cuando haya secuencia.
 */

/** Tolerancia de un centavo: los importes son numeric(14,2). */
const CENTAVO = 0.009;

export type TipoCobro = "payment" | "deposit" | "refund" | "credit_note" | string;

export interface OrdenParaFacturar {
  /** Total de la venta. */
  total?: number | null;
  /** Cobrado DESPUÉS de aplicar este pago. */
  paid_total?: number | null;
  status?: string | null;
}

export type MotivoNoFacturar =
  | "es_devolucion"
  | "sin_orden"
  | "venta_anulada"
  | "sin_importe"
  | "queda_saldo";

export const MOTIVO_TEXTO: Record<MotivoNoFacturar, string> = {
  es_devolucion: "es una devolución, no una venta",
  sin_orden: "el cobro no está aplicado a ninguna orden",
  venta_anulada: "la venta está anulada",
  sin_importe: "la venta no tiene importe que facturar",
  queda_saldo: "la venta todavía tiene saldo pendiente",
};

/**
 * Estados de la ORDEN (`sales_order`) que ya no se facturan: lo que se anuló no
 * se documenta como vendido.
 *
 * Son los de la orden y no los de la reserva, que es otra lista: el enum de
 * `sales_order` no tiene `partially_refunded` —una orden no se reembolsa a
 * medias—, así que esta lista está completa tal cual.
 */
const ESTADOS_MUERTOS = new Set(["cancelled", "canceled", "refunded", "void", "voided"]);

/** Cobros que devuelven dinero. La misma lista que usa el cierre del día. */
const DEVUELVEN = new Set(["refund", "credit_note"]);

export interface DecisionFactura {
  facturar: boolean;
  motivo: MotivoNoFacturar | null;
}

/**
 * ¿Toca emitir la factura de esta orden con este cobro?
 *
 * `orden` tiene que traer los totales YA actualizados con el pago; si no, una
 * venta recién saldada seguiría pareciendo que debe.
 */
export function decidirFactura(
  orden: OrdenParaFacturar | null | undefined,
  tipoCobro: TipoCobro,
): DecisionFactura {
  const no = (motivo: MotivoNoFacturar): DecisionFactura => ({ facturar: false, motivo });

  if (DEVUELVEN.has(String(tipoCobro ?? "").toLowerCase())) return no("es_devolucion");
  if (!orden) return no("sin_orden");
  if (ESTADOS_MUERTOS.has(String(orden.status ?? "").toLowerCase())) return no("venta_anulada");

  const total = Number(orden.total ?? 0);
  if (!Number.isFinite(total) || total <= CENTAVO) return no("sin_importe");

  const cobrado = Number(orden.paid_total ?? 0);
  if (!Number.isFinite(cobrado) || total - cobrado > CENTAVO) return no("queda_saldo");

  return { facturar: true, motivo: null };
}

/** El texto del registro, para que la bitácora diga por qué no se facturó. */
export function explicarDecision(d: DecisionFactura): string {
  return d.facturar
    ? "la venta quedó saldada"
    : MOTIVO_TEXTO[d.motivo ?? "sin_orden"] ?? "motivo desconocido";
}
