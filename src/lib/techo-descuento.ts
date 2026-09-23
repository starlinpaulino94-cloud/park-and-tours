/**
 * EL DESCUENTO MÁXIMO QUE UN VENDEDOR PUEDE DAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CAMPO EXISTÍA Y NO SERVÍA PARA NADA
 *
 * `seller.max_discount_pct` está en el esquema desde 0005, la pantalla lo pide
 * («Descuento máximo autorizado») y se guarda. No se aplicaba en NINGÚN
 * cálculo. O sea: la operadora configuraba un techo, creía haber acotado lo que
 * sus vendedores pueden regalar, y el sistema aceptaba un 90 % igual que un 5 %.
 *
 * Es de la misma familia que «el formulario pedía la sucursal y la API la
 * tiraba»: un campo que promete algo que no ocurre es peor que no ofrecerlo,
 * porque quien lo rellena deja de vigilar eso a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN TECHO DECLARADO NO HAY TECHO
 *
 * `null` es «nadie lo ha configurado», y no se convierte en cero. Un cero sí es
 * un techo —«esta persona no puede descontar»— y hay que poder expresarlo. Si
 * la ausencia valiera cero, activar esto le quitaría de golpe la capacidad de
 * descontar a todas las empresas que nunca rellenaron el campo, que son todas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UNA AUTORIZACIÓN DE QUIEN VENDE, NO DEL DUEÑO DE LA VENTA
 *
 * El techo lo tiene la persona que está delante del cliente decidiendo el
 * precio. Un gerente que registra una venta a nombre de un vendedor está
 * ejerciendo SU autorización, no la de esa ficha; por eso quien manda no tiene
 * techo, y por eso esto se resuelve con la ficha de quien opera.
 */

export interface LineaConDescuento {
  /** Para poder decir cuál de las líneas se pasó. */
  product_id?: string;
  discount_pct?: number | null;
}

export interface ExcesoDeDescuento {
  pedido: number;
  techo: number;
  productId: string | null;
}

/**
 * La primera línea que se pasa del techo, o `null` si ninguna.
 *
 * Se devuelve la línea y no un booleano para poder decir cuánto se pidió y
 * cuánto se permite: «no puedes» sin decir hasta dónde obliga a probar por
 * tanteo con el cliente delante.
 */
export function excesoDeDescuento(
  lineas: LineaConDescuento[],
  techo: number | null | undefined
): ExcesoDeDescuento | null {
  if (techo == null || !Number.isFinite(Number(techo))) return null;
  const limite = Number(techo);
  for (const linea of lineas ?? []) {
    const pedido = Number(linea.discount_pct ?? 0);
    if (!Number.isFinite(pedido) || pedido <= limite) continue;
    return { pedido, techo: limite, productId: linea.product_id ?? null };
  }
  return null;
}

/** El mensaje del rechazo, que tiene que decir hasta dónde SÍ se puede. */
export function mensajeExceso(exceso: ExcesoDeDescuento): string {
  return (
    `No puedes aplicar un ${exceso.pedido} % de descuento: tu autorización llega ` +
    `al ${exceso.techo} %. Pide a un supervisor que lo apruebe.`
  );
}
