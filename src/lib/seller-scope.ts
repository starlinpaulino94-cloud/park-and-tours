/**
 * EL ÁMBITO DEL VENDEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA
 *
 * El rol `seller` es el rango más bajo del ERP interno, y aun así veía las
 * ventas de TODA la empresa. La RLS aísla por `organization_id`, no por
 * persona; el armador de filtros (`erp-query.ts`) solo acotaba por socio B2B y
 * por sucursal. Con eso, cualquier vendedor podía pedir `/api/erp/order`,
 * `/api/erp/quote` o `/api/erp/lead` —o exportarlos a Excel por
 * `/api/export/*`— y llevarse la cartera completa: qué vendió cada compañero,
 * a quién, por cuánto, y con qué clientes está negociando.
 *
 * No hacía falta tocar la interfaz para verlo: bastaba con la dirección de la
 * API. El menú nunca ha sido la barrera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA: «LO MÍO, O LO DE NADIE»
 *
 * Un vendedor ve las filas atribuidas a él y las que no están atribuidas a
 * ningún vendedor. Nunca las de OTRO vendedor, que es exactamente lo que se
 * reportó.
 *
 * Las filas sin vendedor se dejan visibles a propósito, por dos razones que no
 * son negociables:
 *
 *  1. EL PUNTO DE VENTA NO SELLA AL VENDEDOR. `seller_id` en una orden sale de
 *     lo que se elige en el desplegable «Vendedor», que es opcional. Si las
 *     filas sin vendedor se escondieran, quien acaba de registrar una venta sin
 *     marcarse en ese desplegable no podría abrirla para cobrarla ni
 *     imprimirla: el sistema le negaría su propia venta un segundo después de
 *     hacerla.
 *  2. EL HISTÓRICO NO TIENE VENDEDOR. Lo registrado antes de que existiera esa
 *     atribución, lo que entra por el portal público y lo que carga un
 *     administrador no llevan vendedor. Esconderlo convertiría «separar a los
 *     vendedores» en «perder el historial de la empresa».
 *
 * Queda un residuo consciente: una venta que nadie atribuyó la siguen viendo
 * todos los vendedores. Es dato de la empresa, no de un compañero, y cerrarlo
 * de verdad exige sellar al vendedor en el momento de vender —que cambia a
 * quién se le paga la comisión, y por eso no se decide aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN FICHA DE VENDEDOR VINCULADA, TAMPOCO SE VE LO AJENO
 *
 * El ámbito necesita saber QUÉ vendedor es quien llama, y eso vive en
 * `seller.user_id` (`auth-context.ts` lo resuelve). Cuando la cuenta no está
 * vinculada a ninguna ficha, el ámbito NO se abre: se acota a «lo de nadie».
 *
 * Es la misma postura que ya tenía el panel, que con vendedor desconocido
 * consulta con un identificador nulo en vez de enseñarlo todo. Falla cerrado, y
 * el remedio está a la vista: vincular la cuenta desde la ficha del vendedor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE ACOTA, Y POR QUÉ
 *
 *  · `customer` — el libro de clientes es OPERATIVO: quien esté en el mostrador
 *    tiene que poder encontrar a un cliente que vuelve. `assigned_seller` es
 *    una preferencia comercial, no una propiedad; acotarlo haría que el
 *    vendedor B no encontrara al cliente de A y lo diera de alta otra vez. Un
 *    directorio lleno de clientes duplicados es peor —para el cliente y para
 *    los datos— que la exposición que evitaría.
 *  · `waitlist_entry` — es una cola de una salida. Quien atiende cuando se
 *    libera una plaza tiene que poder llamar al siguiente; acotarla por
 *    vendedor dejaría a un cliente sin llamar porque quien lo apuntó libra hoy.
 *  · `seller` — el directorio del equipo es compartido (el supervisor, el
 *    desplegable del punto de venta). Lo sensible ahí no son las FILAS sino
 *    dos COLUMNAS —`commission_pct` y `monthly_goal`—, y eso se arregla
 *    recortando campos, no filas. Queda pendiente y anotado.
 *  · `payment_schedule` — no tiene columna de vendedor: su vendedor es el de la
 *    orden, y la capa de consulta no filtra por columna de una tabla unida.
 */

