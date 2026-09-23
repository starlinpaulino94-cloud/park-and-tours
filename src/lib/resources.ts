import type { ModuleKey } from "@/lib/types";
import "server-only";
import type { AppRole } from "@/lib/auth";
import { TenantError, atLeast, esDeSocio } from "@/lib/tenant";

/**
 * Registry of tables exposed through the generic REST layer
 * (`/api/erp/[resource]`). Anything not listed here is not reachable,
 * and every query is company-scoped by `tenantQuery`.
 */
export interface ResourceDef {
  table: string;
  /** Fields matched by the `?q=` search parameter. */
  search: string[];
  /** Relations expanded on list endpoints. */
  expand?: Record<string, unknown>;
  /** Relations expanded on the detail endpoint (defaults to `expand`). */
  expandOne?: Record<string, unknown>;
  /**
   * Lo que se expande en el detalle CUANDO quien consulta viene de un socio.
   *
   * Existe por un caso y se documenta para que no se use por otros: la ficha de
   * cliente arrastra en `expandOne` su historial completo —órdenes, reservas y
   * oportunidades—, que es «todo lo que esta persona le ha comprado nunca a la
   * operadora». El tour center tiene derecho a su ficha, no a la relación
   * entera. Y apoyarse en que la RLS filtre esas expansiones no vale: la capa
   * de datos habla por el rol de servicio cuando la RLS está apagada, y
   * entonces no filtra nadie.
   *
   * Sin declararlo, el detalle se comporta como siempre.
   */
  expandOnePartner?: Record<string, unknown>;
  /** Default sort. */
  sort?: Record<string, "asc" | "desc">;
  /** Fields accepted from the client on create/update. */
  writable: string[];
  /** Minimum role required to write. Reads require any authenticated tenant user. */
  writeRole?: AppRole;
  /**
   * Módulo del plan al que pertenece este recurso (0042).
   *
   * Solo acota la ESCRITURA. Una empresa que baja de plan sigue leyendo y
   * exportando lo que ya registró —sus comisiones y sus asientos son datos de
   * su negocio—, pero no puede seguir creando en un módulo que no tiene
   * contratado. Sin este campo, el recurso no está acotado por plan.
   */
  module?: ModuleKey;
  /** Fields coerced to numbers before writing. */
  numeric?: string[];
  /** Fields coerced to ISO dates before writing. */
  dates?: string[];
  /**
   * Campos que la base declara `boolean`.
   *
   * El formulario los ofrece como un `select` de sí/no, así que llegan como
   * "yes"/"no" y hay que convertirlos: Postgres acepta 'yes' por conversión,
   * pero la vuelta es `true`/`false` y ahí se rompía la insignia y el propio
   * formulario de edición. Declararlos aquí cierra el ciclo en un solo sitio.
   */
  booleans?: string[];
}


