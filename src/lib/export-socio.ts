/**
 * LO QUE PUEDE SALIR EN UN ARCHIVO DEL TOUR CENTER. POR LISTA BLANCA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL EXPORTADOR NO SABE RECORTAR COLUMNAS
 *
 * `exportColumns` arma las cabeceras con **las claves que traigan las filas**.
 * Es lo correcto para el ERP interno —quien exporta quiere todo lo que tiene—
 * y es exactamente lo contrario de lo que hace falta para un actor externo: el
 * archivo se lleva cualquier columna que un día se añada a la tabla, sin que
 * nadie decida que podía salir.
 *
 * El recorte por campos (`field-projection.ts`) tampoco alcanza: ése quita lo
 * que se declaró sensible, y aquí el problema es al revés — lo que no se
 * declaró **nada**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FALLA POR OMISIÓN, Y ESA ES TODA LA GRACIA
 *
 * Un recurso sin lista no exporta: devuelve un 403 que se entiende. La
 * alternativa —exportar todo mientras nadie declare nada— convierte cada tabla
 * nueva en una fuga silenciosa que se descubre cuando ya está en el Excel de
 * alguien.
 *
 * Por eso la lista es corta a propósito. No están las tablas del catálogo
 * compartido: el socio las CONSULTA en su pantalla, y no se ha pedido
 * llevárselas. El día que haga falta, se añaden con su lista delante.
 */

export const EXPORT_SOCIO: Record<string, readonly string[]> = {
  /**
   * Sus reservas. Sin `cost_amount` ni márgenes: son de la operadora, y en un
   * archivo no hay quien los esconda después.
   */
  booking: [
    "booking_number", "status", "travel_date", "customer", "product", "modality",
    "adults", "children", "infants", "pax_total",
    "pickup_hotel", "pickup_time", "room_number",
    "total_amount", "paid_amount", "balance_amount", "currency",
    "voucher_code", "createdAt",
  ],
  /** Sus ventas, por cabecera. */
  order: [
    // Las columnas de la orden NO se llaman como las de la reserva: aquí son
    // `total`, `paid_total` y `balance`. Lo cazó la guarda que compara la lista
    // contra el esquema reconstruido de las migraciones — escritas de oído,
    // esas tres columnas simplemente no habrían salido en el archivo.
    "order_number", "status", "customer", "channel",
    "subtotal", "discount_total", "total", "paid_total", "balance",
    "currency", "createdAt",
  ],
  /**
   * Su comisión. `rule` se queda fuera: qué regla se aplicó es la política
   * comercial de la operadora, y el socio tiene el importe y la base.
   */
  commission: [
    // `percentage`, no `rate`: mismo caso.
    "status", "beneficiary_type", "booking", "base_amount", "percentage", "amount",
    "currency", "service_date", "generated_at",
  ],
  /** Sus liquidaciones, tal y como las ve en su pantalla. */
  settlement: [
    "code", "status", "period_from", "period_to",
    "sales_total", "cancellations_total", "base_total", "commission_total",
    "paid_total", "pending_total", "currency", "issued_at", "paid_at",
  ],
  /** Su cuenta con la operadora. */
  receivable: [
    "document_number", "status", "issue_date", "due_date",
    "amount", "paid_amount", "balance", "currency",
  ],
  /**
   * Su propia cartera. Es suya y se la puede llevar —es el argumento de fondo
   * de todo el portal—, pero sin las columnas internas de la operadora:
   * `assigned_seller` es un vendedor de la casa, `tags` y `preferences` son
   * anotaciones comerciales suyas.
   */
  customer: [
    "first_name", "last_name", "email", "phone", "whatsapp",
    "nationality", "language", "country", "document_id", "createdAt",
  ],
  /**
   * Su equipo de ventas. Sin `commission_pct` ni `monthly_goal`: el archivo lo
   * abre cualquiera de su oficina, y lo que cobra cada uno no es un dato de
   * mostrador. Quien lo dirige lo ve en pantalla, donde hay una sesión detrás.
   */
  seller: [
    "code", "first_name", "last_name", "email", "phone", "status", "hire_date",
  ],
};

/**
 * Las columnas que puede llevarse, o `null` si ese recurso no lo ha declarado.
 *
 * `null` no es «ninguna»: es «esto no se ha decidido», y quien llama tiene que
 * negar. Devolver una lista vacía habría producido un archivo con cabeceras y
 * sin datos, que parece un error del sistema en vez de una decisión.
 */
export function columnasParaSocio(resource: string): readonly string[] | null {
  return EXPORT_SOCIO[resource] ?? null;
}
