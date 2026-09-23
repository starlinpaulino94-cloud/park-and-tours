/**
 * QUÉ PUEDE VENDER CADA TOUR CENTER. LA DECISIÓN, PURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LISTA VACÍA YA NO ES «TODO»
 *
 * El catálogo del portal hacía esto:
 *
 *     const authorizedIds = (partner.authorized_products || []).map(...)
 *     ...(authorizedIds.length ? { _id: { in: authorizedIds } } : {})
 *
 * Sin autorizaciones, sin filtro. Y como `authorized_products` no existía en
 * ninguna tabla ni en el mapa de relaciones, la lista estaba vacía SIEMPRE: el
 * filtro no se aplicó nunca, ni una vez, desde que se escribió esa línea.
 *
 * Desde 0077 la lista existe y se siembra con el catálogo entero, así que
 * «vacía» pasa a significar lo que dice: este socio no tiene nada autorizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE APLICA AL VENDER, NO SOLO AL LISTAR
 *
 * Es la mitad que faltaba. Acotar el catálogo esconde el producto de una
 * pantalla; la reserva llega por el cuerpo de una petición con un
 * `product_id` dentro, y por la API de socios ni siquiera pasa por esa
 * pantalla. Un filtro de listado es una sugerencia.
 */

export interface AutorizacionSocio {
  product?: unknown;
  product_id?: unknown;
  status?: string | null;
}

function idDe(ref: unknown): string | null {
  if (typeof ref === "string") return ref || null;
  if (ref && typeof ref === "object") {
    const fila = ref as { _id?: unknown; id?: unknown };
    const valor = fila._id ?? fila.id;
    return typeof valor === "string" ? valor : null;
  }
  return null;
}

/**
 * Los productos que este socio tiene autorizados, en un conjunto.
 *
 * Solo los activos: desautorizar pone la fila inactiva en vez de borrarla, para
 * que quede el rastro de que ese producto estuvo autorizado — es lo que se mira
 * cuando un socio reclama una reserva que «antes sí podía hacer».
 */
export function autorizadosDe(filas: AutorizacionSocio[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const fila of filas ?? []) {
    if (fila.status && fila.status !== "active") continue;
    const id = idDe(fila.product ?? fila.product_id);
    if (id) out.add(id);
  }
  return out;
}

/**
 * Los productos de la venta que este socio NO tiene autorizados.
 *
 * Devuelve la lista entera y no el primero: quien reserva por API manda un
 * carrito de una vez, y contestarle de uno en uno le obliga a reintentar tantas
 * veces como productos prohibidos lleve — descubriendo su contrato a base de
 * errores.
 */
export function noAutorizados(
  productIds: (string | null | undefined)[],
  autorizados: Set<string>
): string[] {
  const fuera: string[] = [];
  for (const id of productIds) {
    if (!id || autorizados.has(id)) continue;
    if (!fuera.includes(id)) fuera.push(id);
  }
  return fuera;
}

/**
 * El mensaje, con los nombres cuando se saben.
 *
 * Un 403 con uuids dentro obliga a quien integra a cruzarlos a mano contra su
 * catálogo para entender qué le están negando.
 */
export function mensajeNoAutorizado(
  fuera: string[],
  nombres: Map<string, string> = new Map()
): string {
  const lista = fuera.map((id) => nombres.get(id) || id).join(", ");
  return fuera.length === 1
    ? `No tienes autorizada la venta de ${lista}. Pídesela a tu operador.`
    : `No tienes autorizada la venta de: ${lista}. Pídeselas a tu operador.`;
}