export const RESOURCES: Record<string, ResourceDef> = {
  branch: {
    table: "branch",
    search: ["name", "code", "city"],
    expand: { manager: true },
    sort: { name: "asc" },
    writable: ["name", "code", "branch_type", "address", "city", "phone", "email", "manager", "parent_branch", "status", "notes"],
    writeRole: "manager",
  },
  partner: {
    table: "partner",
    search: ["name", "commercial_name", "tax_id", "email", "contact_name"],
    expand: { parent_partner: true },
    expandOne: { parent_partner: true, seller: { _limit: 100 } },
    sort: { name: "asc" },
    writable: [
      "name", "commercial_name", "partner_type", "tax_id", "contact_name", "email", "phone", "whatsapp",
      "address", "city", "country", "credit_limit", "credit_days", "currency", "default_commission_pct",
      "logo_url", "status", "contract_from", "contract_to", "commercial_terms", "notes", "parent_partner",
      // Cómo gana este socio (0078). Lo declara la operadora al pactar, y es
      // lo que decide si además de su precio se le liquida comisión.
      "pricing_model",
    ],
    numeric: ["credit_limit", "credit_days", "default_commission_pct"],
    dates: ["contract_from", "contract_to"],
    writeRole: "manager",
  },
  /**
   * EL CONTRATO SOCIO–PRODUCTO (0077).
   *
   * Lo escribe la operadora desde la ficha del socio. No está en el ámbito del
   * socio —ni propia ni compartida—, así que él no lo lee por el CRUD genérico:
   * lo ve resuelto en su catálogo, que es donde le sirve. La lista de
   * autorizaciones de los demás tour centers es el mapa de qué vende cada uno.
   */
  partner_product: {
    table: "partner_product",
    search: [],
    expand: { partner: true, product: true },
    sort: { createdAt: "desc" },
    writable: ["partner", "product", "status"],
    writeRole: "manager",
  },
  seller: {
    table: "seller",
    search: ["first_name", "last_name", "code", "email", "phone"],
    expand: { partner: true, branch: true, supervisor: true },
    expandOne: { partner: true, branch: true, supervisor: true, user: true },
    sort: { first_name: "asc" },
    writable: [
      "user", "partner", "branch", "code", "first_name", "last_name", "email", "phone", "whatsapp",
      "seller_role", "commission_pct", "monthly_goal", "max_discount_pct", "currency", "photo_url",
      "hire_date", "status", "notes", "supervisor", "seller_type",
    ],
    numeric: ["commission_pct", "monthly_goal", "max_discount_pct"],
    dates: ["hire_date"],
    writeRole: "manager",
  },
  /**
   * Los ajustes de comisión (0059): se LEEN aquí y se escriben SOLO por
   * `/api/commissions/adjust`.
   *
   * `writable` vacío no es un descuido. Crear un ajuste por el CRUD genérico
   * escribiría la fila y dejaría `net_amount` de la comisión sin recalcular —
   * y un neto desfasado lo suma la liquidación del mes siguiente sin que nada
   * avise. La ruta dedicada escribe el ajuste, sincroniza el neto y deja
   * rastro, en ese orden.
   */
  commission_adjustment: {
    table: "commission_adjustment",
    search: ["reason"],
    expand: { commission: true, booking: true },
    sort: { created_at: "desc" },
    writable: [],
    writeRole: "manager",
  },
  product_bundle_item: {
    table: "product_bundle_item",
    search: [],
    expand: { bundle: true, product: true, modality: true },
    sort: { day_offset: "asc" },
    writable: [
      "bundle", "product", "modality", "day_offset", "sort_order",
      "fixed_time", "allow_overlap", "is_optional",
    ],
    numeric: ["day_offset", "sort_order"],
    booleans: ["allow_overlap", "is_optional"],
    writeRole: "manager",
  },
  seller_goal: {
    table: "seller_goal",
    search: ["name", "reward"],
    expand: { seller: true, seller_type: true, branch: true, product: true, category: true },
    sort: { created_at: "desc" },
    writable: [
      "name", "seller", "seller_type", "branch", "product", "category",
      "period", "period_from", "period_to",
      "target_signups", "target_bookings", "target_sales", "target_pax", "target_revenue",
      "currency", "reward", "status",
    ],
    numeric: ["target_signups", "target_bookings", "target_sales", "target_pax", "target_revenue"],
    dates: ["period_from", "period_to"],
    writeRole: "manager",
  },
  seller_bonus: {
    table: "seller_bonus",
    search: ["description", "notes"],
    expand: { seller: true, goal: true, settlement: true },
    sort: { awarded_at: "desc" },
    writable: [
      "seller", "goal", "description", "amount", "currency",
      "payout_kind", "status", "notes",
    ],
    numeric: ["amount"],
    writeRole: "manager",
  },
  seller_type: {
    table: "seller_type",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "status"],
    writeRole: "manager",
  },
  seller_link: {
    table: "seller_link",
    search: ["slug", "name", "campaign"],
    expand: { seller: true, product: true },
    sort: { created_at: "desc" },
    /**
     * `slug` NO es escribible, y esa es la decisión de 0071.
     *
     * Es único EN TODO EL SISTEMA —el índice es global, no por empresa—, así
     * que aceptarlo del navegador permitiría dos cosas: ocupar los nombres
     * bonitos del espacio compartido, y sobre todo IMITAR el de un compañero
     * (`MARISOL1` frente a `MARIS0L1`) para llevarse sus visitas. El cliente
     * teclea lo que ve en un cartel; no comprueba nada.
     *
     * Lo genera el servidor en `POST /api/attribution/links`. `seller` tampoco
     * se puede reapuntar: cambiarlo es trasladar la atribución —el dinero— de
     * una persona a otra, y eso lo gobierna `field-write-role.ts`.
     */
    writable: ["seller", "name", "channel", "product", "campaign", "status"],
    writeRole: "manager",
  },
  /**
   * El embudo se LEE y no se escribe: es un histórico, y la base lo sostiene
   * con un disparador (0058). `writable` vacío no es un descuido — es lo que
   * impide que el CRUD genérico abra una puerta que el esquema cierra.
   */
  seller_attribution: {
    table: "seller_attribution",
    search: ["visitor_id", "campaign"],
    expand: { seller: true, customer: true, seller_link: true },
    sort: { created_at: "desc" },
    writable: [],
    writeRole: "admin",
  },
  zone: {
    table: "zone",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "color", "status", "zone_type", "max_capacity",
      "current_occupancy", "requires_wristband", "pickup_offset_min"],
    numeric: ["max_capacity", "current_occupancy", "pickup_offset_min"],
    writeRole: "manager",
  },
  hotel: {
    table: "hotel",
    search: ["name", "address", "pickup_point"],
    expand: { zone: true },
    sort: { name: "asc" },
    writable: ["zone", "name", "address", "phone", "category", "pickup_point", "latitude", "longitude", "pickup_offset_min", "status", "notes"],
    numeric: ["latitude", "longitude", "pickup_offset_min"],
    writeRole: "operations",
  },
  product_category: {
    table: "product_category",
    search: ["name"],
    sort: { sort_order: "asc" },
    writable: ["name", "description", "color", "icon", "sort_order", "status"],
    numeric: ["sort_order"],
    writeRole: "manager",
  },
  cancellation_policy: {
    table: "cancellation_policy",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "tiers", "no_show_refund_pct", "status"],
    numeric: ["no_show_refund_pct"],
    writeRole: "manager",
  },
  product: {
    table: "product",
    search: ["name", "code", "location"],
    expand: { category: true, product_modality: { _limit: 30 } },
    expandOne: {
      category: true, cancellation_policy: true,
      product_modality: { _limit: 50, _sort: { sort_order: "asc" } },
      product_cost: { _limit: 50, supplier: true },
      price_rule: { _limit: 50, partner: true, modality: true },
      departure: { _limit: 30, _sort: { departure_at: "asc" } },
    },
    sort: { sort_order: "asc" },
    writable: [
      "category", "cancellation_policy", "name", "code", "product_type", "short_description", "description",
      "is_bundle", "bundle_buffer_minutes",
      "cover_image_url", "video_url", "location", "meeting_point", "duration_hours", "languages",
      "min_age", "default_capacity", "restrictions", "recommendations", "inclusions", "exclusions",
      "terms", "instructions", "base_price", "base_cost", "currency", "featured", "sort_order", "status",
      // 0039 — la política de cobro del producto: qué anticipo pide y con
      // cuántos días de antelación se liquida el saldo. Es lo que hace que el
      // plan salga solo en cada venta en vez de teclearse.
      "deposit_type", "deposit_percent", "deposit_amount", "balance_due_days",
      // 0047 — el motor público. `published` es el interruptor por producto:
      // hay excursiones que solo se venden a agencias y otras a medio armar,
      // así que publicar el catálogo entero por defecto sería enseñar lo que
      // nadie quiso enseñar, y eso no se deshace una vez indexado.
      "published", "public_price_from",
    ],
    numeric: [
      "duration_hours", "min_age", "default_capacity", "base_price", "base_cost", "sort_order",
      "deposit_percent", "deposit_amount", "balance_due_days", "public_price_from",
    ],
    booleans: ["is_bundle", "featured", "published"],
    writeRole: "manager",
  },
  product_modality: {
    table: "product_modality",
    search: ["name", "code"],
    expand: { product: true },
    sort: { sort_order: "asc" },
    writable: ["product", "name", "code", "modality_type", "price", "cost", "currency", "min_pax", "max_pax", "age_from", "age_to", "capacity_weight", "sort_order", "status"],
    numeric: ["price", "cost", "min_pax", "max_pax", "age_from", "age_to", "capacity_weight", "sort_order"],
    writeRole: "manager",
  },
  price_rule: {
    table: "price_rule",
    search: ["name"],
    expand: { product: true, modality: true, partner: true, seller: true },
    sort: { priority: "asc" },
    writable: ["product", "modality", "partner", "seller", "name", "price_type", "channel", "amount", "currency", "season_from", "season_to", "weekdays", "time_from", "time_to", "min_qty", "max_qty", "priority", "status"],
    numeric: ["amount", "min_qty", "max_qty", "priority"],
    dates: ["season_from", "season_to"],
    writeRole: "manager",
  },
  departure: {
    table: "departure",
    search: ["meeting_point"],
    expand: { product: true, branch: true },
    expandOne: {
      product: true, branch: true,
      booking: { _limit: 300, customer: true, pickup_hotel: true },
      departure_resource: { _limit: 50, vehicle: true, staff: true },
      pickup_route: { _limit: 50, vehicle: true, driver: true, guide: true, zone: true },
    },
    sort: { departure_at: "asc" },
    // SECURITY (AUD-B02/B16): `status` removed — it is derived by
    // `recalculateDeparture` from live bookings (available/full/closed).
    // Editing it through CRUD lets a user reopen a `full` departure and
    // oversell. Closing/cancelling a departure needs a dedicated action.
    writable: ["product", "branch", "departure_at", "departure_time", "capacity", "cutoff_hours", "meeting_point", "notes"],
    numeric: ["capacity", "cutoff_hours"],
    dates: ["departure_at"],
    writeRole: "operations",
  },
  customer: {
    table: "customer",
    search: ["first_name", "last_name", "email", "phone", "document_id"],
    expand: { hotel: true, assigned_seller: true },
    expandOne: {
      hotel: true, assigned_seller: true,
      booking: { _limit: 50, _sort: { createdAt: "desc" }, product: true, departure: true },
      order: { _limit: 50, _sort: { createdAt: "desc" } },
      lead: { _limit: 20, _sort: { createdAt: "desc" } },
    },
    // El socio ve la ficha, no el historial: esas tres expansiones son todo lo
    // que ese cliente le ha comprado nunca a la operadora, incluido lo que
    // compró por otro canal. `assigned_seller` tampoco: es un vendedor interno.
    expandOnePartner: { hotel: true },
    sort: { createdAt: "desc" },
    writable: [
      "hotel", "assigned_seller", "first_name", "last_name", "email", "phone", "whatsapp", "nationality",
      "language", "country", "room", "address", "document_id", "birth_date", "tags", "source",
      "status", "preferences", "notes",
    ],
    dates: ["birth_date"],
    writeRole: "seller",
  },
  lead: {
    table: "lead",
    search: ["name", "email", "phone"],
    expand: { customer: true, seller: true, product: true },
    expandOne: { customer: true, seller: true, product: true, partner: true, crm_activity: { _limit: 100, _sort: { createdAt: "desc" }, user: true } },
    sort: { createdAt: "desc" },
    writable: ["customer", "seller", "product", "partner", "name", "email", "phone", "whatsapp", "source", "status", "estimated_value", "currency", "pax", "travel_date", "next_action_at", "lost_reason", "notes"],
    numeric: ["estimated_value", "pax"],
    dates: ["travel_date", "next_action_at"],
    writeRole: "seller",
  },
  crm_activity: {
    table: "crm_activity",
    search: ["subject"],
    expand: { lead: true, customer: true, user: true },
    sort: { createdAt: "desc" },
    writable: ["lead", "customer", "user", "activity_type", "subject", "notes", "due_at", "done_at", "status"],
    dates: ["due_at", "done_at"],
    writeRole: "seller",
  },
  promotion: {
    table: "promotion",
    search: ["name", "code"],
    sort: { createdAt: "desc" },
    writable: ["name", "code", "discount_type", "value", "valid_from", "valid_to", "max_uses", "used_count", "min_amount", "channels", "status", "description"],
    numeric: ["value", "max_uses", "used_count", "min_amount"],
    dates: ["valid_from", "valid_to"],
    writeRole: "manager",
  },
  order: {
    table: "order",
    search: ["order_number"],
    expand: { customer: true, seller: true, partner: true, branch: true },
    expandOne: {
      customer: true, seller: true, partner: true, branch: true, created_by: true, promotion: true,
      booking: { _limit: 100, product: true, departure: true, modality: true, pickup_hotel: true },
      payment: { _limit: 100, _sort: { createdAt: "desc" }, user: true },
      payment_schedule: { _limit: 60, _sort: { sequence: "asc" } },
    },
    sort: { createdAt: "desc" },
    // AUD-B02: `status` removed — an order's status is derived from its bookings
    // and payments by `syncOrderTotals`. Editing it by hand let a seller mark an
    // order `paid`/`cancelled` without moving money or releasing seats.
    writable: ["notes", "channel", "seller", "partner", "branch", "promotion"],
    writeRole: "seller",
  },
  booking: {
    table: "booking",
    search: ["booking_number", "voucher_code", "room_number"],
    expand: { customer: true, product: true, departure: true, seller: true, partner: true, modality: true },
    expandOne: {
      customer: true, product: true, departure: true, seller: true, partner: true, branch: true,
      modality: true, pickup_hotel: true, order: true, created_by: true, checked_in_by: true,
      participant: { _limit: 100 },
      booking_extra: { _limit: 30 },
      voucher: { _limit: 10 },
      commission: { _limit: 20, seller: true, partner: true },
      payment: { _limit: 50, _sort: { createdAt: "desc" } },
      pickup: { _limit: 10, hotel: true, route: true },
    },
    sort: { createdAt: "desc" },
    // SECURITY (AUD-B02/F10): `status` and `checkin_status` are lifecycle
    // fields. They must NOT be editable through the generic CRUD — that lets a
    // seller resurrect a cancelled booking, skip payment, or set an impossible
    // state without releasing seats, voiding vouchers or reversing commissions.
    // Transitions happen only through dedicated endpoints
    // (`/api/orders`, `/api/bookings/[id]/cancel`, `/api/bookings/[id]/checkin`).
    writable: ["notes", "internal_notes", "pickup_hotel", "pickup_time", "pickup_location", "room_number"],
    writeRole: "seller",
  },
  participant: {
    table: "participant",
    search: ["full_name", "document_id"],
    expand: { booking: true },
    sort: { createdAt: "asc" },
    writable: ["booking", "full_name", "age", "category", "document_id", "nationality", "checkin_status", "special_requirements", "notes"],
    numeric: ["age"],
    writeRole: "seller",
  },
  voucher: {
    table: "voucher",
    search: ["code"],
    expand: { booking: { customer: true, product: true, departure: true } },
    sort: { createdAt: "desc" },
    // SECURITY (AUD-B02/B14): `status` removed — reverting a `used` voucher to
    // `valid` re-arms an already-redeemed ticket. Voucher state is driven by
    // the booking lifecycle (cancel voids it, check-in burns it).
    writable: ["notes", "expires_at"],
    dates: ["expires_at"],
    writeRole: "operations",
  },
  commission_rule: {
    table: "commission_rule",
    search: ["name"],
    expand: { product: true, category: true, partner: true, seller: true },
    sort: { priority: "asc" },
    writable: ["name", "priority", "beneficiary_type", "calc_type", "value", "tiers", "product", "category", "partner", "seller", "channel", "season_from", "season_to", "min_sales", "max_sales", "currency", "status", "description"],
    numeric: ["priority", "value", "min_sales", "max_sales"],
    dates: ["season_from", "season_to"],
    writeRole: "admin",
    module: "commissions",
  },
  commission: {
    table: "commission",
    search: ["beneficiary_name"],
    expand: { booking: { product: true }, seller: true, partner: true, rule: true },
    sort: { createdAt: "desc" },
    // SECURITY (AUD-B02/F10): `status` removed — editing it through CRUD lets a
    // manager reactivate a `settled` commission so a second settlement pays it
    // again. Commission state changes only through `/api/commissions/bulk` and
    // `/api/settlements/generate`.
    writable: ["notes"],
    // `service_date` es de solo lectura —la escribe el devengo— pero SÍ se
    // declara como fecha: es por donde la pantalla del vendedor corta períodos,
    // y un campo no declarado no es filtrable.
    dates: ["service_date", "generated_at"],
    numeric: ["base_amount", "percentage", "amount"],
    writeRole: "manager",
    module: "commissions",
  },
  settlement: {
    table: "settlement",
    search: ["code"],
    expand: { partner: true, seller: true, supplier: true },
    expandOne: {
      partner: true, seller: true, supplier: true, approved_by: true, confirmed_by: true,
      payable: { _limit: 50 },
      booking_cost: { _limit: 500, booking: true, departure: true },
    },
    sort: { createdAt: "desc" },
    // SECURITY (AUD-B02/F10/F12): `status`/`paid_total`/`pending_total` removed —
    // paying a settlement must go through `/api/settlements/[id]/pay`, which also
    // settles the payable, closes the commissions and posts to the ledger.
    // Editing these via CRUD previously left the debt open (paid twice) and let
    // a `paid_total` be set with no money behind it.
    writable: ["notes"],
    writeRole: "manager",
    module: "settlements",
  },
  cash_register: {
    table: "cash_register",
    search: ["name", "code", "terminal"],
    expand: { branch: true },
    sort: { name: "asc" },
    // `difference_tolerance` es política de la empresa —cuánto puede descuadrar
    // un turno sin supervisor—, así que la fija un manager, no el cajero.
    writable: ["branch", "name", "code", "terminal", "currency", "difference_tolerance", "status"],
    numeric: ["difference_tolerance"],
    writeRole: "manager",
  },
  cash_session: {
    table: "cash_session",
    search: ["code"],
    expand: { cash_register: true, branch: true, user: true },
    expandOne: {
      cash_register: true, branch: true, user: true, closed_by: true, approved_by: true,
      cash_movement: { _limit: 300, _sort: { createdAt: "desc" } },
      cash_count: { _limit: 20 },
    },
    sort: { createdAt: "desc" },
    // SECURITY: el arqueo —contado, esperado, diferencia, estado y aprobación—
    // solo lo escriben `/api/cash/sessions/:id/close` y `/approve`. Editable
    // por CRUD, cualquiera cuadraría su propia caja a mano.
    writable: ["notes"],
    writeRole: "cashier",
  },
  // El conteo físico por moneda. Lo crea el cierre, que valida las
  // denominaciones y recalcula la sesión; aquí es de solo lectura, porque un
  // conteo editable es un arqueo que no prueba nada.
  cash_count: {
    table: "cash_count",
    search: ["notes"],
    expand: { cash_session: true, counted_by: true },
    sort: { counted_at: "desc" },
    writable: [],
    numeric: ["counted_total", "expected_total", "difference"],
    dates: ["counted_at"],
    writeRole: "cashier",
  },
  // El detalle de una caja lista sus movimientos, y `READ_ROLE` ya los acotaba a
  // cajero; solo faltaba declararlos. Se crean por `/api/cash/movements`, que
  // valida el tipo y recalcula la sesión, así que aquí son de solo lectura.
  cash_movement: {
    table: "cash_movement",
    search: ["concept", "reference"],
    expand: { cash_session: true, user: true, payment: true },
    sort: { movement_at: "desc" },
    writable: [],
    numeric: ["amount"],
    dates: ["movement_at"],
    writeRole: "cashier",
  },
  // El devengo por proveedor: lo que cada servicio operado le debe a quien lo
  // operó. Lo escriben la venta (al crear la reserva) y las rutas de
  // liquidación. Editable por CRUD, se podría cambiar a mano lo que se le debe a
  // un proveedor después de haberlo liquidado.
  booking_cost: {
    table: "booking_cost",
    search: ["concept", "notes"],
    expand: { booking: true, departure: true, supplier: true, settlement: true },
    sort: { createdAt: "desc" },
    writable: [],
    numeric: ["quantity", "unit_cost", "amount", "confirmed_amount"],
    writeRole: "manager",
  },
  // El calendario de cobro. Lo escriben `/api/orders/:id/schedule` y el servicio
  // que reparte los pagos, nunca el CRUD: una cuota editable a mano deja el plan
  // sumando algo distinto del total de la venta, y entonces no cobra ni sobra.
  payment_schedule: {
    table: "payment_schedule",
    search: ["notes"],
    expand: { order: true, booking: true },
    sort: { due_date: "asc" },
    writable: [],
    numeric: ["amount", "paid_amount", "balance", "sequence"],
    dates: ["due_date", "paid_at", "reminded_at"],
    writeRole: "manager",
  },
  payment: {
    table: "payment",
    search: ["reference"],
    expand: { order: true, booking: true, customer: true, partner: true, user: true },
    sort: { createdAt: "desc" },
    // SECURITY (AUD-B02/F10): `status` removed — a payment's state must not be
    // flippable through CRUD (e.g. marking a refund `completed` or voiding a
    // real payment) as it would desync order/receivable/cash balances.
    writable: ["notes"],
    writeRole: "cashier",
  },
  receivable: {
    table: "receivable",
    search: ["document_number"],
    expand: { partner: true, customer: true, order: true },
    sort: { due_date: "asc" },
    // AUD-F16/F21: `paid_amount`/`balance` removed — they are derived from the
    // payments applied to the order and must not be edited by hand (that
    // divorced the cached balance from the actual payments). `status` stays for
    // manual write-off until a dedicated endpoint exists.
    // SECURITY/0039: `status` y `aging_bucket` los deriva la cobranza diaria de
    // `due_date`. Editables a mano, el informe de antigüedad decía lo último que
    // alguien tecleó, y el tramo que la propia UI ofrecía lo rechazaba el enum.
    writable: ["notes", "due_date"],
    dates: ["due_date"],
    writeRole: "manager",
  },
  supplier: {
    table: "supplier",
    search: ["name", "tax_id", "contact_name", "email"],
    sort: { name: "asc" },
    writable: [
      "name", "supplier_type", "tax_id", "contact_name", "email", "phone", "address", "currency",
      "payment_terms_days", "status", "notes",
      // 0040 — el régimen fiscal decide sus retenciones, y los datos bancarios
      // son lo que hace falta para transferirle.
      "tax_regime", "retention_isr_pct", "retention_itbis_pct", "tax_rate",
      "bank_name", "bank_account",
    ],
    numeric: ["payment_terms_days", "retention_isr_pct", "retention_itbis_pct", "tax_rate"],
    writeRole: "manager",
  },
  payable: {
    table: "payable",
    search: ["concept", "reference"],
    expand: { supplier: true, partner: true, seller: true, settlement: true },
    sort: { due_date: "asc" },
    writable: ["supplier", "partner", "seller", "settlement", "concept", "category", "amount", "paid_amount", "balance", "currency", "issue_date", "due_date", "status", "reference", "notes"],
    numeric: ["amount", "paid_amount", "balance"],
    dates: ["issue_date", "due_date"],
    writeRole: "manager",
  },
  expense_category: {
    table: "expense_category",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "color", "status"],
    writeRole: "manager",
  },
  expense: {
    table: "expense",
    search: ["concept"],
    expand: { category: true, branch: true, supplier: true, user: true },
    sort: { expense_date: "desc" },
    writable: [
      "category", "branch", "supplier", "cash_session", "concept", "amount", "currency",
      "exchange_rate", "expense_date", "payment_method", "status", "notes",
      // 0049 — lo que el 606 exige y no se guardaba en ninguna parte. Todo
      // opcional: una propina o un peaje siguen siendo gastos legítimos aunque
      // no tengan comprobante fiscal, solo que no van a la declaración.
      "ncf", "ncf_type", "ncf_modified", "supplier_rnc", "goods_service_type",
      "itbis_amount", "itbis_withheld", "isr_withheld", "selective_tax", "other_taxes",
      "legal_tip", "paid_date",
    ],
    numeric: [
      "amount", "exchange_rate", "itbis_amount", "itbis_withheld", "isr_withheld",
      "selective_tax", "other_taxes", "legal_tip",
    ],
    dates: ["expense_date", "paid_date"],
    writeRole: "cashier",
  },
  currency_rate: {
    table: "currency_rate",
    search: ["source"],
    sort: { rate_date: "desc" },
    writable: ["currency_from", "currency_to", "rate", "rate_date", "source"],
    numeric: ["rate"],
    dates: ["rate_date"],
    writeRole: "manager",
  },
  staff: {
    table: "staff",
    search: ["full_name", "phone", "email", "document_id"],
    expand: { supplier: true },
    sort: { full_name: "asc" },
    writable: ["supplier", "user", "full_name", "staff_type", "languages", "phone", "email", "document_id", "photo_url", "daily_rate", "currency", "hire_date", "license_expiry", "status", "notes",
      // 0051 — lo que hace falta para pagarle: cómo cobra, cuánto, y su NSS.
      "payroll_code", "salary_type", "base_salary", "hourly_rate", "social_security_id",
      "bank_account", "bank_name", "applies_social_security", "termination_date"],
    numeric: ["daily_rate", "base_salary", "hourly_rate"],
    booleans: ["applies_social_security"],
    dates: ["hire_date", "license_expiry", "termination_date"],
    writeRole: "operations",
  },
  vehicle: {
    table: "vehicle",
    search: ["name", "plate"],
    expand: { supplier: true, driver: true },
    sort: { name: "asc" },
    writable: ["supplier", "driver", "name", "plate", "vehicle_type", "capacity", "photo_url", "insurance_expiry", "inspection_expiry", "status", "notes"],
    numeric: ["capacity"],
    dates: ["insurance_expiry", "inspection_expiry"],
    writeRole: "operations",
    module: "transport",
  },
  product_cost: {
    table: "product_cost",
    search: ["concept"],
    expand: { product: true, supplier: true },
    sort: { createdAt: "desc" },
    writable: ["product", "supplier", "concept", "cost_type", "amount", "currency", "status", "notes"],
    numeric: ["amount"],
    writeRole: "manager",
  },
  waitlist_entry: {
    table: "waitlist_entry",
    search: ["contact_name", "contact_phone", "contact_email"],
    expand: { departure: { product: true }, customer: true, seller: true, booking: true },
    sort: { createdAt: "asc" },
    /**
     * Solo lo que una persona decide: a quién apunta, por cuántos y sus notas.
     *
     * `status`, `offered_at`, `offer_expires_at` y `booking` los escribe el
     * servicio: son el resultado de una oferta que creó una reserva de verdad.
     * Dejarlos teclear permitiría marcar «convertida» una espera que nadie
     * pagó, y ese es justo el número con el que se mide si la lista sirve.
     */
    writable: ["departure", "customer", "contact_name", "contact_phone", "contact_email",
      "seller", "partner", "pax", "notes"],
    numeric: ["pax"],
    writeRole: "cashier",
  },
  pickup_route: {
    table: "pickup_route",
    search: ["name"],
    expand: { departure: { product: true }, zone: true, vehicle: true, driver: true, guide: true },
    expandOne: { departure: { product: true }, zone: true, vehicle: true, driver: true, guide: true, pickup: { _limit: 200, hotel: true, booking: { customer: true } } },
    sort: { start_time: "asc" },
    writable: ["departure", "zone", "vehicle", "driver", "guide", "name", "start_time", "pax_total", "stops_count", "status", "notes"],
    numeric: ["pax_total", "stops_count"],
    writeRole: "operations",
    module: "pickups",
  },
  pickup: {
    table: "pickup",
    search: ["location", "room"],
    expand: { booking: { customer: true, product: true }, hotel: true, route: true },
    sort: { pickup_time: "asc" },
    // `sequence` sí es editable: reordenar una parada a mano es una decisión
    // del despacho («por ese hotel mejor pasa al final, la salida del parking
    // es imposible a esa hora»). `planned_time` NO lo es: la calcula el motor, y
    // dejar teclearla devolvería la hora de recogida a ser un texto suelto, que
    // es justo el defecto que 0065 vino a arreglar.
    writable: ["booking", "hotel", "route", "pickup_time", "location", "room", "pax", "sequence", "status", "notes"],
    numeric: ["pax", "sequence"],
    writeRole: "operations",
    module: "pickups",
  },
  departure_resource: {
    table: "departure_resource",
    search: ["notes"],
    expand: { departure: { product: true }, vehicle: true, staff: true },
    sort: { createdAt: "desc" },
    writable: ["departure", "vehicle", "staff", "resource_role", "pax_assigned", "start_time", "end_time", "cost", "currency", "status", "notes"],
    numeric: ["pax_assigned", "cost"],
    writeRole: "operations",
    module: "operations",
  },
  /**
   * Las encuestas se responden desde una página pública y se leen desde «La voz
   * del cliente». Se registran aquí SOLO PARA LEER, que es lo que permite
   * listarlas, acotarlas por período, imprimirlas y exportarlas como cualquier
   * otro reporte. `writable: []` es la garantía de que una nota no se puede
   * editar desde el CRUD genérico: una opinión corregida a mano deja de ser una
   * opinión.
   */
  guest_survey: {
    table: "guest_survey",
    search: ["comment"],
    expand: { product: true, customer: true, guide_staff: true },
    sort: { answeredAt: "desc" },
    writable: [],
    writeRole: "manager",
  },

  audit_log: {
    table: "audit_log",
    search: ["action", "description", "entity_type"],
    expand: { user: true, impersonated_by: true },
    sort: { createdAt: "desc" },
    writable: [],
    writeRole: "admin",
  },

  // ==========================================================================
  // Blueprint modules: parque, seguridad, mantenimiento, comercio,
  // experiencia del visitante, distribución, contabilidad, equipo y
  // administración. Cada entrada habilita CRUD multi-tenant completo
  // a través de /api/erp/[resource].
  // ==========================================================================
  attraction: {
    table: "attraction",
    search: ["name", "code", "location"],
    expand: { zone: true },
    sort: { name: "asc" },
    writable: ["name", "code", "attraction_type", "operational_status", "capacity_hour", "capacity_simultaneous", "queue_minutes", "guests_today", "duration_min", "min_height_cm", "max_height_cm", "min_age", "max_weight_kg", "health_restrictions", "requires_waiver", "weather_sensitive", "downtime_minutes_today", "last_status_at", "cover_image_url", "location", "status", "notes", "zone"],
    booleans: ["requires_waiver", "weather_sensitive"],
    numeric: ["capacity_hour", "capacity_simultaneous", "queue_minutes", "guests_today", "duration_min", "min_height_cm", "max_height_cm", "min_age", "max_weight_kg", "downtime_minutes_today"],
    dates: ["last_status_at"],
    writeRole: "manager",
  },
  attraction_log: {
    table: "attraction_log",
    search: ["reason", "to_status"],
    expand: { attraction: true, user: true },
    sort: { createdAt: "desc" },
    writable: [],
    numeric: ["duration_min", "guests"],
    dates: ["logged_at"],
    writeRole: "operations",
  },
  access_ticket: {
    table: "access_ticket",
    search: ["code", "holder_name", "wristband_code"],
    expand: { customer: true, product: true, booking: true },
    sort: { createdAt: "desc" },
    // `status`, `entries_used` y `redeemed_at` son estado de consumo y NO se
    // editan por el CRUD genérico: desde el formulario se podía revivir un pase
    // ya redimido o devolver el contador a cero, que es rearmar una entrada ya
    // usada. Se mueven solo por `POST /api/tickets/:id/redeem` y `/void`, con
    // guardas de estado y auditoría — igual que `voucher.status` (AUD-B02/B14) y
    // `departure.status` (AUD-B02/B16).
    writable: ["code", "ticket_type", "valid_from", "valid_to", "entries_allowed", "issued_at", "qr_payload", "wristband_code", "holder_name", "price", "currency", "notes", "booking", "participant", "customer", "product", "order", "membership"],
    numeric: ["entries_allowed", "entries_used", "price"],
    dates: ["valid_from", "valid_to", "issued_at", "redeemed_at"],
    writeRole: "cashier",
  },
  waiver_template: {
    table: "waiver_template",
    search: ["name", "version", "jurisdiction"],
    sort: { name: "asc" },
    writable: ["name", "version", "jurisdiction", "language", "body", "requires_guardian", "min_age_self_sign", "valid_from", "valid_to", "status"],
    booleans: ["requires_guardian"],
    numeric: ["min_age_self_sign"],
    dates: ["valid_from", "valid_to"],
    writeRole: "admin",
  },
  waiver: {
    table: "waiver",
    search: ["signature_name", "document_id", "guardian_name"],
    expand: { waiver_template: true, participant: true, customer: true },
    sort: { createdAt: "desc" },
    writable: ["signed_at", "signature_name", "signature_data", "document_id", "document_type", "template_version", "body_snapshot", "guardian_name", "guardian_document", "status", "valid_until", "ip_address", "channel", "health_flags", "waiver_template", "participant", "customer", "booking", "product"],
    dates: ["signed_at", "valid_until"],
    writeRole: "cashier",
  },
  incident: {
    table: "incident",
    search: ["code", "title", "description", "location"],
    expand: { attraction: true, asset: true, reported_by: true, assigned_to: true },
    sort: { createdAt: "desc" },
    writable: ["code", "occurred_at", "reported_at", "severity", "incident_type", "status", "title", "description", "location", "immediate_action", "root_cause", "witnesses", "medical_attention", "evacuation", "authority_notified", "insurance_claim", "estimated_cost", "currency", "closed_at", "photos", "attraction", "asset", "zone", "participant", "booking", "customer", "vehicle", "reported_by", "assigned_to", "departure"],
    booleans: ["medical_attention", "evacuation", "authority_notified", "insurance_claim"],
    numeric: ["estimated_cost"],
    dates: ["occurred_at", "reported_at", "closed_at"],
    writeRole: "operations",
  },
  incident_action: {
    table: "incident_action",
    search: ["action", "description"],
    expand: { incident: true, assigned_to: true },
    sort: { createdAt: "desc" },
    writable: ["action", "description", "due_date", "completed_at", "status", "priority", "verification_notes", "incident", "assigned_to", "verified_by"],
    dates: ["due_date", "completed_at"],
    writeRole: "operations",
  },
  inspection_template: {
    table: "inspection_template",
    search: ["name", "code"],
    expand: { asset: true, attraction: true },
    sort: { name: "asc" },
    writable: ["name", "code", "frequency", "category", "checklist", "pass_threshold", "requires_signature", "blocks_operation_on_fail", "estimated_min", "status", "asset", "attraction"],
    booleans: ["requires_signature", "blocks_operation_on_fail"],
    numeric: ["pass_threshold", "estimated_min"],
    writeRole: "manager",
  },
  inspection: {
    table: "inspection",
    search: ["findings", "signature_name"],
    expand: { inspection_template: true, asset: true, attraction: true, performed_by: true },
    sort: { createdAt: "desc" },
    writable: ["performed_at", "result", "score", "items_total", "items_failed", "findings", "signature_name", "blocked_operation", "photos", "next_due_at", "inspection_template", "asset", "attraction", "vehicle", "performed_by", "work_order"],
    booleans: ["blocked_operation"],
    numeric: ["score", "items_total", "items_failed"],
    dates: ["performed_at", "next_due_at"],
    writeRole: "operations",
  },
  asset: {
    table: "asset",
    search: ["name", "code", "serial_number", "location"],
    expand: { zone: true, attraction: true, supplier: true },
    sort: { name: "asc" },
    writable: ["name", "code", "asset_type", "operational_status", "blocks_capacity", "criticality", "serial_number", "location", "capacity", "purchase_date", "purchase_cost", "currency", "warranty_until", "meter_hours", "meter_km", "next_maintenance_at", "downtime_minutes_month", "status", "notes", "zone", "vehicle", "supplier", "branch", "attraction"],
    booleans: ["blocks_capacity"],
    numeric: ["capacity", "purchase_cost", "meter_hours", "meter_km", "downtime_minutes_month"],
    dates: ["purchase_date", "warranty_until", "next_maintenance_at"],
    writeRole: "manager",
  },
  work_order: {
    table: "work_order",
    search: ["code", "title", "description"],
    expand: { asset: true, attraction: true, assigned_to: true, supplier: true },
    sort: { createdAt: "desc" },
    writable: ["code", "title", "order_type", "priority", "status", "opened_at", "scheduled_at", "started_at", "finished_at", "description", "work_performed", "downtime_min", "labor_hours", "labor_cost", "parts_cost", "total_cost", "currency", "takes_asset_down", "meter_reading", "asset", "attraction", "vehicle", "assigned_to", "supplier", "incident", "maintenance_plan", "requested_by"],
    booleans: ["takes_asset_down"],
    numeric: ["downtime_min", "labor_hours", "labor_cost", "parts_cost", "total_cost", "meter_reading"],
    dates: ["opened_at", "scheduled_at", "started_at", "finished_at"],
    writeRole: "operations",
  },
  maintenance_plan: {
    table: "maintenance_plan",
    search: ["name"],
    expand: { asset: true, attraction: true, vehicle: true },
    sort: { next_due_at: "asc" },
    writable: ["name", "trigger_type", "interval_days", "interval_hours", "interval_km", "lead_time_days", "task_list", "estimated_min", "estimated_cost", "last_executed_at", "next_due_at", "takes_asset_down", "status", "asset", "attraction", "vehicle", "inspection_template", "staff"],
    booleans: ["takes_asset_down"],
    numeric: ["interval_days", "interval_hours", "interval_km", "lead_time_days", "estimated_min", "estimated_cost"],
    dates: ["last_executed_at", "next_due_at"],
    writeRole: "manager",
  },
  warehouse: {
    table: "warehouse",
    search: ["name", "code", "location"],
    expand: { branch: true, zone: true },
    sort: { name: "asc" },
    writable: ["name", "code", "warehouse_type", "location", "allows_negative", "status", "notes", "branch", "zone"],
    booleans: ["allows_negative"],
    writeRole: "manager",
  },
  inventory_item: {
    table: "inventory_item",
    search: ["name", "sku", "barcode"],
    expand: { product_category: true, supplier: true },
    sort: { name: "asc" },
    writable: ["name", "sku", "barcode", "item_type", "unit", "cost", "price", "currency", "tax_rate", "min_stock", "max_stock", "reorder_point", "reorder_qty", "shelf_life_days", "is_sellable", "tracks_lots", "image_url", "status", "product_category", "supplier", "product"],
    booleans: ["is_sellable", "tracks_lots"],
    numeric: ["cost", "price", "tax_rate", "min_stock", "max_stock", "reorder_point", "reorder_qty", "shelf_life_days"],
    writeRole: "manager",
  },
  stock_level: {
    table: "stock_level",
    search: [],
    expand: { warehouse: true, inventory_item: true },
    sort: { available: "asc" },
    // 0052 — DE SOLO LECTURA. `inventory.ts` abre diciendo que nada más en la
    // aplicación puede escribir `stock_level` directamente… y el CRUD genérico
    // lo tenía entero como escribible. Editar el saldo aquí lo separa del libro
    // de movimientos que es su única explicación, y la diferencia no aparece
    // hasta el conteo físico. Corregir un saldo se hace con un movimiento de
    // ajuste o un conteo, que dejan rastro de quién y por qué.
    writable: [],
    numeric: ["quantity", "reserved", "available", "avg_cost"],
    dates: ["last_movement_at", "last_counted_at"],
    writeRole: "manager",
  },
  stock_movement: {
    table: "stock_movement",
    search: ["reference", "reason", "lot_code"],
    expand: { warehouse: true, inventory_item: true, user: true },
    sort: { createdAt: "desc" },
    // `purchase_order_line` y `booking_extra` NO son escribibles: son el rastro
    // que dice cuánto se recibió de cada línea y qué venta consumió qué. Si se
    // pudieran teclear, ese rastro dejaría de ser una cuenta y pasaría a ser
    // una opinión.
    writable: ["movement_type", "quantity", "unit_cost", "total_cost", "currency", "moved_at", "balance_after", "reason", "reference", "lot_code", "expires_at", "warehouse", "to_warehouse", "inventory_item", "user", "purchase_order", "order", "work_order"],
    numeric: ["quantity", "unit_cost", "total_cost", "balance_after"],
    dates: ["moved_at", "expires_at"],
    writeRole: "operations",
  },
  purchase_order: {
    table: "purchase_order",
    search: ["code", "notes"],
    expand: { supplier: true, warehouse: true, requested_by: true },
    sort: { createdAt: "desc" },
    writable: ["code", "status", "ordered_at", "expected_at", "received_at", "subtotal", "tax", "total", "currency", "exchange_rate", "payment_terms", "notes", "approval_notes", "supplier", "warehouse", "requested_by", "approved_by", "payable"],
    numeric: ["subtotal", "tax", "total", "exchange_rate"],
    dates: ["ordered_at", "expected_at", "received_at"],
    writeRole: "manager",
  },
  purchase_order_line: {
    table: "purchase_order_line",
    search: ["description"],
    expand: { purchase_order: true, inventory_item: true },
    sort: { createdAt: "desc" },
    // `quantity_received` fuera (0052): lo recibido lo escribe la recepción, que
    // mueve el stock a la vez. Tecleable, se podía dar por recibida una línea
    // sin que entrara una sola unidad al almacén.
    writable: ["description", "quantity", "unit_cost", "tax_rate", "line_total", "purchase_order", "inventory_item"],
    numeric: ["quantity", "quantity_received", "unit_cost", "tax_rate", "line_total"],
    writeRole: "manager",
  },
  membership_plan: {
    table: "membership_plan",
    search: ["name", "code"],
    sort: { price: "asc" },
    writable: ["name", "code", "plan_type", "price", "currency", "duration_days", "visits_included", "guest_passes", "discount_percent", "benefits", "blackout_dates", "auto_renew", "image_url", "status"],
    booleans: ["auto_renew"],
    numeric: ["price", "duration_days", "visits_included", "guest_passes", "discount_percent"],
    writeRole: "manager",
  },
  membership: {
    table: "membership",
    search: ["code"],
    expand: { membership_plan: true, customer: true },
    sort: { createdAt: "desc" },
    writable: ["code", "status", "starts_at", "ends_at", "visits_used", "guest_passes_used", "amount_paid", "currency", "auto_renew", "photo", "last_visit_at", "cancelled_at", "cancel_reason", "membership_plan", "customer", "order"],
    booleans: ["auto_renew"],
    numeric: ["visits_used", "guest_passes_used", "amount_paid"],
    dates: ["starts_at", "ends_at", "last_visit_at", "cancelled_at"],
    writeRole: "cashier",
  },
  gift_card: {
    table: "gift_card",
    search: ["code", "recipient_name", "recipient_email"],
    expand: { customer: true },
    expandOne: { customer: true, order: true, product: true, gift_card_movement: { _limit: 200, _sort: { moved_at: "desc" }, user: true } },
    sort: { createdAt: "desc" },
    // `status`, `initial_amount` y `balance` NO se editan por aquí: el saldo de
    // una gift card es dinero del cliente, y como campo de formulario cualquiera
    // con permiso de escritura podía ponerle el número que quisiera sin dejar
    // rastro. Se mueven solo por `/api/gift-cards` y sus acciones, que escriben
    // el movimiento correspondiente y auditan. Mismo criterio que
    // `access_ticket.status` (AUD-B02), `voucher.status` (AUD-B02/B14) y
    // `departure.status` (AUD-B02/B16).
    writable: ["code", "currency", "expires_at", "recipient_name", "recipient_email", "message", "delivery_channel", "customer", "order", "product"],
    numeric: ["initial_amount", "balance"],
    dates: ["issued_at", "expires_at"],
    writeRole: "cashier",
  },
  // Los movimientos son el libro de la tarjeta: se leen, no se escriben a mano.
  // `balance_after` escribible era una segunda vía para inventar un saldo.
  gift_card_movement: {
    table: "gift_card_movement",
    search: ["notes"],
    expand: { gift_card: true, user: true },
    sort: { moved_at: "desc" },
    writable: [],
    numeric: ["amount", "balance_after"],
    dates: ["moved_at"],
    writeRole: "cashier",
  },
  guest_case: {
    table: "guest_case",
    search: ["code", "subject", "description"],
    expand: { customer: true, booking: true, assigned_to: true },
    sort: { createdAt: "desc" },
    writable: ["code", "case_type", "status", "priority", "channel", "opened_at", "subject", "description", "resolution", "resolved_at", "satisfaction_score", "compensation_amount", "currency", "compensation_type", "customer", "booking", "participant", "assigned_to", "order", "incident"],
    numeric: ["satisfaction_score", "compensation_amount"],
    dates: ["opened_at", "resolved_at"],
    writeRole: "operations",
  },
  quote: {
    table: "quote",
    search: ["code", "title", "notes", "company_name", "contact_name"],
    expand: { customer: true, partner: true, seller: true },
    // El detalle trae el documento entero: sus alternativas, sus líneas y la
    // versión de la que viene. Una cotización sin su desglose no se puede
    // revisar ni comparar contra el total que se le prometió al cliente.
    expandOne: {
      customer: true, partner: true, seller: true, order: true, lead: true,
      revision_of: true, selected_option: true,
      quote_option: { _limit: 20 },
      quote_line: { _limit: 200, product: true, supplier: true, option: true },
    },
    sort: { createdAt: "desc" },
    // El ciclo de vida y el dinero NO son campos de formulario: `status`,
    // `sent_at`, `decided_at` y los totales los escriben las acciones de
    // /api/quotes, igual que con `voucher.status` o el saldo de una gift card.
    // Editarlos a mano permitía dar por aceptada una propuesta que el cliente
    // nunca recibió, o prometer un total que no cuadra con sus líneas.
    writable: [
      "title", "quote_type", "issued_at", "valid_until", "event_date", "pax", "currency",
      "contact_name", "contact_email", "contact_phone", "company_name",
      "tax_percent",
      "deposit_type", "deposit_percent", "deposit_amount", "deposit_due_date", "balance_due_date",
      "terms", "inclusions", "exclusions", "cancellation_policy", "payment_terms",
      "notes", "internal_notes", "follow_up_at",
      "customer", "partner", "seller", "lead", "user",
    ],
    numeric: ["pax", "tax_percent", "deposit_percent", "deposit_amount"],
    dates: ["issued_at", "valid_until", "event_date", "deposit_due_date", "balance_due_date", "follow_up_at"],
    writeRole: "seller",
  },
  // Las líneas y las alternativas son el desglose del que sale el total: se leen
  // desde aquí, pero se escriben por /api/quotes/:id/lines y /options, que
  // recalculan la cabecera en el mismo movimiento. Dejarlas en el CRUD genérico
  // permitía añadir una línea de 5.000 sin que el total de la propuesta se
  // enterara.
  quote_line: {
    table: "quote_line",
    search: ["description"],
    expand: { quote: true, product: true, supplier: true, option: true },
    sort: { sort_order: "asc" },
    writable: [],
    numeric: ["quantity", "unit_price", "unit_cost", "discount_percent", "line_total", "adults", "children", "infants", "sort_order"],
    dates: ["service_date"],
    writeRole: "seller",
  },
  quote_option: {
    table: "quote_option",
    search: ["name"],
    expand: { quote: true },
    sort: { sort_order: "asc" },
    writable: [],
    numeric: ["sort_order", "subtotal", "discount", "tax", "total", "cost_total", "margin_amount"],
    booleans: ["is_recommended", "is_selected"],
    writeRole: "seller",
  },
  // La bandeja de salida es un libro: cada fila es constancia de lo que se le
  // dijo a un cliente. Se lee desde aquí; encolar, reintentar y cancelar pasan
  // por /api/messages, que es quien compone el texto y respeta el dedupe.
  message: {
    table: "message",
    search: ["to_address", "subject", "to_name"],
    expand: { customer: true, booking: true, quote: true },
    expandOne: { customer: true, booking: true, order: true, quote: true, departure: true, payment: true },
    sort: { createdAt: "desc" },
    writable: [],
    numeric: ["attempts"],
    dates: ["scheduled_at", "sent_at"],
    writeRole: "manager",
  },
  // Las plantillas sí son un formulario: cada empresa reescribe el texto con su
  // voz y en los idiomas que atiende.
  message_template: {
    table: "message_template",
    search: ["key", "subject", "body"],
    sort: { key: "asc" },
    writable: ["key", "channel", "language", "subject", "body", "status", "offset_hours", "notes"],
    numeric: ["offset_hours"],
    writeRole: "manager",
  },
  // Lo que se vende JUNTO al tour: el almuerzo, la foto, el transfer premium.
  // Es donde está el margen, porque el tour compite por precio y el extra no.
  product_extra: {
    table: "product_extra",
    search: ["name", "description"],
    expand: { product: true, inventory_item: true, warehouse: true },
    sort: { sort_order: "asc" },
    writable: ["product", "name", "description", "price_type", "price", "cost", "currency",
               "is_required", "max_quantity", "sort_order", "status",
               // 0052 — el extra que además es un artículo del almacén.
               "inventory_item", "warehouse", "consumes_stock", "stock_per_unit"],
    numeric: ["price", "cost", "max_quantity", "sort_order", "stock_per_unit"],
    booleans: ["is_required", "consumes_stock"],
    writeRole: "manager",
  },
  // Lo contratado, con su precio congelado: si mañana sube el almuerzo, la
  // reserva de ayer sigue valiendo lo que el cliente pagó. Se lee, no se edita.
  booking_extra: {
    table: "booking_extra",
    search: ["name"],
    expand: { booking: true, extra: true },
    sort: { createdAt: "asc" },
    writable: [],
    numeric: ["quantity", "unit_price", "unit_cost", "total_amount", "cost_amount"],
    writeRole: "manager",
  },
  // El desglose del comprobante. Se lee; lo escribe la emisión, que es la única
  // que puede hacer que cuadre con el total y con la venta que lo origina.
  invoice_line: {
    table: "invoice_line",
    search: ["description"],
    expand: { invoice: true, booking: true, product: true },
    sort: { sort_order: "asc" },
    writable: [],
    numeric: ["quantity", "unit_price", "discount", "tax_rate", "tax_amount", "total", "sort_order"],
    writeRole: "manager",
  },
  // El rango de comprobantes que autorizó la DGII. `next_number` NO es
  // escribible desde aquí: lo consume `public.next_ncf` de forma atómica, y
  // moverlo a mano es cómo se repiten o se saltan números.
  ncf_sequence: {
    table: "ncf_sequence",
    search: ["ncf_type", "authorization_code"],
    expand: { tax_profile: true },
    sort: { ncf_type: "asc" },
    writable: ["ncf_type", "max_number", "expires_at", "authorization_code", "status", "notes", "tax_profile"],
    numeric: ["max_number"],
    dates: ["expires_at"],
    writeRole: "admin",
    module: "accounting",
  },
  allotment: {
    table: "allotment",
    search: ["notes"],
    expand: { partner: true, product: true, departure: true },
    sort: { valid_from: "asc" },
    writable: ["allotment_type", "seats", "seats_used", "seats_released", "release_days", "valid_from", "valid_to", "weekdays", "status", "notes", "partner", "product", "departure", "product_modality"],
    numeric: ["seats", "seats_used", "seats_released", "release_days"],
    dates: ["valid_from", "valid_to"],
    writeRole: "manager",
    module: "b2b_portal",
  },
  ledger_account: {
    table: "ledger_account",
    search: ["code", "name"],
    expand: { parent: true },
    sort: { code: "asc" },
    // AUD-F16: `balance` removed from writable — it is a cache derived from the
    // ledger entries (see trialBalance). Editing it by hand divorces the cached
    // balance from the entries with no audit trail. Chart metadata stays editable.
    writable: ["code", "name", "account_type", "subledger", "normal_side", "is_postable", "currency", "status", "parent"],
    booleans: ["is_postable"],
    writeRole: "admin",
    module: "accounting",
  },
  ledger_entry: {
    table: "ledger_entry",
    search: ["entry_code", "memo", "period"],
    expand: { ledger_account: true, order: true, payment: true },
    sort: { createdAt: "desc" },
    writable: [],
    numeric: ["line_no", "debit", "credit", "exchange_rate", "amount_base"],
    dates: ["posted_at"],
    writeRole: "admin",
    module: "accounting",
  },
  invoice: {
    table: "invoice",
    search: ["number", "ncf", "customer_name", "customer_tax_id"],
    expand: { customer: true, order: true, partner: true },
    sort: { createdAt: "desc" },
    // NADA fiscal es editable. El NCF, el tipo de comprobante, los importes y la
    // anulación los escribe la emisión (`/api/invoices`), que es la única que
    // puede hacer que el número no se repita y que los totales cuadren con la
    // venta. Un comprobante tecleado rompe de tres formas que la DGII ve: NCF
    // repetidos entre dos cajas simultáneas, huecos en la secuencia que hay que
    // justificar meses después, e impuesto que no coincide con la orden.
    // Queda editable lo que de verdad se corrige a posteriori sin tocar el
    // comprobante: el vencimiento pactado, la dirección y las notas internas.
    writable: ["due_date", "customer_address", "notes", "pdf_url", "efac_track_id"],
    numeric: ["subtotal", "tax", "tax_rate", "discount", "total", "paid_amount", "exchange_rate"],
    dates: ["issued_at", "due_date", "voided_at"],
    writeRole: "manager",
    module: "accounting",
  },
  tax_profile: {
    table: "tax_profile",
    search: ["name", "tax_name", "ncf_series"],
    sort: { name: "asc" },
    writable: ["name", "country", "tax_name", "tax_rate", "included_in_price", "tourism_tax_rate", "service_charge_rate", "tax_id_label", "ncf_series", "ncf_next", "ncf_expires", "efac_enabled", "rounding", "status"],
    booleans: ["included_in_price", "efac_enabled"],
    numeric: ["tax_rate", "tourism_tax_rate", "service_charge_rate", "ncf_next"],
    dates: ["ncf_expires"],
    writeRole: "admin",
    module: "accounting",
  },
  shift: {
    table: "shift",
    search: ["role_label", "notes"],
    expand: { staff: true, zone: true, attraction: true },
    sort: { starts_at: "asc" },
    // `published_at` y `published_by` NO son escribibles: publicar un cuadrante
    // es una acción con reglas (`/api/shifts/publish`), no un campo de
    // formulario. Dejarlo aquí permitiría marcar como publicado un turno sin
    // nadie asignado.
    writable: ["shift_date", "starts_at", "ends_at", "role_label", "status", "break_min", "hours_planned", "hourly_rate", "currency", "notes", "staff", "zone", "attraction", "branch", "departure", "user"],
    numeric: ["break_min", "hours_planned", "hourly_rate"],
    dates: ["shift_date", "starts_at", "ends_at"],
    writeRole: "manager",
  },
  attendance: {
    table: "attendance",
    search: ["notes"],
    expand: { staff: true, shift: true },
    sort: { createdAt: "desc" },
    // `payroll_run_id` y `approved_at` quedan FUERA a propósito: son lo que
    // impide pagar el mismo día dos veces y lo que dice quién dio el visto
    // bueno. Escribibles por formulario, bastaría con ponerlos a null para
    // volver a cobrar una quincena ya pagada.
    writable: ["attendance_date", "clock_in", "clock_out", "hours_worked", "regular_hours", "overtime_hours", "break_min", "status", "method", "notes", "staff", "shift", "approved_by"],
    numeric: ["hours_worked", "regular_hours", "overtime_hours", "break_min"],
    dates: ["attendance_date", "clock_in", "clock_out"],
    writeRole: "operations",
  },
  certification: {
    table: "certification",
    search: ["name", "number", "issuer"],
    expand: { staff: true },
    sort: { expires_at: "asc" },
    writable: ["name", "cert_type", "issuer", "number", "issued_at", "expires_at", "status", "blocks_assignment", "document", "notes", "staff"],
    booleans: ["blocks_assignment"],
    dates: ["issued_at", "expires_at"],
    writeRole: "manager",
  },
  /**
   * La corrida de nómina.
   *
   * Los importes NO son escribibles: salen de los marcajes aprobados y de los
   * porcentajes que la corrida congeló. Un bruto editable a mano convertiría
   * la nómina en una hoja de cálculo con base de datos, que es exactamente lo
   * que este módulo viene a sustituir. El estado tampoco: se mueve por
   * `/api/payroll/:id/status`, que sabe que una corrida pagada no se anula.
   */
  payroll_run: {
    table: "payroll_run",
    search: ["code", "notes"],
    expand: { branch: true, approved_by: true },
    expandOne: { branch: true, approved_by: true, payroll_line: { _limit: 500, staff: true } },
    sort: { period_start: "desc" },
    writable: ["code", "period_start", "period_end", "period_type", "currency", "branch", "notes",
      "sfs_employee_pct", "afp_employee_pct", "sfs_employer_pct", "afp_employer_pct", "risk_employer_pct"],
    numeric: ["sfs_employee_pct", "afp_employee_pct", "sfs_employer_pct", "afp_employer_pct", "risk_employer_pct"],
    dates: ["period_start", "period_end"],
    writeRole: "admin",
    // La nómina va con «contabilidad», que es el módulo que el plan ya vende y
    // donde viven las facturas y los asientos. Inventar un módulo «hr» habría
    // dejado la nómina apagada en TODOS los planes existentes hasta rehacer
    // cada contrato, que es peor que la clasificación imperfecta.
    module: "accounting",
  },
  /**
   * La línea de una persona en una corrida. Solo lectura por el CRUD genérico:
   * es un cálculo, y lo que se calcula no se teclea. Corregir una línea se hace
   * corrigiendo el marcaje y volviendo a generar.
   */
  payroll_line: {
    table: "payroll_line",
    search: ["staff_name", "payroll_code", "notes"],
    expand: { staff: true, payroll_run: true },
    sort: { staff_name: "asc" },
    writable: [],
    writeRole: "admin",
  },
  /**
   * El periodo contable.
   *
   * De SOLO LECTURA por el CRUD genérico: cerrar, reabrir y dar por declarado
   * son acciones con reglas —no se reabre lo declarado, no se bloquea sin
   * cerrar— que viven en `/api/ledger/periods`. Escribible por formulario,
   * bastaría con poner el estado en «abierto» para contabilizar dentro de un
   * mes ya enviado a la DGII, que es justo lo que esto viene a impedir.
   */
  accounting_period: {
    table: "accounting_period",
    search: ["period", "notes"],
    expand: { closed_by: true, locked_by: true },
    sort: { period: "desc" },
    writable: [],
    writeRole: "admin",
  },
  task: {
    table: "task",
    search: ["title", "description"],
    expand: { assigned_to: true, created_by: true },
    sort: { due_at: "asc" },
    writable: ["title", "description", "status", "priority", "due_at", "completed_at", "task_type", "source", "checklist", "assigned_to", "created_by", "booking", "order", "incident", "work_order", "guest_case", "customer", "lead"],
    dates: ["due_at", "completed_at"],
    writeRole: "seller",
  },
  document: {
    table: "document",
    search: ["title", "version"],
    expand: { owner: true },
    sort: { title: "asc" },
    writable: ["title", "doc_type", "version", "body", "file", "url", "effective_from", "expires_at", "requires_ack", "audience", "status", "owner"],
    booleans: ["requires_ack"],
    dates: ["effective_from", "expires_at"],
    writeRole: "manager",
  },
  document_ack: {
    table: "document_ack",
    search: ["version_acked"],
    expand: { document: true, user: true },
    sort: { createdAt: "desc" },
    writable: [],
    numeric: ["quiz_score"],
    dates: ["acknowledged_at"],
    writeRole: "seller",
  },
  approval_request: {
    table: "approval_request",
    search: ["code", "reason", "target_id"],
    expand: { requested_by: true, approved_by: true },
    sort: { createdAt: "desc" },
    // AUD: el ciclo de vida de una aprobación NO es escribible por el ERP
    // genérico. `status`, `requested_by`, `approved_by`, `second_approver`,
    // `requires_two` y `decided_at` salieron de aquí porque con `writeRole:
    // "manager"` cualquier manager podía hacer PUT {"status":"approved"} sobre
    // su propia solicitud y saltarse por completo `decide()`: sin control de
    // autoaprobación, sin rango por acción, sin expiración y sin segunda firma.
    // La única vía para decidir es POST /api/approvals/:id/decide.
    writable: ["code", "action_type", "requested_at", "amount", "currency", "reason", "payload", "target_table", "target_id", "expires_at", "order", "booking", "payment", "purchase_order"],
    numeric: ["amount"],
    dates: ["requested_at", "decided_at", "expires_at"],
    writeRole: "manager",
  },
  integration: {
    table: "integration",
    search: ["name", "external_id"],
    expand: { partner: true },
    sort: { name: "asc" },
    writable: ["name", "provider", "category", "status", "direction", "endpoint_url", "external_id", "last_sync_at", "last_error", "sync_frequency", "records_synced", "config", "webhook_secret_set", "partner", "user"],
    booleans: ["webhook_secret_set"],
    numeric: ["records_synced"],
    dates: ["last_sync_at"],
    writeRole: "admin",
  },
  /**
   * El libro del saldo prepago (0080).
   *
   * Nada es escribible por el CRUD genérico, y es deliberado: una recarga entra
   * por `/api/partners/wallet`, que comprueba que quien la apunta NO es el
   * socio —quien ve la transferencia en el banco es la operadora—, valida la
   * moneda contra la del contrato y deja auditoría. Abrir estas columnas al
   * CRUD sería dar exactamente ese rodeo.
   *
   * Y el consumo lo escribe la venta, bajo el índice único que impide
   * descontar dos veces la misma orden.
   */
  partner_wallet_movement: {
    table: "partner_wallet_movement",
    search: ["reference"],
    expand: { partner: true, order: true },
    sort: { createdAt: "desc" },
    writable: [],
    writeRole: "owner",
  },
  notification: {
    table: "notification",
    search: ["title"],
    expand: { user: true, partner: true },
    sort: { createdAt: "desc" },
    writable: ["read_status", "read_at"],
    booleans: ["read_status"],
    writeRole: "seller",
  },
};

