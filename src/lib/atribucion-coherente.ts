/**
 * EL VENDEDOR DE UNA VENTA TIENE QUE SER DE QUIEN LA VENDE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO
 *
 * El punto de venta ofrece dos desplegables independientes —«Vendedor» y
 * «Partner»— y los mandaba tal cual. Nada comprobaba que encajaran, así que se
 * podía registrar una venta del tour center A atribuida a un vendedor del tour
 * center B, o a un vendedor interno de la operadora.
 *
 * No es un error de etiqueta: detrás del vendedor va la COMISIÓN. El motor la
 * calcula sobre `seller_id` sin volver a mirar de quién es la venta, así que la
 * plata se le paga a quien no vendió — y el tour center que sí vendió reclama
 * la suya, con razón, en la liquidación del mes siguiente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTRECHAR EL DESPLEGABLE NO ES CERRARLO
 *
 * La pantalla se acota también, para no ofrecer algo que la API va a rechazar.
 * Pero la pantalla no es la barrera: los dos identificadores viajan en el
 * cuerpo de la petición y cualquiera puede escribir otros. La regla vive aquí,
 * es pura, y la aplica el servicio de venta.
 */

/** Lo que hace falta saber de la ficha para decidir. */
export interface FichaVendedor {
  _id?: string;
  id?: string;
  partner?: unknown;
  first_name?: string | null;
  last_name?: string | null;
  code?: string | null;
}

function idDe(ref: unknown): string | null {
  if (typeof ref === "string") return ref || null;
  if (ref && typeof ref === "object") {
    const row = ref as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function nombreDe(ficha: FichaVendedor): string {
  return [ficha.first_name, ficha.last_name].filter(Boolean).join(" ") || ficha.code || "ese vendedor";
}

/**
 * ¿Encaja esta ficha con este socio? `null` cuando sí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA NO ES SIMÉTRICA, Y LA PRIMERA VERSIÓN LO FUE
 *
 * La tentación es exigir que los dos coincidan siempre. Está mal, y lo cazó una
 * prueba que ya existía: **el vendedor de la casa SÍ puede cerrar la venta de
 * un tour center**. Es el caso normal —el conserje trae al cliente, el vendedor
 * del mostrador remata— y el motor de comisiones lo soporta a propósito:
 * genera dos, una para el socio y otra para el vendedor, cada uno la suya.
 * Prohibirlo habría roto una forma de vender que ya estaba en producción.
 *
 * Lo que no puede pasar es lo otro: que una ficha que **pertenece a un tour
 * center** figure en la venta de otro, o en una venta propia. Ahí no hay
 * reparto que explicar, hay una comisión pagada a quien no vendió.
 *
 * Devuelve el MENSAJE en vez de un booleano porque los dos desajustes se
 * arreglan de maneras distintas y quien los lee está en mitad de una venta; un
 * «datos inválidos» le obliga a adivinar cuál de las dos.
 */
export function desajusteDeAtribucion(
  ficha: FichaVendedor | null | undefined,
  partnerId: string | null | undefined
): string | null {
  // Sin ficha no hay nada que comprobar: una venta sin vendedor es legítima
  // —la venta directa de la empresa o del tour center— y es el caso común.
  if (!ficha) return null;

  const socioDeLaFicha = idDe(ficha.partner);
  // El vendedor de la casa vale para cualquier venta, propia o de un socio.
  if (!socioDeLaFicha) return null;

  const socioDeLaVenta = (partnerId || "").trim() || null;
  if (socioDeLaFicha === socioDeLaVenta) return null;

  if (!socioDeLaVenta) {
    return `${nombreDe(ficha)} pertenece a un tour center: no puede figurar como vendedor de una venta propia`;
  }
  return `${nombreDe(ficha)} es de otro tour center`;
}
