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

/**
 * DONDE «SIN VENDEDOR» NO SIGNIFICA «DE LA EMPRESA».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FALLO QUE ESTO EVITA, Y QUE ESTUVO A PUNTO DE COLARSE
 *
 * La regla «lo mío, o lo de nadie» es correcta para la VENTA: una orden sin
 * vendedor es una venta directa de la empresa —entró por la web, la registró un
 * administrador, viene del histórico— y esconderla sería perder el pasado.
 *
 * En el dinero es al revés, y la diferencia no se ve hasta que se mira el
 * esquema. `commission`, `settlement` y `payable` tienen `beneficiary_type`:
 * una fila sin `seller_id` no es «de nadie», es **de otro beneficiario** —de un
 * socio o de un proveedor—. Con la regla indulgente, abrirle las comisiones a
 * un vendedor le habría abierto de paso TODAS las comisiones de los tour
 * centers y TODAS las facturas de los proveedores, porque en esas filas el
 * vendedor es nulo.
 *
 * Lo mismo con las reglas: una `price_rule` o una `commission_rule` sin
 * vendedor es la regla GENERAL de la empresa, no una regla huérfana.
 *
 * Así que aquí la ausencia se lee como exclusión, no como pertenencia.
 */
export const SELLER_ESTRICTAS = new Set([
  "commission", "settlement", "payable", "commission_rule", "price_rule",
  "seller_goal", "seller_bonus", "seller_link", "seller_attribution",
]);

/**
 * El identificador que no es de nadie.
 *
 * Cuando la tabla es estricta y no se sabe qué vendedor es quien llama, el
 * filtro tiene que no traer NADA. Se usa un uuid imposible en vez de un
 * mecanismo aparte porque así el «no hay nada que enseñarte» viaja como un
 * filtro normal y funciona igual en el listado, en la exportación y dentro de
 * un `_and`. Es el mismo recurso que ya usa el panel para el vendedor
 * desconocido (`dashboard-metrics.ts`).
 */
export const NADIE = "00000000-0000-0000-0000-000000000000";

export function isSellerScoped(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(SELLER_SCOPED, table);
}

/** ¿Una fila sin vendedor es de la empresa (no) o de otro beneficiario (sí)? */
export function esEstricta(table: string): boolean {
  return SELLER_ESTRICTAS.has(table);
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

  // En las tablas del dinero, una fila sin vendedor es de OTRO beneficiario:
  // ahí solo lo suyo, y sin ficha vinculada, nada.
  if (esEstricta(table)) return { [field]: sellerId || NADIE };

  // En la venta, una fila sin vendedor es de la empresa. Sin ficha vinculada,
  // solo esas: no saber quién eres nunca abre el ámbito.
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
  // En las tablas del dinero, sin vendedor en la fila la respuesta es NO: esa
  // comisión o esa factura son de un socio o de un proveedor.
  if (!rowSellerId) return !esEstricta(table);
  return Boolean(sellerId) && rowSellerId === sellerId;
}

/**
 * ¿HAY UNA PERSONA CON RANGO DE VENDEDOR DETRÁS DE ESTA VENTA?
 *
 * De esta pregunta depende quién cobra la comisión, así que merece ser una
 * función con nombre y no una condición suelta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON MIRAR EL ROL
 *
 * Dos motores del sistema fabrican un contexto con rol `seller` y SIN usuario,
 * a propósito y documentado en su propio código: el motor de la web pública
 * (`public-booking-service.ts`) y el de las reservas de revendedor
 * (`octo-service.ts`). El rol ahí es «el rango mínimo que permite vender», no
 * una persona.
 *
 * Sellar por el rol a secas rompería justo lo que más importa: en la venta web
 * la atribución la resuelve la COOKIE del visitante —es lo único que encuentra
 * al conserje que compartió el enlace—, y sellarla al vendedor del contexto
 * (que no existe) la habría puesto en `null` y apagado el motor de atribución
 * entero, sin ningún error que lo delatara. El identificador de usuario vacío
 * es la marca que esos dos motores ya usan para decir «aquí no hay nadie».
 */
export function ventaSelladaPorVendedor(
  ctx: { role: AppRole; userId?: string | null }
): boolean {
  return sellerScopeApplies(ctx.role) && Boolean(ctx.userId);
}

/**
 * El vendedor que se le pone a lo que esta persona crea.
 *
 * Hermano de `branchStampFor`, y por el mismo motivo: lo que registra un
 * vendedor nace a su nombre. La diferencia está en que aquí el sello PISA lo
 * que venga en el payload en vez de respetarlo —un gerente creando algo para
 * otro vendedor está en su derecho y no se sella, pero un vendedor eligiendo a
 * otro vendedor no es una decisión legítima: es regalar o quedarse una
 * comisión—.
 *
 * Con la ficha sin vincular el sello es `null`, que es la verdad: el sistema no
 * sabe quién es. No se deja pasar el valor del cuerpo, porque entonces bastaría
 * con no vincular la ficha para poder atribuirse lo que sea.
 */
export function sellerStampFor(
  table: string,
  ctx: { role: AppRole; userId?: string | null; sellerId?: string | null },
  payload: Record<string, unknown>
): Record<string, unknown> {
  const field = SELLER_SCOPED[table];
  if (!field || field === "_id") return payload;
  if (!ventaSelladaPorVendedor(ctx)) return payload;
  return { ...payload, [field]: ctx.sellerId ?? null };
}

/**
 * LA MISMA REGLA, PERO PARA ACTUAR SOBRE UNA FILA.
 *
 * El ámbito nació de lectura, y con eso solo quedaba cerrada la mitad: las
 * acciones con impacto económico sobre una reserva o una cotización ajena
 * viven en rutas propias que nunca pasan por el CRUD genérico y solo miraban
 * el RANGO. `/api/bookings/:id/cancel` pedía rango de vendedor y no miraba de
 * quién era la reserva —y cancelar anula la comisión de quien vendió—.
 *
 * Lanza un error con `status` en vez de importar `TenantError`, para que este
 * módulo siga siendo puro y comprobable sin servidor. Es el mismo patrón que ya
 * usan las rutas de venta.
 */
export function assertSellerOwnsRow(
  table: string,
  ctx: { role: AppRole; userId?: string | null; sellerId?: string | null },
  record: Record<string, unknown> | null | undefined,
  etiqueta = "Este registro"
): void {
  if (!sellerScopeApplies(ctx.role)) return;
  const field = SELLER_SCOPED[table];
  if (!field || !record) return;
  const valor = record[field];
  const rowSellerId = valor && typeof valor === "object"
    ? ((valor as { _id?: string })._id ?? null)
    : ((valor as string | null | undefined) ?? null);
  if (sellerCanReadRow(table, ctx.role, ctx.sellerId, rowSellerId)) return;
  throw Object.assign(new Error(`${etiqueta} es de otro vendedor`), { status: 403 });
}

/** El campo que identifica al vendedor de la fila, o null si la tabla no lo tiene. */
export function sellerFieldFor(table: string): string | null {
  return SELLER_SCOPED[table] ?? null;
}