export function getResource(name: string): ResourceDef | null {
  return RESOURCES[name] ?? null;
}

/**
 * B2B partner isolation (AUD-002/003/004).
 *
 * The generic ERP layer previously only filtered 7 tables by `partner`, and
 * only on the list endpoint, so a `partner`-role user could read the whole
 * company's data (and other partners') via `/api/erp/*`. These sets make the
 * policy explicit and deny-by-default for the partner role.
 */
// Tables a partner owns rows in — always filtered to their own partner id.
// Tables with a real `partner` column, filtered to the caller's own partner id.
// NOTE: `customer` is intentionally NOT here — the customer table has no
// `partner` column, so filtering by it would apply a filter to a non-existent
// field (fail-open risk if the backend ignores unknown filter keys). A partner
// sees customer data only through their own bookings/orders (which expand the
// customer), never by listing the whole customer table.
const PARTNER_OWNED_TABLES = new Set([
  "order", "booking", "commission", "settlement", "receivable", "lead",
  /**
   * `seller` ENTRA COMO PROPIA, NUNCA COMO COMPARTIDA.
   *
   * El tour center necesita ver a su equipo de ventas —es lo que
   * `/portal/vendedores` enseña—, y la tentación es meterlo en la lista de
   * catálogo compartido, que es donde está el resto de lo que el socio
   * consulta sin ser suyo. Sería un error grave: la tabla trae las condiciones
   * de los vendedores INTERNOS de la operadora —su comisión, su meta, su techo
   * de descuento— y «compartida» significa sin filtro de socio.
   *
   * Como propia, el filtro es `partner = <su socio>` y las fichas internas
   * —que tienen ese campo nulo— no salen. El plan del ecosistema lo marcaba
   * como cuidado específico de esta fase; queda escrito aquí porque es donde
   * alguien lo cambiaría.
   */
  "seller",
  /**
   * LA CARTERA, DE CADA UNO LA SUYA.
   *
   * Sin esto el socio no podía terminar una venta: `POST /api/orders` exige
   * `customer_id` y él no tenía forma de buscar ni de crear un cliente.
   * Abrirle `customer` sin acotar habría sido lo contrario del problema — la
   * cartera ENTERA de la operadora, con teléfonos y correos, a la vista de sus
   * revendedores.
   *
   * Propia por `partner` (migración 0075): los clientes de la operadora tienen
   * ese campo nulo y no salen. La operadora los sigue viendo todos.
   */
  "customer",
]);
// Read-only shared catalog a partner may browse (no partner dimension).
// NOTE: `product` is intentionally NOT here — the product table carries
// internal `base_cost`, and the generic ERP layer cannot strip it. Partners
// browse the catalog through `/api/portal/catalog`, which returns only the B2B
// price for their authorized products and never the cost.
const PARTNER_SHARED_TABLES = new Set([
  "departure", "product_modality", "product_category",
  "cancellation_policy", "hotel", "zone",
]);