import type { AppRole } from "@/lib/auth";

/**
 * Qué tablas se acotan, y por qué campo.
 *
 * Se usan los nombres del RECURSO (`order`, no `sales_order`): es lo que llega
 * en `def.table` y lo que traduce después el backend de datos. Escrito con el
 * nombre de Postgres, las ventas no se habrían acotado nunca y nadie lo habría
 * notado —el mismo error que ya documenta `branch-scope.ts`.
 */
export const SELLER_SCOPED: Record<string, string> = {
  // La venta y su embudo.
  order: "seller",
  booking: "seller",
  quote: "seller",
  lead: "seller",
  // El dinero del vendedor. Hoy `READ_ROLE` ya los reserva a gerencia, así que
  // un vendedor ni llega a este filtro; están aquí para que el día que su
  // propio apartado los abra, nazcan acotados y no haya que acordarse.
  commission: "seller",
  settlement: "seller",
  payable: "seller",
  commission_rule: "seller",
  price_rule: "seller",
  // Metas, bonos, enlaces y atribución: el desempeño y la paga de cada uno.
  // Estos NO estaban gateados por rango, así que aquí sí había lectura abierta.
  seller_goal: "seller",
  seller_bonus: "seller",
  seller_link: "seller",
  seller_attribution: "seller",
};

export function isSellerScoped(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(SELLER_SCOPED, table);
}

/** Solo el rango más bajo se acota; de `cashier` hacia arriba se ve la empresa. */
export function sellerScopeApplies(role: AppRole): boolean {
  return role === "seller";
}

/**
 * El filtro para esta tabla y esta persona, o `null` cuando no hay que acotar.
 *
 * `null` significa «sin filtro» y ocurre en dos casos: el rol no es de
 * vendedor, o la tabla no tiene dimensión de vendedor. Nunca ocurre por no
 * saber quién es el vendedor: eso acota a «lo de nadie», que es lo contrario de
 * abrir.
 */
export function sellerFilterFor(
  table: string,
  role: AppRole,
  sellerId: string | null | undefined
): Record<string, unknown> | null {
  if (!sellerScopeApplies(role)) return null;
  const field = SELLER_SCOPED[table];
  if (!field) return null;
  // Sin ficha vinculada: solo lo que no es de ningún vendedor.
  if (!sellerId) return { [field]: null };
  return { _or: [{ [field]: sellerId }, { [field]: null }] };
}

/**
 * ¿Puede esta persona LEER esta fila concreta?
 *
 * El filtro de lista no protege el detalle: `tenantFindOne` solo comprueba la
 * empresa, así que sin esto bastaba con adivinar —o copiar de un informe— el
 * identificador de la orden de un compañero para abrirla entera. Es la misma
 * pareja que ya existe para el portal B2B (`partnerScopeFor` + la guarda del
 * detalle).
 *
 * Recibe el valor YA resuelto de la referencia (`refId`), porque la fila puede
 * traer la relación expandida como objeto o cruda como uuid, y quien llama es
 * el único que sabe cuál de las dos tiene.
 */
export function sellerCanReadRow(
  table: string,
  role: AppRole,
  sellerId: string | null | undefined,
  rowSellerId: string | null | undefined
): boolean {
  if (!sellerScopeApplies(role)) return true;
  if (!isSellerScoped(table)) return true;
  // Sin vendedor en la fila, la misma regla que en el listado: es de la empresa.
  if (!rowSellerId) return true;
  return Boolean(sellerId) && rowSellerId === sellerId;
}

/** El campo que identifica al vendedor de la fila, o null si la tabla no lo tiene. */
export function sellerFieldFor(table: string): string | null {
  return SELLER_SCOPED[table] ?? null;
}
