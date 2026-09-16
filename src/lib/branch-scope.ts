/**
 * EL ALCANCE POR SUCURSAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA
 *
 * La pantalla de equipo pedía «Sucursal (opcional)» desde el principio y la API
 * la ignoraba: no se guardaba y no acotaba nada. El formulario prometía algo que
 * el sistema no hacía, que es peor que no ofrecerlo — quien lo usaba creía que
 * ya había separado sus puntos de venta, y el vendedor del centro A seguía
 * viendo, buscando y exportando las reservas del centro B.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES Y QUÉ NO ES
 *
 * No es la muralla entre empresas —esa es la RLS por `organization_id`, y no se
 * toca—. Es un alcance ORGANIZATIVO, y por eso se aplica tabla por tabla en la
 * capa de consulta: quien vende en una sucursal necesita ver el catálogo de
 * productos, los hoteles y las políticas, que son de toda la empresa. Acotarlo
 * todo por sucursal dejaría a esa persona sin poder vender.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS DECISIONES QUE EVITAN PERDER DATOS
 *
 *  1. SIN SUCURSAL SE VE TODO. El alcance es opcional por persona: quien no
 *     tiene una asignada trabaja como hasta hoy. Ninguna migración le quita
 *     acceso a nadie.
 *  2. LAS FILAS SIN SUCURSAL LAS VE TODO EL MUNDO. Un histórico anterior a esta
 *     separación no tiene sucursal puesta; esconderlo convertiría «separar mis
 *     puntos de venta» en «perder mi historial», y nadie lo activaría dos veces.
 */

/**
 * Qué tablas se acotan, y por qué campo.
 *
 * Están las que pertenecen a un punto de venta concreto. NO están los catálogos
 * —productos, hoteles, clientes, políticas, tarifas—: son de la empresa, y el
 * vendedor de cualquier sucursal los necesita enteros para trabajar.
 */
export const BRANCH_SCOPED: Record<string, string> = {
  booking: "branch",
  // `order`, no `sales_order`: aquí se usa el nombre del RECURSO, que es lo que
  // llega en `def.table`; la traducción a la tabla real de Postgres la hace el
  // backend de datos. Escrito con el nombre de la base, las ventas no se
  // habrían acotado nunca y nadie lo habría notado.
  order: "branch",
  departure: "branch",
  cash_register: "branch",
  cash_session: "branch",
  expense: "branch",
  staff: "branch",
  shift: "branch",
  asset: "branch",
  warehouse: "branch",
  vehicle: "branch",
  seller: "branch",
  pickup: "branch",
};

export function isBranchScoped(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(BRANCH_SCOPED, table);
}

/**
 * El filtro para esta tabla y esta persona, o `null` cuando no hay que acotar.
 *
 * `null` significa «sin filtro», y ocurre en los dos casos que importan: la
 * persona no tiene sucursal, o la tabla no es de sucursal. Devolver un filtro
 * vacío en vez de `null` sería equivalente, pero `null` deja claro en el sitio
 * que llama que aquí NO se está acotando nada.
 */
export function branchFilterFor(
  table: string,
  branchId: string | null | undefined
): Record<string, unknown> | null {
  if (!branchId) return null;
  const field = BRANCH_SCOPED[table];
  if (!field) return null;
  // «La mía o las que no son de ninguna»: el histórico sin sucursal sigue
  // visible, porque separar sucursales no puede significar perder el pasado.
  return { _or: [{ [field]: branchId }, { [field]: null }] };
}

/**
 * La sucursal que se le pone a lo que esta persona crea.
 *
 * Solo cuando la tabla es de sucursal, la persona tiene una y nadie eligió otra
 * explícitamente: un gerente creando una salida PARA otra sucursal está en su
 * derecho, y pisarle el dato sería devolverle un error silencioso.
 */
export function branchStampFor(
  table: string,
  branchId: string | null | undefined,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const field = BRANCH_SCOPED[table];
  if (!field || !branchId) return payload;
  if (payload[field]) return payload;
  return { ...payload, [field]: branchId };
}