export type PartnerScope =
  | { kind: "denied" }
  | { kind: "shared" }
  | { kind: "own"; field: string; partnerId: string };

/** Decides how a partner-role user may access a given table. */
/**
 * LO QUE SE LE DENIEGA AL SOCIO A PROPÓSITO, Y POR QUÉ.
 *
 * `partnerScopeFor` deniega por defecto, así que esta lista no CAMBIA nada:
 * existe para que la decisión esté escrita y para que una prueba la sujete. El
 * plan del ecosistema pedía decidirlo «de antemano» justamente porque son las
 * tablas donde la respuesta fácil —añadirlas cuando alguien las pida— es la
 * equivocada.
 *
 * Las cuatro cuelgan de un vendedor y **no tienen columna de socio**. Acotarlas
 * exigiría una subconsulta («los vendedores de mi socio»), que el armador de
 * filtros no sabe expresar; con un filtro por vendedor a secas, el agente de un
 * tour center vería las metas y los bonos de los vendedores INTERNOS de la
 * operadora en cuanto su ficha quedara sin vincular.
 *
 * Se deniegan hasta que haya una razón de negocio y una forma de acotarlas.
 */
export const PARTNER_DENEGADAS_A_PROPOSITO: Record<string, string> = {
  seller_goal: "cuelga del vendedor y no tiene columna de socio: las metas son de la operadora",
  seller_bonus: "igual que las metas, y además es dinero de la operadora a su gente",
  seller_link: "el enlace de atribución es de la red de ventas interna; el socio no atribuye por QR todavía",
  seller_attribution: "el embudo del enlace, por lo mismo",
};

export function partnerScopeFor(table: string, partnerId: string | null): PartnerScope {
  if (!partnerId) return { kind: "denied" };
  if (table === "partner") return { kind: "own", field: "_id", partnerId };
  if (PARTNER_OWNED_TABLES.has(table)) return { kind: "own", field: "partner", partnerId };
  if (PARTNER_SHARED_TABLES.has(table)) return { kind: "shared" };
  return { kind: "denied" };
}

/**
 * Server-side field validation for the generic ERP layer (AUD-U06).
 *
 * Every numeric field written through `/api/erp/*` is validated here, so the
 * whole catalog of 77 resources gets real server-side checks instead of relying
 * on the browser. Previously `sanitizePayload` only coerced types, letting a
 * negative price, a 150% discount or a non-integer pax count reach the database.
 */

// Numeric fields that may legitimately be negative (coordinates, running
// balances, time offsets, ordering). Everything else must be >= 0.
const ALLOW_NEGATIVE = new Set([
  "latitude", "longitude", "balance", "balance_after", "pickup_offset_min", "sort_order",
  // A margin can be negative (sold below cost) or exceed 100% (markup), so it
  // is left unconstrained rather than clamped.
  "margin_percent",
  // Stock levels can legitimately go negative in warehouses that allow it
  // (`warehouse.allows_negative`); these are derived on-hand balances.
  "quantity", "reserved", "available",
]);
// Fields expressed as a discount percentage — must stay within 0..100.
// Only true "percent-of" discount fields; `_rate`/`margin`/absolute `discount`
// are intentionally excluded.
const PERCENT_SUFFIXES: string[] = [];
const PERCENT_EXTRA = new Set(["discount_percent", "discount_pct", "max_discount_pct"]);
// Count-like fields that must be whole numbers.
// NOTE: inventory quantities (`quantity`, `quantity_received`, `reserved`,
// `available`) are intentionally NOT here — items sold by weight/volume (kg, l)
// move in fractional amounts, so forcing integers would reject valid stock
// movements.
const INTEGER_FIELDS = new Set([
  "pax", "pax_total", "pax_assigned", "adults", "children", "infants",
  "seats", "seats_used", "seats_released",
  "capacity", "default_capacity", "capacity_hour",
  "capacity_simultaneous", "max_pax", "min_pax", "guests", "guests_today",
  "entries_allowed", "entries_used", "visits_included", "visits_used",
  "guest_passes", "guest_passes_used", "stops_count", "line_no", "max_uses", "used_count",
]);

function isPercent(key: string): boolean {
  return PERCENT_EXTRA.has(key) || PERCENT_SUFFIXES.some((s) => key.endsWith(s));
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Read authorization by resource (AUD-004 follow-up).
 *
 * The generic ERP GET had no role gate, so any authenticated tenant user
 * (seller/cashier/operations) could read sensitive financial tables. These
 * minimum roles apply to NON-partner roles only — a `partner` is governed
 * separately by `partnerScopeFor` (deny-by-default + own-partner scope), and its
 * low rank would otherwise wrongly block its legitimate own-data reads.
 */
const READ_ROLE: Partial<Record<string, AppRole>> = {
  // Cash desk data — cashiers legitimately handle it.
  payment: "cashier", cash_session: "cashier", cash_movement: "cashier", cash_count: "cashier",
  // Commercial/accounting figures, costs and margins — managers and up.
  commission: "manager", settlement: "manager", receivable: "manager", payable: "manager",
  // `payment_schedule` estaba en `seller`, y esa tabla NO tiene columna de
  // vendedor —el suyo está en la orden, tabla unida, que la capa de consulta no
  // sabe filtrar—. Es decir: cualquier vendedor leía el calendario de cobros de
  // toda la empresa, con quién debe qué y cuándo. El informe de cobros
  // (`/api/reports/collections`) sí se acota, sobre la orden ya expandida; lo
  // que no se podía acotar era el CRUD genérico, así que sube de rango.
  payment_schedule: "manager", booking_cost: "manager",
  commission_rule: "manager", product_cost: "manager", price_rule: "manager",
  ledger_account: "manager", ledger_entry: "manager", invoice: "manager",
  expense: "manager", tax_profile: "manager", purchase_order: "manager", purchase_order_line: "manager",
  // Gobierno de la cuenta — solo administración.
  //
  // Las tres se escriben solo con rol de administrador y sus pantallas también
  // lo exigen, pero la LECTURA por la API genérica estaba abierta a cualquier
  // usuario del inquilino. Un vendedor podía pedir `/api/erp/audit_log` y leer
  // el rastro completo de la empresa —quién cobró qué y quién anuló qué—, o
  // `/api/erp/integration` y ver la configuración de cada conector. El menú no
  // es la barrera; esta tabla sí.
  audit_log: "admin", integration: "admin", ncf_sequence: "admin",
  // La opinión de un huésped es dato comercial sensible: no es para el mostrador.
  guest_survey: "manager",
  accounting_period: "manager",
  // La nómina es el dato más sensible que guarda una empresa pequeña: lo que
  // cobra cada compañero. Sin esto, cualquier usuario del inquilino podía
  // pedir `/api/erp/payroll_line` y leer el sueldo de todo el mundo.
  payroll_run: "admin", payroll_line: "admin",
};

/** Minimum role required to READ a resource (for non-partner roles). */
export function readRoleFor(table: string): AppRole | null {
  return READ_ROLE[table] ?? null;
}

/**
 * LO QUE UN VENDEDOR PUEDE LEER DE SU PROPIO DINERO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA UNA EXCEPCIÓN
 *
 * `READ_ROLE` se evalúa ANTES que el ámbito por fila. Da igual que
 * `seller-scope.ts` sepa acotar las comisiones de un vendedor: la compuerta las
 * reserva a gerencia y devuelve 403 antes de que el filtro llegue a aplicarse.
 * Por eso el vendedor no veía ni su propia comisión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA LISTA NO ES `SELLER_SCOPED`, Y ESA ES LA DECISIÓN
 *
 * Lo cómodo habría sido eximir «las tablas que el ámbito ya acota». Habría sido
 * un agujero: `SELLER_SCOPED` incluye `price_rule` y `commission_rule`, que
 * también se acotan por vendedor pero cuyo contenido es el tarifario y el
 * esquema de comisiones de TODA la empresa y de sus socios.
 *
 * Así que la exención va sobre una lista propia, corta y escrita a mano, con
 * una prueba que falla si alguien mete algo aquí sin que el ámbito lo acote —y
 * otra que comprueba que las reglas comerciales siguen fuera—.
 *
 * Las tres que están son las del dinero de la persona, y las tres son
 * ESTRICTAS en el ámbito (`SELLER_ESTRICTAS`): una fila sin vendedor ahí es de
 * un socio o de un proveedor, no «de nadie», así que abrirlas no abre de paso
 * lo ajeno.
 */
const SELLER_READABLE = new Set(["commission", "settlement", "payable"]);

export function sellerCanReadTable(table: string): boolean {
  return SELLER_READABLE.has(table);
}

/**
 * La autorización de LECTURA de una tabla, en un solo sitio.
 *
 * La escribían por su cuenta el listado, el detalle y la exportación, con la
 * misma condición copiada tres veces. Copiada, basta con que una se quede
 * atrás para que un rol lea por un camino lo que el otro le niega —y la que se
 * queda atrás suele ser la exportación, que es la que se lleva TODO—.
 */
export function assertCanReadTable(
  ctx: { role: AppRole; sellerId?: string | null },
  table: string
): void {
  // El ámbito del socio lo aplica `buildListFilter`; su rango fallaría aquí.
  if (esDeSocio(ctx)) return;
  // Y el del vendedor sobre lo suyo, acotado fila a fila por `seller-scope.ts`.
  if (ctx.role === "seller" && sellerCanReadTable(table)) return;

  const rr = readRoleFor(table);
  if (!rr) return;
  if (!atLeast(ctx.role, rr)) {
    throw new TenantError("No tienes permisos para realizar esta acción", 403);
  }
}

/**
 * Propiedad por fila.
 *
 * La RLS aísla por `organization_id`, no por persona, y `task` tiene
 * `writeRole: "seller"` — el rango más bajo del ERP interno. Sin esta regla
 * cualquier vendedor podía cerrar o reasignar la tarea de otro compañero. El
 * responsable asignado siempre puede; el resto necesita rango de gestión.
 */
const OWNERSHIP_FIELD: Partial<Record<string, string>> = {
  task: "assigned_to_id",
};

/** Rol a partir del cual se puede escribir sobre una fila ajena. */
export const OWNERSHIP_OVERRIDE_ROLE: AppRole = "manager";

/** Columna que identifica al dueño de la fila, o null si la tabla no tiene dueño. */
export function ownershipFieldFor(table: string): string | null {
  return OWNERSHIP_FIELD[table] ?? null;
}

// Enum-like fields that are always safe to filter on, regardless of a
// resource's writable list (e.g. `status` stays filterable even where it was
// removed from `writable` to protect the state machine).
const GLOBAL_FILTERABLE = new Set([
  "_id", "status", "severity", "payment_type", "beneficiary_type", "method",
  "channel", "aging_bucket", "read_status", "operational_status", "checkin_status",
  "result", "priority", "category", "case_type", "movement_type",
]);

/**
 * Allowlist of fields a client may filter on for a resource (AUD-S06 follow-up).
 * Prevents querying arbitrary internal columns through `?filter.<field>=`.
 * Unknown fields are ignored rather than rejected, so the UI never breaks.
 */
export function allowedFilterFields(def: ResourceDef): Set<string> {
  return new Set([
    ...GLOBAL_FILTERABLE,
    ...def.search,
    ...def.writable,
    ...(def.numeric || []),
    ...(def.dates || []),
    ...Object.keys(def.expand || {}),
    ...Object.keys(def.expandOne || {}),
  ]);
}

/** Filters and coerces an incoming payload down to the resource's writable fields. */
/**
 * Convierte a booleano lo que llega del formulario.
 *
 * El `select` manda "yes"/"no"; una API externa o una prueba puede mandar el
 * booleano ya hecho, o "true"/"false". Cualquier otra cosa es un error del
 * llamante y se rechaza en vez de guardarse como falso por descuido.
 */
function coerceBoolean(value: unknown, key: string): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["yes", "true", "1", "si", "sí"].includes(text)) return true;
  if (["no", "false", "0"].includes(text)) return false;
  throw badRequest(`El campo "${key}" debe ser sí o no`);
}

export function sanitizePayload(def: ResourceDef, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of def.writable) {
    if (!(key in body)) continue;
    let value = body[key];
    if (value === "" || value === undefined) value = null;
    if (value !== null && def.numeric?.includes(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw badRequest(`El campo "${key}" debe ser un número válido`);
      }
      if (n < 0 && !ALLOW_NEGATIVE.has(key)) {
        throw badRequest(`El campo "${key}" no puede ser negativo`);
      }
      if (isPercent(key) && n > 100) {
        throw badRequest(`El campo "${key}" no puede superar el 100%`);
      }
      if (INTEGER_FIELDS.has(key) && !Number.isInteger(n)) {
        throw badRequest(`El campo "${key}" debe ser un número entero`);
      }
      value = n;
    }
    if (value !== null && def.dates?.includes(key)) {
      const d = new Date(value as string);
      value = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (value !== null && def.booleans?.includes(key)) {
      value = coerceBoolean(value, key);
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      value = JSON.stringify(value);
    }
    out[key] = value ?? undefined;
  }
  return out;
}
