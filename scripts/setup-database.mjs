/**
 * TOURFLOW ERP — Database schema bootstrap.
 *
 * Creates every table + property (including all objectReference relationships)
 * for the multi-tenant tourism ERP/OMS/Booking platform.
 *
 * Idempotent: existing tables/properties are skipped, missing ones are added.
 *
 * Run with:  node scripts/setup-database.mjs
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
const envRaw = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const API_KEY = process.env.TOTALUM_API_KEY;
const BASE = (process.env.TOTALUM_API_URL || "https://api.totalum.app/").replace(/\/?$/, "/");
const STRUCT = `${BASE}api/v1/data-structure`;

async function call(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "api-key": API_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.errors) {
    throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json?.errors || json)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// property shorthands
// ---------------------------------------------------------------------------
const S = (name, label, extra = {}) => ({ name, label, propertyType: "string", typeExtras: { string: { type: "text" } }, ...extra });
const LINK = (name, label) => ({ name, label, propertyType: "string", typeExtras: { string: { type: "link" } } });
const N = (name, label) => ({ name, label, propertyType: "number" });
const D = (name, label, includeHour = true) => ({ name, label, propertyType: "date", typeExtras: { date: { includeHour } } });
const TXT = (name, label) => ({ name, label, propertyType: "long-string", typeExtras: { "long-string": { type: "text" } } });
const JSN = (name, label) => ({ name, label, propertyType: "long-string", typeExtras: { "long-string": { type: "json" } } });
const FILE = (name, label, multiple = false) => ({ name, label, propertyType: "file", typeExtras: { file: { multiple, compress: true } } });
const YN = (name, label) => ({
  name, label, propertyType: "options",
  typeExtras: { options: [{ value: "yes", color: "#22c55e" }, { value: "no", color: "#94a3b8" }], optionsConfig: { multiple: false } },
});
const OPT = (name, label, values, multiple = false) => ({
  name, label, propertyType: "options",
  typeExtras: {
    options: values.map((v, i) => (typeof v === "string" ? { value: v, color: PALETTE[i % PALETTE.length] } : v)),
    optionsConfig: { multiple },
  },
});
const REF = (name, label, target, relation = "manyToOne") => ({
  name, label, propertyType: "objectReference", __ref: target, __rel: relation,
});
const PALETTE = ["#0e7c86", "#f4a259", "#6366f1", "#ec4899", "#22c55e", "#ef4444", "#8b5cf6", "#14b8a6", "#f59e0b", "#3b82f6", "#a855f7", "#64748b", "#06b6d4", "#78716c", "#0ea5e9"];

const CURRENCIES = ["usd", "dop", "eur", "mxn", "cop", "brl"];
const CHANNELS = ["direct", "web", "phone", "whatsapp", "walk_in", "b2b_portal", "agency", "tour_center", "ota", "pos"];
const LANGS = ["es", "en", "fr", "de", "it", "pt", "ru"];
const MODULES = ["bookings", "crm", "commissions", "settlements", "payments", "cash_pos", "transport", "pickups", "operations", "b2b_portal", "accounting", "reports", "audit"];

/** Tenant scope column present on every business table. */
const TENANT = () => REF("company", "Empresa", "company");

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
const TABLES = [
  // ======================= SaaS / tenant core ==============================
  {
    type: "plan", label: "Planes SaaS", icon: "fa-solid fa-layer-group", visible: true,
    description: "Planes de suscripcion de la plataforma con limites y modulos habilitados",
    props: [
      S("name", "Nombre", { showInTree: true }), S("code", "Codigo"), TXT("description", "Descripcion"),
      N("monthly_price", "Precio mensual"), N("yearly_price", "Precio anual"),
      OPT("currency", "Moneda", CURRENCIES),
      N("max_users", "Max usuarios"), N("max_bookings_month", "Max reservas/mes"),
      N("max_storage_mb", "Max almacenamiento MB"), N("max_products", "Max productos"), N("trial_days", "Dias de prueba"),
      OPT("modules_enabled", "Modulos habilitados", MODULES, true),
      YN("is_premium", "Premium"), OPT("status", "Estado", ["active", "inactive"]), N("sort_order", "Orden"),
    ],
  },
  {
    type: "company", label: "Empresas (Tenants)", icon: "fa-solid fa-building", visible: true,
    description: "Empresa/tenant del SaaS. Raiz del aislamiento multi-tenant.",
    props: [
      S("name", "Nombre", { showInTree: true }), S("slug", "Slug"), S("legal_name", "Razon social"), S("tax_id", "RNC"),
      OPT("company_type", "Tipo de empresa", ["park", "excursion_company", "tour_operator", "tour_center", "agency", "transport", "mixed_operator", "other"]),
      S("group_name", "Grupo empresarial"), S("email", "Email"), S("phone", "Telefono"), S("whatsapp", "WhatsApp"),
      S("address", "Direccion"), S("city", "Ciudad"), S("country", "Pais"), S("timezone", "Zona horaria"),
      FILE("logo", "Logo"), LINK("logo_url", "Logo URL"), S("brand_color", "Color de marca"),
      OPT("base_currency", "Moneda contable", CURRENCIES),
      REF("plan", "Plan", "plan"),
      OPT("subscription_status", "Estado suscripcion", ["trial", "active", "past_due", "cancelled", "suspended"]),
      D("trial_ends_at", "Fin de prueba"), D("next_billing_at", "Proximo cobro"),
      S("stripe_customer_id", "Stripe customer"), S("stripe_subscription_id", "Stripe subscription"),
      OPT("modules_enabled", "Modulos habilitados", MODULES, true),
      N("storage_used_mb", "Almacenamiento usado MB"),
      OPT("status", "Estado", ["active", "inactive", "suspended"]),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "subscription_invoice", label: "Facturas SaaS", icon: "fa-solid fa-file-invoice-dollar", visible: false,
    description: "Historico de cobros de suscripcion de cada empresa",
    props: [
      TENANT(), REF("plan", "Plan", "plan"), S("invoice_number", "Numero", { showInTree: true }),
      D("period_from", "Periodo desde"), D("period_to", "Periodo hasta"),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["pending", "paid", "failed", "refunded"]),
      D("issued_at", "Emitida"), D("paid_at", "Pagada"),
    ],
  },

  // ======================= org structure ===================================
  {
    type: "branch", label: "Sucursales y Parques", icon: "fa-solid fa-location-dot", visible: true,
    description: "Sucursales, parques, tour centers propios y puntos de venta de la empresa",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("branch_type", "Tipo", ["park", "office", "tour_center", "pos", "warehouse", "other"]),
      S("address", "Direccion"), S("city", "Ciudad"), S("phone", "Telefono"), S("email", "Email"),
      REF("manager", "Responsable", "user"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "partner", label: "Partners / Tour Centers / Agencias", icon: "fa-solid fa-handshake", visible: true,
    description: "Tour centers, agencias, subagencias y tour operators que comercializan los productos",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("commercial_name", "Nombre comercial"),
      OPT("partner_type", "Tipo", ["tour_center", "agency", "subagency", "tour_operator", "hotel", "ota", "reseller"]),
      S("tax_id", "RNC / Identificacion"), S("contact_name", "Contacto"), S("email", "Email"),
      S("phone", "Telefono"), S("whatsapp", "WhatsApp"), S("address", "Direccion"), S("city", "Ciudad"), S("country", "Pais"),
      N("credit_limit", "Limite de credito"), N("credit_days", "Dias de credito"),
      OPT("currency", "Moneda", CURRENCIES), N("default_commission_pct", "Comision estandar %"),
      N("balance", "Saldo pendiente"), LINK("logo_url", "Logo URL"), FILE("contract_file", "Contrato"),
      OPT("status", "Estado", ["active", "inactive", "blocked", "pending"]),
      D("contract_from", "Contrato desde", false), D("contract_to", "Contrato hasta", false),
      TXT("commercial_terms", "Condiciones comerciales"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "seller", label: "Vendedores", icon: "fa-solid fa-user-tie", visible: true,
    description: "Vendedores propios y de partners, con comisiones, metas y limites",
    props: [
      TENANT(), REF("user", "Usuario", "user"), REF("partner", "Partner", "partner"), REF("branch", "Sucursal", "branch"),
      S("code", "Codigo"), S("first_name", "Nombre", { showInTree: true }), S("last_name", "Apellido"),
      S("email", "Email"), S("phone", "Telefono"), S("whatsapp", "WhatsApp"),
      OPT("seller_role", "Rol", ["seller", "supervisor", "manager", "promoter", "agent"]),
      N("commission_pct", "Comision estandar %"), N("monthly_goal", "Meta mensual"), N("max_discount_pct", "Max descuento %"),
      OPT("currency", "Moneda", CURRENCIES), LINK("photo_url", "Foto URL"),
      D("hire_date", "Fecha de ingreso", false),
      OPT("status", "Estado", ["active", "inactive", "suspended"]), TXT("notes", "Notas"),
    ],
  },

  // ======================= geography ======================================
  {
    type: "zone", label: "Zonas", icon: "fa-solid fa-map", visible: true,
    description: "Zonas turisticas usadas para agrupar hoteles y rutas de pickup",
    props: [TENANT(), S("name", "Nombre", { showInTree: true }), TXT("description", "Descripcion"), S("color", "Color"), OPT("status", "Estado", ["active", "inactive"])],
  },
  {
    type: "hotel", label: "Hoteles", icon: "fa-solid fa-hotel", visible: true,
    description: "Hoteles y puntos de recogida de pasajeros",
    props: [
      TENANT(), REF("zone", "Zona", "zone"), S("name", "Nombre", { showInTree: true }),
      S("address", "Direccion"), S("phone", "Telefono"),
      OPT("category", "Categoria", ["1_star", "2_star", "3_star", "4_star", "5_star", "boutique", "apartment"]),
      S("pickup_point", "Punto de recogida"), N("latitude", "Latitud"), N("longitude", "Longitud"),
      N("pickup_offset_min", "Offset pickup (min)"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
    ],
  },

  // ======================= catalog ========================================
  {
    type: "product_category", label: "Categorias de producto", icon: "fa-solid fa-tags", visible: true,
    description: "Categorias del catalogo de excursiones y productos",
    props: [TENANT(), S("name", "Nombre", { showInTree: true }), TXT("description", "Descripcion"), S("color", "Color"), S("icon", "Icono"), N("sort_order", "Orden"), OPT("status", "Estado", ["active", "inactive"])],
  },
  {
    type: "cancellation_policy", label: "Politicas de cancelacion", icon: "fa-solid fa-file-contract", visible: true,
    description: "Politicas configurables de cancelacion y reembolso por tramos horarios",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), TXT("description", "Descripcion"),
      JSN("tiers", "Tramos (JSON)"), N("no_show_refund_pct", "Reembolso no-show %"),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "product", label: "Excursiones y Productos", icon: "fa-solid fa-umbrella-beach", visible: true,
    description: "Catalogo de excursiones, entradas, transporte y paquetes",
    props: [
      TENANT(), REF("category", "Categoria", "product_category"), REF("cancellation_policy", "Politica de cancelacion", "cancellation_policy"),
      S("name", "Nombre", { showInTree: true }), S("code", "Codigo interno"),
      OPT("product_type", "Tipo", ["excursion", "ticket", "transport", "package", "activity", "rental"]),
      TXT("short_description", "Descripcion corta"), TXT("description", "Descripcion completa"),
      FILE("images", "Imagenes", true), LINK("cover_image_url", "Imagen de portada"), LINK("video_url", "Video"),
      S("location", "Ubicacion"), S("meeting_point", "Punto de encuentro"),
      N("duration_hours", "Duracion (horas)"), OPT("languages", "Idiomas", LANGS, true),
      N("min_age", "Edad minima"), N("default_capacity", "Capacidad por defecto"),
      TXT("restrictions", "Restricciones"), TXT("recommendations", "Recomendaciones"),
      TXT("inclusions", "Incluye"), TXT("exclusions", "No incluye"),
      TXT("terms", "Terminos"), TXT("instructions", "Instrucciones"),
      N("base_price", "Precio base"), N("base_cost", "Costo base"), OPT("currency", "Moneda", CURRENCIES),
      YN("featured", "Destacado"), N("sort_order", "Orden"),
      OPT("status", "Estado", ["active", "inactive", "draft", "seasonal"]),
    ],
  },
  {
    type: "product_modality", label: "Modalidades", icon: "fa-solid fa-people-group", visible: true,
    description: "Modalidades y tarifas de cada excursion (adulto, nino, VIP, privado, vehiculo...)",
    props: [
      TENANT(), REF("product", "Producto", "product"),
      S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("modality_type", "Tipo", ["adult", "child", "infant", "resident", "foreigner", "private", "vip", "group", "vehicle", "couple"]),
      N("price", "Precio"), N("cost", "Costo"), OPT("currency", "Moneda", CURRENCIES),
      N("min_pax", "Min pax"), N("max_pax", "Max pax"), N("age_from", "Edad desde"), N("age_to", "Edad hasta"),
      N("capacity_weight", "Peso en cupo"), N("sort_order", "Orden"),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "price_rule", label: "Reglas de precio", icon: "fa-solid fa-money-check-dollar", visible: true,
    description: "Precios especiales por partner, vendedor, canal, temporada, dia y cantidad",
    props: [
      TENANT(), REF("product", "Producto", "product"), REF("modality", "Modalidad", "product_modality"),
      REF("partner", "Partner", "partner"), REF("seller", "Vendedor", "seller"),
      S("name", "Nombre", { showInTree: true }),
      OPT("price_type", "Tipo de precio", ["standard", "per_person", "per_group", "per_vehicle", "b2c", "b2b"]),
      OPT("channel", "Canal", CHANNELS),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      D("season_from", "Temporada desde", false), D("season_to", "Temporada hasta", false),
      OPT("weekdays", "Dias de semana", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], true),
      S("time_from", "Hora desde"), S("time_to", "Hora hasta"),
      N("min_qty", "Cantidad minima"), N("max_qty", "Cantidad maxima"),
      N("priority", "Prioridad"), OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "departure", label: "Salidas / Disponibilidad", icon: "fa-solid fa-calendar-day", visible: true,
    description: "Salidas (departures/sessions) de cada excursion con cupo y disponibilidad en tiempo real",
    props: [
      TENANT(), REF("product", "Producto", "product"), REF("branch", "Sucursal", "branch"),
      D("departure_at", "Fecha y hora de salida"), S("departure_time", "Hora"),
      N("capacity", "Capacidad"), N("booked_pax", "Pax confirmados"), N("pending_pax", "Pax pendientes"),
      N("available_pax", "Plazas disponibles"), N("waitlist_pax", "Lista de espera"),
      N("cutoff_hours", "Cierre (horas antes)"),
      OPT("status", "Estado", ["available", "almost_full", "full", "closed", "cancelled", "completed"]),
      S("meeting_point", "Punto de encuentro"), TXT("notes", "Notas"),
    ],
  },

  // ======================= customers & CRM =================================
  {
    type: "customer", label: "Clientes", icon: "fa-solid fa-users", visible: true,
    description: "Compradores/clientes con su historial comercial",
    props: [
      TENANT(), REF("hotel", "Hotel", "hotel"), REF("assigned_seller", "Vendedor asignado", "seller"),
      S("first_name", "Nombre", { showInTree: true }), S("last_name", "Apellido"),
      S("email", "Email"), S("phone", "Telefono"), S("whatsapp", "WhatsApp"),
      S("nationality", "Nacionalidad"), OPT("language", "Idioma", LANGS), S("country", "Pais"),
      S("room", "Habitacion"), S("address", "Direccion"), S("document_id", "Documento"),
      D("birth_date", "Fecha de nacimiento", false),
      OPT("tags", "Etiquetas", ["vip", "repeat", "family", "honeymoon", "group", "influencer", "complaint"], true),
      OPT("source", "Origen", ["walk_in", "referral", "web", "social", "hotel", "agency", "campaign", "other"]),
      N("total_spent", "Total gastado"), N("bookings_count", "Reservas"),
      OPT("status", "Estado", ["active", "inactive", "blacklist"]),
      TXT("preferences", "Preferencias"), TXT("notes", "Observaciones"),
    ],
  },
  {
    type: "lead", label: "Leads (CRM)", icon: "fa-solid fa-bullseye", visible: true,
    description: "Pipeline comercial de oportunidades turisticas",
    props: [
      TENANT(), REF("customer", "Cliente", "customer"), REF("seller", "Vendedor responsable", "seller"),
      REF("product", "Producto de interes", "product"), REF("partner", "Partner", "partner"),
      S("name", "Nombre", { showInTree: true }), S("email", "Email"), S("phone", "Telefono"), S("whatsapp", "WhatsApp"),
      OPT("source", "Fuente", ["walk_in", "referral", "web", "whatsapp", "social", "hotel", "agency", "campaign", "phone", "other"]),
      OPT("status", "Estado", ["new", "contacted", "interested", "quoted", "follow_up", "booked", "lost"]),
      N("estimated_value", "Valor estimado"), OPT("currency", "Moneda", CURRENCIES),
      N("pax", "Pasajeros"), D("travel_date", "Fecha de viaje", false), D("next_action_at", "Proxima accion"),
      S("lost_reason", "Motivo de perdida"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "crm_activity", label: "Actividades CRM", icon: "fa-solid fa-comments", visible: true,
    description: "Conversaciones, notas y tareas asociadas a leads y clientes",
    props: [
      TENANT(), REF("lead", "Lead", "lead"), REF("customer", "Cliente", "customer"), REF("user", "Usuario", "user"),
      OPT("activity_type", "Tipo", ["call", "whatsapp", "email", "sms", "note", "task", "meeting"]),
      S("subject", "Asunto", { showInTree: true }), TXT("notes", "Notas"),
      D("due_at", "Vence"), D("done_at", "Realizada"),
      OPT("status", "Estado", ["pending", "done", "cancelled"]),
    ],
  },

  // ======================= orders & bookings ===============================
  {
    type: "promotion", label: "Promociones", icon: "fa-solid fa-percent", visible: true,
    description: "Promociones y cupones aplicables por canal y periodo",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("discount_type", "Tipo de descuento", ["percentage", "fixed"]), N("value", "Valor"),
      D("valid_from", "Valido desde", false), D("valid_to", "Valido hasta", false),
      N("max_uses", "Usos maximos"), N("used_count", "Usos"), N("min_amount", "Importe minimo"),
      OPT("channels", "Canales", CHANNELS, true),
      OPT("status", "Estado", ["active", "inactive", "expired"]), TXT("description", "Descripcion"),
      REF("products", "Productos", "product", "manyToMany"),
    ],
  },
  {
    type: "order", label: "Ordenes", icon: "fa-solid fa-receipt", visible: true,
    description: "Orden de venta multiproducto que agrupa una o varias reservas",
    props: [
      TENANT(), S("order_number", "Numero de orden", { showInTree: true }),
      REF("customer", "Cliente", "customer"), REF("branch", "Sucursal", "branch"),
      REF("seller", "Vendedor", "seller"), REF("partner", "Partner", "partner"),
      REF("promotion", "Promocion", "promotion"), REF("created_by", "Creada por", "user"),
      OPT("channel", "Canal", CHANNELS),
      OPT("status", "Estado", ["draft", "pending", "pending_payment", "confirmed", "partially_paid", "paid", "completed", "cancelled", "refunded"]),
      D("order_date", "Fecha"),
      OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa de cambio"),
      N("subtotal", "Subtotal"), N("discount_total", "Descuentos"), N("tax_total", "Impuestos"),
      N("total", "Total"), N("paid_total", "Pagado"), N("balance", "Saldo"),
      OPT("base_currency", "Moneda contable", CURRENCIES), N("base_currency_total", "Total en moneda contable"),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "booking", label: "Reservas", icon: "fa-solid fa-ticket", visible: true,
    description: "Reserva de una excursion en una salida concreta. Nucleo operativo y financiero.",
    props: [
      TENANT(), S("booking_number", "Numero de reserva", { showInTree: true }),
      REF("order", "Orden", "order"), REF("customer", "Cliente", "customer"),
      REF("product", "Excursion", "product"), REF("departure", "Salida", "departure"),
      REF("modality", "Modalidad", "product_modality"), REF("branch", "Sucursal", "branch"),
      REF("seller", "Vendedor", "seller"), REF("partner", "Partner", "partner"),
      REF("pickup_hotel", "Hotel de pickup", "hotel"),
      REF("created_by", "Creada por", "user"), REF("checked_in_by", "Check-in por", "user"),
      OPT("channel", "Canal", CHANNELS),
      OPT("status", "Estado", ["draft", "pending", "pending_payment", "confirmed", "partially_paid", "paid", "checked_in", "no_show", "completed", "cancelled", "refunded", "partially_refunded"]),
      D("booking_date", "Fecha de reserva"), D("travel_date", "Fecha de viaje"),
      N("adults", "Adultos"), N("children", "Ninos"), N("infants", "Infantes"), N("pax_total", "Total pax"),
      N("unit_price", "Precio unitario"), N("gross_amount", "Importe bruto"),
      N("discount_amount", "Descuento"), N("tax_amount", "Impuestos"), N("total_amount", "Total"),
      N("cost_amount", "Costo"), N("margin_amount", "Margen"),
      N("paid_amount", "Pagado"), N("balance_amount", "Saldo"), N("refund_amount", "Reembolsado"),
      OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa de cambio"),
      OPT("base_currency", "Moneda contable", CURRENCIES), N("base_amount", "Total en moneda contable"),
      JSN("price_snapshot", "Snapshot de precio"),
      S("pickup_time", "Hora de pickup"), S("pickup_location", "Lugar de pickup"), S("room_number", "Habitacion"),
      S("voucher_code", "Codigo de voucher"),
      OPT("checkin_status", "Estado check-in", ["pending", "partial", "done", "no_show"]),
      D("checked_in_at", "Check-in realizado"), N("checked_in_pax", "Pax con check-in"),
      D("cancelled_at", "Cancelada el"), S("cancel_reason", "Motivo de cancelacion"),
      YN("capacity_override", "Override de cupo"), S("override_reason", "Motivo del override"),
      TXT("notes", "Notas del cliente"), TXT("internal_notes", "Notas internas"),
    ],
  },
  {
    type: "participant", label: "Pasajeros", icon: "fa-solid fa-person-walking-luggage", visible: true,
    description: "Participantes/pasajeros de cada reserva (pueden diferir del comprador)",
    props: [
      TENANT(), REF("booking", "Reserva", "booking"),
      S("full_name", "Nombre completo", { showInTree: true }), N("age", "Edad"),
      OPT("category", "Categoria", ["adult", "child", "infant", "senior"]),
      S("document_id", "Documento"), S("nationality", "Nacionalidad"),
      FILE("document_file", "Documento adjunto"),
      OPT("checkin_status", "Estado check-in", ["pending", "done", "no_show"]),
      TXT("special_requirements", "Requerimientos especiales"), TXT("notes", "Observaciones"),
    ],
  },
  {
    type: "voucher", label: "Vouchers", icon: "fa-solid fa-qrcode", visible: true,
    description: "Voucher/ticket unico emitido por reserva confirmada",
    props: [
      TENANT(), REF("booking", "Reserva", "booking"), REF("order", "Orden", "order"),
      S("code", "Codigo", { showInTree: true }), S("qr_data", "Datos QR"),
      OPT("status", "Estado", ["valid", "used", "cancelled", "expired"]),
      D("issued_at", "Emitido"), D("used_at", "Utilizado"), D("expires_at", "Expira"),
      FILE("pdf_file", "PDF"), TXT("notes", "Notas"),
    ],
  },

  // ======================= commissions & settlements =======================
  {
    type: "commission_rule", label: "Reglas de comision", icon: "fa-solid fa-scale-balanced", visible: true,
    description: "Motor de reglas de comision con prioridad explicita y multiples criterios",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), N("priority", "Prioridad"),
      OPT("beneficiary_type", "Beneficiario", ["seller", "supervisor", "partner", "guide", "supplier"]),
      OPT("calc_type", "Tipo de calculo", ["percentage", "fixed", "tiered", "volume"]),
      N("value", "Valor"), JSN("tiers", "Escalones (JSON)"),
      REF("product", "Producto", "product"), REF("category", "Categoria", "product_category"),
      REF("partner", "Partner", "partner"), REF("seller", "Vendedor", "seller"),
      OPT("channel", "Canal", CHANNELS),
      D("season_from", "Temporada desde", false), D("season_to", "Temporada hasta", false),
      N("min_sales", "Ventas minimas"), N("max_sales", "Ventas maximas"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["active", "inactive"]), TXT("description", "Descripcion"),
    ],
  },
  {
    type: "commission", label: "Comisiones", icon: "fa-solid fa-hand-holding-dollar", visible: true,
    description: "Comision generada por venta, con snapshot inmutable de la regla aplicada",
    props: [
      TENANT(), REF("booking", "Reserva", "booking"), REF("order", "Orden", "order"),
      REF("rule", "Regla aplicada", "commission_rule"), REF("settlement", "Liquidacion", "settlement"),
      REF("seller", "Vendedor", "seller"), REF("partner", "Partner", "partner"), REF("user", "Usuario", "user"),
      OPT("beneficiary_type", "Beneficiario", ["seller", "supervisor", "partner", "guide", "supplier"]),
      S("beneficiary_name", "Nombre beneficiario", { showInTree: true }),
      N("base_amount", "Base de calculo"), OPT("calc_type", "Tipo de calculo", ["percentage", "fixed", "tiered", "volume"]),
      N("percentage", "Porcentaje"), N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["pending", "approved", "settled", "paid", "cancelled", "held", "disputed"]),
      D("generated_at", "Generada"), D("approved_at", "Aprobada"),
      JSN("snapshot", "Snapshot de la regla"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "settlement", label: "Liquidaciones", icon: "fa-solid fa-file-invoice", visible: true,
    description: "Liquidacion periodica de comisiones a vendedores, partners, guias y proveedores",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("beneficiary_type", "Beneficiario", ["seller", "supervisor", "partner", "guide", "supplier"]),
      REF("partner", "Partner", "partner"), REF("seller", "Vendedor", "seller"),
      REF("approved_by", "Aprobada por", "user"),
      D("period_from", "Periodo desde", false), D("period_to", "Periodo hasta", false),
      N("sales_total", "Ventas"), N("cancellations_total", "Cancelaciones"), N("base_total", "Base"),
      N("commission_total", "Comision"), N("paid_total", "Pagado"), N("pending_total", "Pendiente"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["pending", "approved", "partially_paid", "paid", "held", "disputed", "void"]),
      D("issued_at", "Emitida"), D("paid_at", "Pagada"), FILE("pdf_file", "Documento"), TXT("notes", "Notas"),
    ],
  },

  // ======================= finance =========================================
  {
    type: "cash_register", label: "Cajas", icon: "fa-solid fa-cash-register", visible: true,
    description: "Cajas/terminales fisicas de taquillas y puntos de venta",
    props: [
      TENANT(), REF("branch", "Sucursal", "branch"),
      S("name", "Nombre", { showInTree: true }), S("code", "Codigo"), S("terminal", "Terminal"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "cash_session", label: "Sesiones de caja", icon: "fa-solid fa-vault", visible: true,
    description: "Apertura, arqueo y cierre de caja con diferencias",
    props: [
      TENANT(), REF("cash_register", "Caja", "cash_register"), REF("branch", "Sucursal", "branch"), REF("user", "Usuario", "user"),
      S("code", "Codigo", { showInTree: true }),
      D("opened_at", "Apertura"), D("closed_at", "Cierre"),
      N("opening_amount", "Fondo inicial"), N("expected_cash", "Efectivo esperado"), N("counted_cash", "Efectivo contado"),
      N("difference", "Diferencia"), N("card_total", "Tarjeta"), N("transfer_total", "Transferencias"),
      N("sales_total", "Ventas"), N("expenses_total", "Gastos"), N("withdrawals_total", "Retiros"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["open", "closed", "reconciled"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "payment", label: "Pagos", icon: "fa-solid fa-credit-card", visible: true,
    description: "Cobros, reembolsos y depositos asociados a ordenes y reservas",
    props: [
      TENANT(), REF("order", "Orden", "order"), REF("booking", "Reserva", "booking"),
      REF("customer", "Cliente", "customer"), REF("partner", "Partner", "partner"),
      REF("cash_session", "Sesion de caja", "cash_session"), REF("branch", "Sucursal", "branch"), REF("user", "Usuario", "user"),
      S("reference", "Referencia", { showInTree: true }),
      OPT("payment_type", "Tipo", ["payment", "refund", "deposit", "credit_note"]),
      OPT("method", "Metodo", ["cash", "card", "transfer", "payment_link", "deposit", "b2b_credit", "mixed", "other"]),
      OPT("status", "Estado", ["pending", "authorized", "completed", "rejected", "cancelled", "refunded", "partially_refunded"]),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa"),
      OPT("base_currency", "Moneda contable", CURRENCIES), N("base_amount", "Importe contable"),
      D("paid_at", "Fecha de pago"), FILE("receipt_file", "Comprobante"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "cash_movement", label: "Movimientos de caja", icon: "fa-solid fa-right-left", visible: true,
    description: "Entradas y salidas de efectivo dentro de una sesion de caja",
    props: [
      TENANT(), REF("cash_session", "Sesion de caja", "cash_session"), REF("user", "Usuario", "user"), REF("payment", "Pago", "payment"),
      OPT("movement_type", "Tipo", ["sale", "refund", "expense", "withdrawal", "deposit", "adjustment", "opening", "closing"]),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      S("concept", "Concepto", { showInTree: true }), S("reference", "Referencia"),
      D("movement_at", "Fecha"),
    ],
  },
  {
    type: "receivable", label: "Cuentas por cobrar", icon: "fa-solid fa-file-invoice-dollar", visible: true,
    description: "Deuda de partners y clientes con antiguedad (aging) y control de credito",
    props: [
      TENANT(), REF("partner", "Partner", "partner"), REF("customer", "Cliente", "customer"), REF("order", "Orden", "order"),
      S("document_number", "Documento", { showInTree: true }),
      D("issue_date", "Emision", false), D("due_date", "Vencimiento", false),
      N("amount", "Importe"), N("paid_amount", "Cobrado"), N("balance", "Saldo"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["pending", "partially_paid", "paid", "overdue", "written_off"]),
      OPT("aging_bucket", "Antiguedad", ["current", "d1_30", "d31_60", "d61_90", "d90_plus"]),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "supplier", label: "Proveedores", icon: "fa-solid fa-truck-field", visible: true,
    description: "Transportistas, restaurantes, barcos, parques y servicios externos",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }),
      OPT("supplier_type", "Tipo", ["transport", "restaurant", "boat", "park", "guide", "hotel", "equipment", "other"]),
      S("tax_id", "RNC"), S("contact_name", "Contacto"), S("email", "Email"), S("phone", "Telefono"), S("address", "Direccion"),
      OPT("currency", "Moneda", CURRENCIES), N("payment_terms_days", "Dias de pago"), N("balance", "Saldo"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "payable", label: "Cuentas por pagar", icon: "fa-solid fa-money-bill-transfer", visible: true,
    description: "Obligaciones con proveedores, transportistas, guias, vendedores y partners",
    props: [
      TENANT(), REF("supplier", "Proveedor", "supplier"), REF("partner", "Partner", "partner"),
      REF("seller", "Vendedor", "seller"), REF("settlement", "Liquidacion", "settlement"),
      S("concept", "Concepto", { showInTree: true }),
      OPT("category", "Categoria", ["transport", "guide", "supplier", "commission", "salary", "service", "other"]),
      N("amount", "Importe"), N("paid_amount", "Pagado"), N("balance", "Saldo"),
      OPT("currency", "Moneda", CURRENCIES),
      D("issue_date", "Emision", false), D("due_date", "Vencimiento", false), D("paid_at", "Pagada"),
      OPT("status", "Estado", ["pending", "partially_paid", "paid", "overdue", "cancelled"]),
      S("reference", "Referencia"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "expense_category", label: "Categorias de gasto", icon: "fa-solid fa-folder-tree", visible: true,
    description: "Categorias configurables de gastos operativos",
    props: [TENANT(), S("name", "Nombre", { showInTree: true }), TXT("description", "Descripcion"), S("color", "Color"), OPT("status", "Estado", ["active", "inactive"])],
  },
  {
    type: "expense", label: "Gastos", icon: "fa-solid fa-wallet", visible: true,
    description: "Gastos operativos con comprobantes adjuntos",
    props: [
      TENANT(), REF("category", "Categoria", "expense_category"), REF("branch", "Sucursal", "branch"),
      REF("supplier", "Proveedor", "supplier"), REF("user", "Usuario", "user"),
      REF("cash_session", "Sesion de caja", "cash_session"),
      S("concept", "Concepto", { showInTree: true }),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa"),
      D("expense_date", "Fecha", false),
      OPT("payment_method", "Metodo de pago", ["cash", "card", "transfer", "credit", "other"]),
      OPT("status", "Estado", ["pending", "approved", "paid", "rejected"]),
      FILE("receipt_file", "Comprobante"), TXT("notes", "Notas"),
    ],
  },
  {
    type: "ledger_account", label: "Plan de cuentas", icon: "fa-solid fa-list-ol", visible: true,
    description: "Cuentas contables del mayor (partida doble)",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }), S("name", "Nombre"),
      OPT("account_type", "Tipo", ["asset", "liability", "equity", "revenue", "expense", "contra"]),
      S("subledger", "Submayor"),
      OPT("normal_side", "Naturaleza", ["debit", "credit"]),
      YN("is_postable", "Imputable"), N("balance", "Saldo"),
      OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "ledger_entry", label: "Libro diario", icon: "fa-solid fa-book", visible: true,
    description: "Lineas de asiento contable (inmutables); un asiento agrupa varias por entry_code",
    props: [
      TENANT(), S("entry_code", "Asiento", { showInTree: true }), N("line_no", "Linea"),
      D("posted_at", "Fecha"), S("period", "Periodo"),
      REF("ledger_account", "Cuenta", "ledger_account"),
      N("debit", "Debe"), N("credit", "Haber"),
      OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa"), N("amount_base", "Importe base"),
      TXT("memo", "Concepto"),
      OPT("source_type", "Origen", ["sale", "payment", "refund", "commission", "settlement", "expense", "payable", "purchase", "inventory", "payroll", "adjustment", "opening", "tax", "gift_card", "membership"]),
      YN("reversed", "Reversado"), S("reversal_of", "Reversa de"),
      REF("user", "Usuario", "user"),
      REF("order", "Orden", "order"), REF("payment", "Pago", "payment"),
      REF("settlement", "Liquidacion", "settlement"), REF("expense", "Gasto", "expense"),
      REF("payable", "Cuenta por pagar", "payable"), REF("receivable", "Cuenta por cobrar", "receivable"),
    ],
  },
  {
    type: "currency_rate", label: "Tasas de cambio", icon: "fa-solid fa-coins", visible: true,
    description: "Tasas de cambio historicas usadas para convertir a moneda contable",
    props: [
      TENANT(), OPT("currency_from", "Desde", CURRENCIES), OPT("currency_to", "Hasta", CURRENCIES),
      N("rate", "Tasa"), D("rate_date", "Fecha", false), S("source", "Fuente"),
    ],
  },

  // ======================= operations ======================================
  {
    type: "staff", label: "Guias y personal operativo", icon: "fa-solid fa-user-shield", visible: true,
    description: "Guias, conductores, fotografos, coordinadores y personal externo",
    props: [
      TENANT(), REF("supplier", "Proveedor", "supplier"), REF("user", "Usuario", "user"),
      S("full_name", "Nombre completo", { showInTree: true }),
      OPT("staff_type", "Tipo", ["guide", "driver", "photographer", "coordinator", "external"]),
      OPT("languages", "Idiomas", LANGS, true),
      S("phone", "Telefono"), S("email", "Email"), S("document_id", "Documento"),
      FILE("document_file", "Documentos", true), LINK("photo_url", "Foto"),
      N("daily_rate", "Tarifa diaria"), OPT("currency", "Moneda", CURRENCIES),
      D("hire_date", "Alta", false), D("license_expiry", "Vencimiento licencia", false),
      OPT("status", "Estado", ["active", "inactive", "unavailable"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "vehicle", label: "Vehiculos", icon: "fa-solid fa-bus", visible: true,
    description: "Flota propia y de proveedores con capacidad y documentacion",
    props: [
      TENANT(), REF("supplier", "Proveedor", "supplier"), REF("driver", "Conductor", "staff"),
      S("name", "Nombre", { showInTree: true }), S("plate", "Matricula"),
      OPT("vehicle_type", "Tipo", ["bus", "minibus", "van", "suv_4x4", "boat", "catamaran", "buggy", "other"]),
      N("capacity", "Capacidad"), LINK("photo_url", "Foto"),
      D("insurance_expiry", "Vence seguro", false), D("inspection_expiry", "Vence inspeccion", false),
      OPT("status", "Estado", ["available", "in_service", "maintenance", "out_of_service"]),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "product_cost", label: "Costos de producto", icon: "fa-solid fa-calculator", visible: true,
    description: "Costos por proveedor asociados a cada excursion para calcular rentabilidad",
    props: [
      TENANT(), REF("product", "Producto", "product"), REF("supplier", "Proveedor", "supplier"),
      S("concept", "Concepto", { showInTree: true }),
      OPT("cost_type", "Tipo de costo", ["per_person", "per_group", "per_departure", "per_vehicle", "percentage", "fixed"]),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "pickup_route", label: "Rutas de pickup", icon: "fa-solid fa-route", visible: true,
    description: "Rutas de recogida por zona asignadas a un vehiculo y equipo",
    props: [
      TENANT(), REF("departure", "Salida", "departure"), REF("zone", "Zona", "zone"),
      REF("vehicle", "Vehiculo", "vehicle"), REF("driver", "Conductor", "staff"), REF("guide", "Guia", "staff"),
      S("name", "Nombre", { showInTree: true }), S("start_time", "Hora de inicio"),
      N("pax_total", "Pax"), N("stops_count", "Paradas"),
      OPT("status", "Estado", ["planned", "confirmed", "in_progress", "completed", "cancelled"]),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "pickup", label: "Pickups", icon: "fa-solid fa-van-shuttle", visible: true,
    description: "Recogida concreta de una reserva en un hotel dentro de una ruta",
    props: [
      TENANT(), REF("booking", "Reserva", "booking"), REF("hotel", "Hotel", "hotel"), REF("route", "Ruta", "pickup_route"),
      S("pickup_time", "Hora de pickup", { showInTree: true }), S("location", "Ubicacion"), S("room", "Habitacion"),
      N("pax", "Pax"),
      OPT("status", "Estado", ["pending", "confirmed", "picked_up", "no_show", "cancelled"]),
      TXT("notes", "Notas"),
    ],
  },
  {
    type: "departure_resource", label: "Recursos de salida", icon: "fa-solid fa-clipboard-check", visible: true,
    description: "Asignacion de vehiculos, guias y personal a cada salida con deteccion de conflictos",
    props: [
      TENANT(), REF("departure", "Salida", "departure"), REF("vehicle", "Vehiculo", "vehicle"), REF("staff", "Personal", "staff"),
      OPT("resource_role", "Rol", ["guide", "driver", "photographer", "coordinator", "vehicle", "equipment"]),
      N("pax_assigned", "Pax asignados"), S("start_time", "Inicio"), S("end_time", "Fin"),
      N("cost", "Costo"), OPT("currency", "Moneda", CURRENCIES),
      OPT("status", "Estado", ["planned", "confirmed", "conflict", "cancelled"]),
      TXT("notes", "Notas"),
    ],
  },

  // ======================= parque / accesos ================================
  {
    type: "attraction", label: "Atracciones", icon: "fa-solid fa-ferris-wheel", visible: true,
    description: "Atracciones, shows y experiencias del parque con aforo y estado operativo en tiempo real",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      REF("zone", "Zona", "zone"),
      OPT("attraction_type", "Tipo", ["ride", "water", "show", "animal", "adventure", "exhibit", "play_area", "service"]),
      OPT("operational_status", "Estado operativo", ["open", "delayed", "paused", "closed", "maintenance", "weather_hold"]),
      N("capacity_hour", "Aforo por hora"), N("capacity_simultaneous", "Aforo simultaneo"),
      N("queue_minutes", "Cola (min)"), N("guests_today", "Visitantes hoy"),
      N("duration_min", "Duracion (min)"),
      N("min_height_cm", "Altura minima (cm)"), N("max_height_cm", "Altura maxima (cm)"),
      N("min_age", "Edad minima"), N("max_weight_kg", "Peso maximo (kg)"),
      TXT("health_restrictions", "Restricciones de salud"),
      YN("requires_waiver", "Requiere waiver"), YN("weather_sensitive", "Sensible al clima"),
      N("downtime_minutes_today", "Downtime hoy (min)"), D("last_status_at", "Ultimo cambio de estado"),
      LINK("cover_image_url", "Imagen de portada"), S("location", "Ubicacion"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "attraction_log", label: "Bitacora de atracciones", icon: "fa-solid fa-clipboard-list", visible: false,
    description: "Registro inmutable de cambios de estado, aforo, incidentes y conteos de cada atraccion",
    props: [
      TENANT(), REF("attraction", "Atraccion", "attraction"), REF("user", "Usuario", "user"), REF("staff", "Personal", "staff"),
      OPT("event_type", "Evento", ["status_change", "capacity_change", "incident", "weather", "cleaning", "headcount", "note"]),
      OPT("from_status", "Estado anterior", ["open", "delayed", "paused", "closed", "maintenance", "weather_hold"]),
      OPT("to_status", "Estado nuevo", ["open", "delayed", "paused", "closed", "maintenance", "weather_hold"]),
      N("duration_min", "Duracion (min)"), N("guests", "Visitantes"),
      S("reason", "Motivo"), D("logged_at", "Fecha"),
    ],
  },
  {
    type: "access_ticket", label: "Tickets de acceso", icon: "fa-solid fa-ticket-simple", visible: true,
    description: "Pases del dia, pulseras y entradas con control de usos y redencion por QR",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("ticket_type", "Tipo", ["day_pass", "single_use", "multi_day", "season_pass", "annual", "wristband", "locker", "parking"]),
      OPT("status", "Estado", ["issued", "active", "redeemed", "partially_used", "expired", "void", "transferred"]),
      D("valid_from", "Valido desde"), D("valid_to", "Valido hasta"),
      N("entries_allowed", "Entradas permitidas"), N("entries_used", "Entradas usadas"),
      D("issued_at", "Emitido"), D("redeemed_at", "Redimido"),
      TXT("qr_payload", "Payload QR"), S("wristband_code", "Codigo de pulsera"), S("holder_name", "Titular"),
      N("price", "Precio"), OPT("currency", "Moneda", CURRENCIES), TXT("notes", "Notas"),
      REF("booking", "Reserva", "booking"), REF("participant", "Pasajero", "participant"),
      REF("customer", "Cliente", "customer"), REF("product", "Producto", "product"),
      REF("order", "Orden", "order"), REF("membership", "Membresia", "membership"),
    ],
  },

  // ======================= seguridad =======================================
  {
    type: "waiver_template", label: "Plantillas de waiver", icon: "fa-solid fa-file-signature", visible: true,
    description: "Plantillas de exoneracion de responsabilidad versionadas por jurisdiccion e idioma",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("version", "Version"), S("jurisdiction", "Jurisdiccion"),
      OPT("language", "Idioma", LANGS), TXT("body", "Texto legal"),
      YN("requires_guardian", "Requiere tutor"), N("min_age_self_sign", "Edad minima para firmar"),
      D("valid_from", "Valido desde", false), D("valid_to", "Valido hasta", false),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "waiver", label: "Waivers firmados", icon: "fa-solid fa-file-shield", visible: true,
    description: "Exoneraciones firmadas por participantes con copia congelada del texto aceptado",
    props: [
      TENANT(), S("signature_name", "Nombre de firma", { showInTree: true }),
      REF("waiver_template", "Plantilla", "waiver_template"), REF("participant", "Pasajero", "participant"),
      REF("customer", "Cliente", "customer"), REF("booking", "Reserva", "booking"), REF("product", "Producto", "product"),
      D("signed_at", "Firmado"), D("valid_until", "Vigente hasta", false),
      TXT("signature_data", "Datos de firma"), S("document_id", "Documento de identidad"),
      OPT("document_type", "Tipo de documento", ["passport", "id_card", "driver_license", "minor_id"]),
      S("template_version", "Version de plantilla"), TXT("body_snapshot", "Texto aceptado"),
      S("guardian_name", "Tutor"), S("guardian_document", "Documento del tutor"),
      OPT("status", "Estado", ["signed", "pending", "expired", "revoked"]),
      S("ip_address", "IP"), OPT("channel", "Canal", ["kiosk", "online", "counter", "mobile"]),
      TXT("health_flags", "Declaraciones de salud"),
    ],
  },
  {
    type: "incident", label: "Incidentes", icon: "fa-solid fa-triangle-exclamation", visible: true,
    description: "Incidentes de seguridad, salud y operacion con investigacion y costos asociados",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      D("occurred_at", "Ocurrido"), D("reported_at", "Reportado"), D("closed_at", "Cerrado"),
      OPT("severity", "Severidad", ["minor", "moderate", "major", "critical", "fatality"]),
      OPT("incident_type", "Tipo", ["injury", "illness", "near_miss", "property_damage", "lost_child", "security", "environmental", "ride_stoppage", "food_safety", "other"]),
      OPT("status", "Estado", ["open", "investigating", "action_required", "resolved", "closed", "escalated"]),
      S("title", "Titulo"), TXT("description", "Descripcion"), S("location", "Ubicacion"),
      TXT("immediate_action", "Accion inmediata"), TXT("root_cause", "Causa raiz"), TXT("witnesses", "Testigos"),
      YN("medical_attention", "Atencion medica"), YN("evacuation", "Evacuacion"),
      YN("authority_notified", "Autoridad notificada"), YN("insurance_claim", "Reclamo a seguro"),
      N("estimated_cost", "Costo estimado"), OPT("currency", "Moneda", CURRENCIES), FILE("photos", "Fotos", true),
      REF("attraction", "Atraccion", "attraction"), REF("asset", "Activo", "asset"), REF("zone", "Zona", "zone"),
      REF("participant", "Pasajero", "participant"), REF("booking", "Reserva", "booking"), REF("customer", "Cliente", "customer"),
      REF("vehicle", "Vehiculo", "vehicle"), REF("departure", "Salida", "departure"),
      REF("reported_by", "Reportado por", "user"), REF("assigned_to", "Asignado a", "user"),
    ],
  },
  {
    type: "incident_action", label: "Acciones correctivas", icon: "fa-solid fa-list-check", visible: false,
    description: "Acciones correctivas y de seguimiento derivadas de un incidente",
    props: [
      TENANT(), S("action", "Accion", { showInTree: true }), TXT("description", "Descripcion"),
      D("due_date", "Vence", false), D("completed_at", "Completada"),
      OPT("status", "Estado", ["pending", "in_progress", "done", "cancelled", "verified"]),
      OPT("priority", "Prioridad", ["low", "medium", "high", "urgent"]),
      TXT("verification_notes", "Notas de verificacion"),
      REF("incident", "Incidente", "incident"), REF("assigned_to", "Asignado a", "user"), REF("verified_by", "Verificado por", "user"),
    ],
  },
  {
    type: "inspection_template", label: "Plantillas de inspeccion", icon: "fa-solid fa-clipboard-check", visible: true,
    description: "Checklists de inspeccion por frecuencia y categoria con umbral de aprobacion",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("frequency", "Frecuencia", ["pre_opening", "daily", "weekly", "monthly", "quarterly", "annual", "on_demand"]),
      OPT("category", "Categoria", ["safety", "mechanical", "electrical", "hygiene", "water_quality", "food_safety", "vehicle", "fire", "general"]),
      TXT("checklist", "Items"), N("pass_threshold", "Umbral de aprobacion"),
      YN("requires_signature", "Requiere firma"), YN("blocks_operation_on_fail", "Bloquea operacion si falla"),
      N("estimated_min", "Duracion estimada (min)"), OPT("status", "Estado", ["active", "inactive"]),
      REF("asset", "Activo", "asset"), REF("attraction", "Atraccion", "attraction"),
    ],
  },
  {
    type: "inspection", label: "Inspecciones", icon: "fa-solid fa-magnifying-glass-chart", visible: true,
    description: "Inspecciones realizadas con resultado, hallazgos y firma responsable",
    props: [
      TENANT(), S("signature_name", "Inspector", { showInTree: true }),
      D("performed_at", "Realizada"),
      OPT("result", "Resultado", ["pass", "pass_with_observations", "fail", "not_applicable"]),
      N("score", "Puntaje"), N("items_total", "Items totales"), N("items_failed", "Items fallidos"),
      TXT("findings", "Hallazgos"), YN("blocked_operation", "Bloqueo la operacion"),
      FILE("photos", "Fotos", true), D("next_due_at", "Proxima"),
      REF("inspection_template", "Plantilla", "inspection_template"), REF("asset", "Activo", "asset"),
      REF("attraction", "Atraccion", "attraction"), REF("vehicle", "Vehiculo", "vehicle"),
      REF("performed_by", "Realizada por", "user"), REF("work_order", "Orden de trabajo", "work_order"),
    ],
  },

  // ======================= mantenimiento ===================================
  {
    type: "asset", label: "Activos", icon: "fa-solid fa-gears", visible: true,
    description: "Activos fisicos (atracciones, vehiculos, equipos, instalaciones) con medidores y criticidad",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("asset_type", "Tipo", ["ride", "vehicle", "boat", "buggy", "equipment", "facility", "it", "pool"]),
      OPT("operational_status", "Estado operativo", ["in_service", "maintenance", "out_of_service", "retired"]),
      YN("blocks_capacity", "Bloquea capacidad"),
      OPT("criticality", "Criticidad", ["critical", "high", "medium", "low"]),
      S("serial_number", "Numero de serie"), S("location", "Ubicacion"), N("capacity", "Capacidad"),
      D("purchase_date", "Fecha de compra", false), N("purchase_cost", "Costo de compra"), OPT("currency", "Moneda", CURRENCIES),
      D("warranty_until", "Garantia hasta", false),
      N("meter_hours", "Horometro"), N("meter_km", "Kilometraje"),
      D("next_maintenance_at", "Proximo mantenimiento"), N("downtime_minutes_month", "Downtime mes (min)"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
      REF("zone", "Zona", "zone"), REF("vehicle", "Vehiculo", "vehicle"), REF("supplier", "Proveedor", "supplier"),
      REF("branch", "Sucursal", "branch"), REF("attraction", "Atraccion", "attraction"),
    ],
  },
  {
    type: "work_order", label: "Ordenes de trabajo", icon: "fa-solid fa-screwdriver-wrench", visible: true,
    description: "Ordenes de trabajo correctivas, preventivas y de mejora con costos y downtime",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }), S("title", "Titulo"),
      OPT("order_type", "Tipo", ["corrective", "preventive", "predictive", "improvement", "inspection_followup", "emergency"]),
      OPT("priority", "Prioridad", ["low", "medium", "high", "urgent"]),
      OPT("status", "Estado", ["draft", "open", "assigned", "in_progress", "waiting_parts", "waiting_approval", "done", "verified", "cancelled"]),
      D("opened_at", "Abierta"), D("scheduled_at", "Programada"), D("started_at", "Iniciada"), D("finished_at", "Finalizada"),
      TXT("description", "Descripcion"), TXT("work_performed", "Trabajo realizado"),
      N("downtime_min", "Downtime (min)"), N("labor_hours", "Horas de mano de obra"),
      N("labor_cost", "Costo mano de obra"), N("parts_cost", "Costo de repuestos"), N("total_cost", "Costo total"),
      OPT("currency", "Moneda", CURRENCIES), YN("takes_asset_down", "Baja el activo"), N("meter_reading", "Lectura de medidor"),
      REF("asset", "Activo", "asset"), REF("attraction", "Atraccion", "attraction"), REF("vehicle", "Vehiculo", "vehicle"),
      REF("assigned_to", "Asignada a", "user"), REF("supplier", "Proveedor", "supplier"),
      REF("incident", "Incidente", "incident"), REF("maintenance_plan", "Plan de mantenimiento", "maintenance_plan"),
      REF("requested_by", "Solicitada por", "user"),
    ],
  },
  {
    type: "maintenance_plan", label: "Planes de mantenimiento", icon: "fa-solid fa-calendar-check", visible: true,
    description: "Planes de mantenimiento preventivo por calendario, horometro o kilometraje",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }),
      OPT("trigger_type", "Disparador", ["calendar", "meter_hours", "meter_km", "usage_count", "condition"]),
      N("interval_days", "Intervalo (dias)"), N("interval_hours", "Intervalo (horas)"), N("interval_km", "Intervalo (km)"),
      N("lead_time_days", "Anticipacion (dias)"), TXT("task_list", "Tareas"),
      N("estimated_min", "Duracion estimada (min)"), N("estimated_cost", "Costo estimado"),
      D("last_executed_at", "Ultima ejecucion"), D("next_due_at", "Proxima"),
      YN("takes_asset_down", "Baja el activo"), OPT("status", "Estado", ["active", "inactive"]),
      REF("asset", "Activo", "asset"), REF("attraction", "Atraccion", "attraction"), REF("vehicle", "Vehiculo", "vehicle"),
      REF("inspection_template", "Plantilla de inspeccion", "inspection_template"), REF("staff", "Responsable", "staff"),
    ],
  },

  // ======================= comercio / inventario ===========================
  {
    type: "warehouse", label: "Almacenes", icon: "fa-solid fa-warehouse", visible: true,
    description: "Almacenes, cocinas, bares y tiendas donde se controla inventario",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("warehouse_type", "Tipo", ["main", "kitchen", "bar", "shop", "maintenance", "uniforms", "transit"]),
      S("location", "Ubicacion"), YN("allows_negative", "Permite stock negativo"),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
      REF("branch", "Sucursal", "branch"), REF("zone", "Zona", "zone"),
    ],
  },
  {
    type: "inventory_item", label: "Articulos de inventario", icon: "fa-solid fa-box", visible: true,
    description: "Catalogo de articulos: alimentos, bebidas, retail, repuestos y consumibles",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("sku", "SKU"), S("barcode", "Codigo de barras"),
      OPT("item_type", "Tipo", ["food", "beverage", "retail", "souvenir", "uniform", "spare_part", "consumable", "fuel", "chemical", "packaging"]),
      OPT("unit", "Unidad", ["unit", "kg", "g", "l", "ml", "box", "pack", "bottle", "case"]),
      N("cost", "Costo"), N("price", "Precio"), OPT("currency", "Moneda", CURRENCIES), N("tax_rate", "Impuesto %"),
      N("min_stock", "Stock minimo"), N("max_stock", "Stock maximo"),
      N("reorder_point", "Punto de reorden"), N("reorder_qty", "Cantidad de reorden"), N("shelf_life_days", "Vida util (dias)"),
      YN("is_sellable", "Se vende al publico"), YN("tracks_lots", "Controla lotes"), LINK("image_url", "Imagen"),
      OPT("status", "Estado", ["active", "inactive"]),
      REF("product_category", "Categoria", "product_category"), REF("supplier", "Proveedor", "supplier"), REF("product", "Producto", "product"),
    ],
  },
  {
    type: "stock_level", label: "Existencias", icon: "fa-solid fa-layer-group", visible: false,
    description: "Nivel de existencias por almacen y articulo (cache derivado de los movimientos)",
    props: [
      TENANT(), REF("warehouse", "Almacen", "warehouse"), REF("inventory_item", "Articulo", "inventory_item"),
      N("quantity", "Cantidad"), N("reserved", "Reservado"), N("available", "Disponible"), N("avg_cost", "Costo promedio"),
      D("last_movement_at", "Ultimo movimiento"), D("last_counted_at", "Ultimo conteo"),
    ],
  },
  {
    type: "stock_movement", label: "Movimientos de stock", icon: "fa-solid fa-arrows-turn-to-dots", visible: false,
    description: "Entradas, salidas, consumos, mermas y transferencias de inventario",
    props: [
      TENANT(), S("reference", "Referencia", { showInTree: true }),
      OPT("movement_type", "Tipo", ["receipt", "sale", "consumption", "transfer_out", "transfer_in", "waste", "adjustment", "return", "count"]),
      N("quantity", "Cantidad"), N("unit_cost", "Costo unitario"), N("total_cost", "Costo total"),
      OPT("currency", "Moneda", CURRENCIES), D("moved_at", "Fecha"), N("balance_after", "Saldo posterior"),
      S("reason", "Motivo"), S("lot_code", "Lote"), D("expires_at", "Vence"),
      REF("warehouse", "Almacen", "warehouse"), REF("to_warehouse", "Almacen destino", "warehouse"),
      REF("inventory_item", "Articulo", "inventory_item"), REF("user", "Usuario", "user"),
      REF("purchase_order", "Orden de compra", "purchase_order"), REF("order", "Orden", "order"), REF("work_order", "Orden de trabajo", "work_order"),
    ],
  },
  {
    type: "purchase_order", label: "Ordenes de compra", icon: "fa-solid fa-cart-flatbed", visible: true,
    description: "Ordenes de compra a proveedores con recepcion y facturacion",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("status", "Estado", ["draft", "pending_approval", "approved", "sent", "partially_received", "received", "invoiced", "cancelled", "rejected"]),
      D("ordered_at", "Ordenada"), D("expected_at", "Esperada"), D("received_at", "Recibida"),
      N("subtotal", "Subtotal"), N("tax", "Impuesto"), N("total", "Total"),
      OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa"),
      S("payment_terms", "Condiciones de pago"), TXT("notes", "Notas"), TXT("approval_notes", "Notas de aprobacion"),
      REF("supplier", "Proveedor", "supplier"), REF("warehouse", "Almacen", "warehouse"),
      REF("requested_by", "Solicitada por", "user"), REF("approved_by", "Aprobada por", "user"), REF("payable", "Cuenta por pagar", "payable"),
    ],
  },
  {
    type: "purchase_order_line", label: "Lineas de compra", icon: "fa-solid fa-list", visible: false,
    description: "Lineas de detalle de una orden de compra",
    props: [
      TENANT(), S("description", "Descripcion", { showInTree: true }),
      N("quantity", "Cantidad"), N("quantity_received", "Cantidad recibida"),
      N("unit_cost", "Costo unitario"), N("tax_rate", "Impuesto %"), N("line_total", "Total linea"),
      REF("purchase_order", "Orden de compra", "purchase_order"), REF("inventory_item", "Articulo", "inventory_item"),
    ],
  },

  // ======================= clientes / experiencia ==========================
  {
    type: "membership_plan", label: "Planes de membresia", icon: "fa-solid fa-id-card", visible: true,
    description: "Planes de membresia y pases de temporada con beneficios y visitas incluidas",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }), S("code", "Codigo"),
      OPT("plan_type", "Tipo", ["annual_pass", "season_pass", "monthly", "corporate", "family", "vip"]),
      N("price", "Precio"), OPT("currency", "Moneda", CURRENCIES), N("duration_days", "Duracion (dias)"),
      N("visits_included", "Visitas incluidas"), N("guest_passes", "Pases de invitado"), N("discount_percent", "Descuento %"),
      TXT("benefits", "Beneficios"), JSN("blackout_dates", "Fechas bloqueadas"),
      YN("auto_renew", "Renovacion automatica"), LINK("image_url", "Imagen"),
      OPT("status", "Estado", ["active", "inactive"]),
    ],
  },
  {
    type: "membership", label: "Membresias", icon: "fa-solid fa-address-card", visible: true,
    description: "Membresias emitidas a clientes con control de visitas y renovacion",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("status", "Estado", ["active", "pending", "suspended", "expired", "cancelled"]),
      D("starts_at", "Inicio"), D("ends_at", "Fin"),
      N("visits_used", "Visitas usadas"), N("guest_passes_used", "Pases usados"), N("amount_paid", "Importe pagado"),
      OPT("currency", "Moneda", CURRENCIES), YN("auto_renew", "Renovacion automatica"), FILE("photo", "Foto"),
      D("last_visit_at", "Ultima visita"), D("cancelled_at", "Cancelada"), S("cancel_reason", "Motivo de cancelacion"),
      REF("membership_plan", "Plan", "membership_plan"), REF("customer", "Cliente", "customer"), REF("order", "Orden", "order"),
    ],
  },
  {
    type: "gift_card", label: "Gift cards", icon: "fa-solid fa-gift", visible: true,
    description: "Tarjetas de regalo con saldo, vigencia y canal de entrega",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("status", "Estado", ["active", "redeemed", "partially_used", "expired", "void"]),
      N("initial_amount", "Importe inicial"), N("balance", "Saldo"), OPT("currency", "Moneda", CURRENCIES),
      D("issued_at", "Emitida"), D("expires_at", "Expira"),
      S("recipient_name", "Destinatario"), S("recipient_email", "Email destinatario"), TXT("message", "Mensaje"),
      OPT("delivery_channel", "Canal de entrega", ["email", "print", "physical", "whatsapp"]),
      REF("customer", "Cliente", "customer"), REF("order", "Orden", "order"), REF("product", "Producto", "product"),
    ],
  },
  {
    type: "gift_card_movement", label: "Movimientos de gift card", icon: "fa-solid fa-money-bill-wave", visible: false,
    description: "Emisiones, redenciones y ajustes de saldo de las gift cards",
    props: [
      TENANT(), OPT("movement_type", "Tipo", ["issue", "redeem", "refund", "adjustment", "expire"]),
      N("amount", "Importe"), N("balance_after", "Saldo posterior"), D("moved_at", "Fecha"), TXT("notes", "Notas"),
      REF("gift_card", "Gift card", "gift_card"), REF("order", "Orden", "order"), REF("user", "Usuario", "user"),
    ],
  },
  {
    type: "guest_case", label: "Casos de clientes", icon: "fa-solid fa-headset", visible: true,
    description: "Quejas, reclamos, objetos perdidos y solicitudes de clientes con compensacion",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("case_type", "Tipo", ["complaint", "claim", "compliment", "lost_item", "found_item", "refund_request", "accessibility", "special_request"]),
      OPT("status", "Estado", ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"]),
      OPT("priority", "Prioridad", ["low", "medium", "high", "urgent"]),
      OPT("channel", "Canal", ["counter", "phone", "email", "whatsapp", "web", "social", "review_site"]),
      D("opened_at", "Abierto"), S("subject", "Asunto"), TXT("description", "Descripcion"), TXT("resolution", "Resolucion"),
      D("resolved_at", "Resuelto"), N("satisfaction_score", "Satisfaccion"),
      N("compensation_amount", "Compensacion"), OPT("currency", "Moneda", CURRENCIES),
      OPT("compensation_type", "Tipo de compensacion", ["none", "refund", "voucher", "free_visit", "upgrade", "gift"]),
      REF("customer", "Cliente", "customer"), REF("booking", "Reserva", "booking"), REF("participant", "Pasajero", "participant"),
      REF("assigned_to", "Asignado a", "user"), REF("order", "Orden", "order"), REF("incident", "Incidente", "incident"),
    ],
  },

  // ======================= ventas / distribucion ===========================
  {
    type: "quote", label: "Cotizaciones", icon: "fa-solid fa-file-invoice", visible: true,
    description: "Cotizaciones de grupos, bodas, corporativo y escolar con margen y vigencia",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("status", "Estado", ["draft", "sent", "negotiating", "accepted", "rejected", "expired", "converted"]),
      OPT("quote_type", "Tipo", ["group", "corporate", "wedding", "school", "incentive", "cruise", "custom"]),
      D("issued_at", "Emitida"), D("valid_until", "Valida hasta"), D("event_date", "Fecha del evento", false),
      N("pax", "Pasajeros"), N("subtotal", "Subtotal"), N("discount", "Descuento"), N("tax", "Impuesto"), N("total", "Total"),
      OPT("currency", "Moneda", CURRENCIES), N("margin_percent", "Margen %"),
      TXT("terms", "Terminos"), TXT("notes", "Notas"), S("rejection_reason", "Motivo de rechazo"),
      D("sent_at", "Enviada"), D("decided_at", "Decidida"),
      REF("customer", "Cliente", "customer"), REF("partner", "Partner", "partner"), REF("seller", "Vendedor", "seller"),
      REF("lead", "Lead", "lead"), REF("order", "Orden", "order"), REF("user", "Usuario", "user"),
    ],
  },
  {
    type: "quote_line", label: "Lineas de cotizacion", icon: "fa-solid fa-list", visible: false,
    description: "Lineas de detalle de una cotizacion",
    props: [
      TENANT(), S("description", "Descripcion", { showInTree: true }),
      N("quantity", "Cantidad"), N("unit_price", "Precio unitario"), N("unit_cost", "Costo unitario"),
      N("discount_percent", "Descuento %"), N("line_total", "Total linea"), D("service_date", "Fecha de servicio", false),
      REF("quote", "Cotizacion", "quote"), REF("product", "Producto", "product"),
      REF("product_modality", "Modalidad", "product_modality"), REF("departure", "Salida", "departure"),
    ],
  },
  {
    type: "allotment", label: "Cupos (allotments)", icon: "fa-solid fa-table-cells", visible: true,
    description: "Cupos asignados a partners por producto y salida con liberacion automatica",
    props: [
      TENANT(),
      OPT("allotment_type", "Tipo", ["free_sale", "guaranteed", "on_request", "closed"]),
      N("seats", "Cupos"), N("seats_used", "Cupos usados"), N("seats_released", "Cupos liberados"), N("release_days", "Dias de liberacion"),
      D("valid_from", "Valido desde", false), D("valid_to", "Valido hasta", false),
      OPT("weekdays", "Dias de semana", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], true),
      OPT("status", "Estado", ["active", "inactive"]), TXT("notes", "Notas"),
      REF("partner", "Partner", "partner"), REF("product", "Producto", "product"),
      REF("departure", "Salida", "departure"), REF("product_modality", "Modalidad", "product_modality"),
    ],
  },

  // ======================= finanzas / fiscal ===============================
  {
    type: "invoice", label: "Facturas", icon: "fa-solid fa-file-invoice-dollar", visible: true,
    description: "Facturas fiscales con NCF, comprobante electronico y control de cobro",
    props: [
      TENANT(), S("number", "Numero", { showInTree: true }), S("series", "Serie"), S("ncf", "NCF"),
      OPT("ncf_type", "Tipo de NCF", ["b01", "b02", "b04", "b14", "b15", "e31", "e32", "e34", "e44", "e45"]),
      OPT("invoice_type", "Tipo", ["sale", "credit_note", "debit_note", "proforma"]),
      OPT("status", "Estado", ["draft", "issued", "sent", "paid", "partially_paid", "overdue", "cancelled", "voided"]),
      D("issued_at", "Emitida"), D("due_date", "Vencimiento", false),
      N("subtotal", "Subtotal"), N("tax", "Impuesto"), N("tax_rate", "Tasa %"), N("discount", "Descuento"),
      N("total", "Total"), N("paid_amount", "Pagado"), OPT("currency", "Moneda", CURRENCIES), N("exchange_rate", "Tasa"),
      S("customer_name", "Cliente"), S("customer_tax_id", "RNC cliente"), S("customer_address", "Direccion cliente"),
      TXT("notes", "Notas"), LINK("pdf_url", "PDF"),
      OPT("efac_status", "Estado e-CF", ["pending", "sent", "accepted", "rejected", "not_applicable"]),
      S("efac_track_id", "Track ID e-CF"), D("voided_at", "Anulada"), S("void_reason", "Motivo de anulacion"),
      REF("customer", "Cliente", "customer"), REF("order", "Orden", "order"), REF("partner", "Partner", "partner"),
      REF("settlement", "Liquidacion", "settlement"), REF("tax_profile", "Perfil fiscal", "tax_profile"), REF("user", "Usuario", "user"),
    ],
  },
  {
    type: "tax_profile", label: "Perfiles fiscales", icon: "fa-solid fa-landmark", visible: true,
    description: "Configuracion de impuestos, secuencias de comprobante y facturacion electronica por pais",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }),
      OPT("country", "Pais", ["do", "mx", "co", "cr", "pa", "us", "es", "other"]),
      S("tax_name", "Nombre del impuesto"), N("tax_rate", "Tasa %"),
      YN("included_in_price", "Incluido en el precio"),
      N("tourism_tax_rate", "Impuesto turistico %"), N("service_charge_rate", "Cargo por servicio %"),
      S("tax_id_label", "Etiqueta de identificacion"), S("ncf_series", "Serie NCF"), N("ncf_next", "Proximo NCF"),
      D("ncf_expires", "Vence NCF", false), YN("efac_enabled", "e-CF habilitado"),
      S("rounding", "Redondeo"), OPT("status", "Estado", ["active", "inactive"]),
    ],
  },

  // ======================= equipo ==========================================
  {
    type: "shift", label: "Turnos", icon: "fa-solid fa-business-time", visible: true,
    description: "Turnos planificados de personal por zona, atraccion y salida",
    props: [
      TENANT(), S("role_label", "Rol", { showInTree: true }),
      D("shift_date", "Fecha", false), D("starts_at", "Inicio"), D("ends_at", "Fin"),
      OPT("status", "Estado", ["planned", "published", "confirmed", "in_progress", "completed", "no_show", "cancelled"]),
      N("break_min", "Descanso (min)"), N("hours_planned", "Horas planificadas"), N("hourly_rate", "Tarifa/hora"),
      OPT("currency", "Moneda", CURRENCIES), TXT("notes", "Notas"),
      REF("staff", "Personal", "staff"), REF("zone", "Zona", "zone"), REF("attraction", "Atraccion", "attraction"),
      REF("branch", "Sucursal", "branch"), REF("departure", "Salida", "departure"), REF("user", "Usuario", "user"),
    ],
  },
  {
    type: "certification", label: "Certificaciones", icon: "fa-solid fa-certificate", visible: true,
    description: "Certificaciones y licencias del personal con vencimiento y bloqueo de asignacion",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }),
      OPT("cert_type", "Tipo", ["first_aid", "lifeguard", "driving_license", "ride_operator", "food_handling", "guide_license", "language", "forklift", "height_work", "other"]),
      S("issuer", "Emisor"), S("number", "Numero"),
      D("issued_at", "Emitida", false), D("expires_at", "Vence", false),
      OPT("status", "Estado", ["valid", "expiring", "expired", "revoked", "pending"]),
      YN("blocks_assignment", "Bloquea asignacion"), FILE("document", "Documento"), TXT("notes", "Notas"),
      REF("staff", "Personal", "staff"),
    ],
  },

  {
    type: "attendance", label: "Asistencia", icon: "fa-solid fa-user-clock", visible: true,
    description: "Marcaje de entrada/salida del personal con horas trabajadas y estado",
    props: [
      TENANT(), D("attendance_date", "Fecha", false), D("clock_in", "Entrada"), D("clock_out", "Salida"),
      N("hours_worked", "Horas trabajadas"), N("overtime_hours", "Horas extra"),
      OPT("status", "Estado", ["present", "late", "absent", "excused", "holiday", "vacation", "sick"]),
      OPT("method", "Metodo", ["kiosk", "qr", "manual", "biometric", "mobile"]),
      TXT("notes", "Notas"),
      REF("staff", "Personal", "staff"), REF("shift", "Turno", "shift"), REF("approved_by", "Aprobado por", "user"),
    ],
  },

  // ======================= administracion / plataforma =====================
  {
    type: "task", label: "Tareas", icon: "fa-solid fa-list-check", visible: true,
    description: "Tareas operativas asignables ligadas a reservas, incidentes, ordenes y casos",
    props: [
      TENANT(), S("title", "Titulo", { showInTree: true }), TXT("description", "Descripcion"),
      OPT("status", "Estado", ["todo", "in_progress", "blocked", "waiting", "done", "cancelled"]),
      OPT("priority", "Prioridad", ["low", "medium", "high", "urgent"]),
      D("due_at", "Vence"), D("completed_at", "Completada"),
      OPT("task_type", "Tipo", ["general", "follow_up", "operational", "maintenance", "safety", "finance", "sales", "onboarding"]),
      OPT("source", "Origen", ["manual", "automatic", "escalation", "checklist"]),
      TXT("checklist", "Checklist"),
      REF("assigned_to", "Asignada a", "user"), REF("created_by", "Creada por", "user"),
      REF("booking", "Reserva", "booking"), REF("order", "Orden", "order"), REF("incident", "Incidente", "incident"),
      REF("work_order", "Orden de trabajo", "work_order"), REF("guest_case", "Caso", "guest_case"),
      REF("customer", "Cliente", "customer"), REF("lead", "Lead", "lead"),
    ],
  },
  {
    type: "document", label: "Documentos", icon: "fa-solid fa-folder-open", visible: true,
    description: "Procedimientos, politicas, manuales y permisos con control de acuse de recibo",
    props: [
      TENANT(), S("title", "Titulo", { showInTree: true }),
      OPT("doc_type", "Tipo", ["sop", "policy", "manual", "contract", "permit", "insurance", "certificate", "emergency_plan", "menu", "price_list", "other"]),
      S("version", "Version"), TXT("body", "Contenido"), FILE("file", "Archivo"), LINK("url", "Enlace"),
      D("effective_from", "Vigente desde", false), D("expires_at", "Expira", false),
      YN("requires_ack", "Requiere acuse"),
      OPT("audience", "Audiencia", ["all", "managers", "operations", "guides", "drivers", "cashiers", "maintenance", "safety"]),
      OPT("status", "Estado", ["draft", "published", "archived"]),
      REF("owner", "Responsable", "user"),
    ],
  },
  {
    type: "document_ack", label: "Acuses de documento", icon: "fa-solid fa-file-circle-check", visible: false,
    description: "Registro de aceptacion de documentos por parte del personal",
    props: [
      TENANT(), REF("document", "Documento", "document"), REF("user", "Usuario", "user"),
      S("version_acked", "Version aceptada"), D("acknowledged_at", "Aceptado"), N("quiz_score", "Puntaje"),
    ],
  },
  {
    type: "approval_request", label: "Solicitudes de aprobacion", icon: "fa-solid fa-user-check", visible: true,
    description: "Flujo de aprobacion para descuentos, reembolsos, anulaciones y overrides sensibles",
    props: [
      TENANT(), S("code", "Codigo", { showInTree: true }),
      OPT("action_type", "Accion", ["discount_over_limit", "refund", "void_sale", "cash_adjustment", "price_change", "commission_override", "clawback", "purchase_order", "credit_note", "capacity_override", "waiver_bypass", "payout", "expense", "schedule_change"]),
      OPT("status", "Estado", ["pending", "approved", "rejected", "cancelled", "expired"]),
      D("requested_at", "Solicitada"), D("decided_at", "Decidida"), D("expires_at", "Expira"),
      N("amount", "Importe"), OPT("currency", "Moneda", CURRENCIES),
      TXT("reason", "Motivo"), TXT("decision_notes", "Notas de decision"), JSN("payload", "Payload"),
      S("target_table", "Tabla objetivo"), S("target_id", "ID objetivo"), YN("requires_two", "Requiere dos aprobadores"),
      REF("requested_by", "Solicitada por", "user"), REF("approved_by", "Aprobada por", "user"), REF("second_approver", "Segundo aprobador", "user"),
      REF("order", "Orden", "order"), REF("booking", "Reserva", "booking"), REF("payment", "Pago", "payment"), REF("purchase_order", "Orden de compra", "purchase_order"),
    ],
  },
  {
    type: "integration", label: "Integraciones", icon: "fa-solid fa-plug", visible: true,
    description: "Conexiones con OTAs, pasarelas, mensajeria, contabilidad y fisco",
    props: [
      TENANT(), S("name", "Nombre", { showInTree: true }),
      OPT("provider", "Proveedor", ["octo", "viator", "getyourguide", "expedia", "civitatis", "tripadvisor", "stripe", "whatsapp", "mailchimp", "quickbooks", "dgii", "google_calendar", "zapier", "webhook", "custom"]),
      OPT("category", "Categoria", ["distribution", "payments", "messaging", "accounting", "tax", "marketing", "other"]),
      OPT("status", "Estado", ["connected", "disconnected", "error", "pending", "sandbox"]),
      S("direction", "Direccion"), LINK("endpoint_url", "Endpoint"), S("external_id", "ID externo"),
      D("last_sync_at", "Ultima sincronizacion"), TXT("last_error", "Ultimo error"),
      OPT("sync_frequency", "Frecuencia", ["realtime", "every_5_min", "hourly", "daily", "manual"]),
      N("records_synced", "Registros sincronizados"), JSN("config", "Configuracion"),
      YN("webhook_secret_set", "Secreto de webhook configurado"),
      REF("partner", "Partner", "partner"), REF("user", "Usuario", "user"),
    ],
  },

  // ======================= platform ========================================
  {
    type: "audit_log", label: "Auditoria", icon: "fa-solid fa-shield-halved", visible: true,
    description: "Registro inmutable de acciones sensibles, overrides e impersonaciones",
    props: [
      TENANT(), REF("user", "Usuario", "user"), REF("impersonated_by", "Impersonado por", "user"),
      S("action", "Accion", { showInTree: true }), S("entity_type", "Entidad"), S("entity_id", "ID entidad"),
      TXT("description", "Descripcion"), S("ip_address", "IP"), S("user_agent", "User agent"),
      JSN("metadata_json", "Metadatos"),
      OPT("severity", "Severidad", ["info", "warning", "critical"]),
      D("occurred_at", "Fecha"),
    ],
  },
  {
    type: "stripe_event", label: "Eventos Stripe", icon: "fa-solid fa-money-check-dollar", visible: false,
    description: "Registro de eventos de webhook de Stripe procesados (idempotencia AUD-F22)",
    props: [
      S("event_id", "Event ID", { showInTree: true }), S("event_type", "Tipo"),
      REF("company", "Empresa", "company"), D("processed_at", "Procesado"),
      OPT("status", "Estado", ["processed", "skipped", "error"]), TXT("notes", "Notas"),
    ],
  },
  {
    type: "notification", label: "Notificaciones", icon: "fa-solid fa-bell", visible: false,
    description: "Notificaciones internas para usuarios y partners",
    props: [
      TENANT(), REF("user", "Usuario", "user"), REF("partner", "Partner", "partner"),
      S("title", "Titulo", { showInTree: true }), TXT("message", "Mensaje"),
      OPT("notification_type", "Tipo", ["info", "booking", "payment", "operation", "alert", "settlement"]),
      S("link", "Enlace"), YN("read_status", "Leida"), D("read_at", "Leida el"),
    ],
  },
];

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
async function main() {
  console.log("→ Reading existing structures…");
  const existing = await call(STRUCT);
  const idByType = new Map(existing.map((t) => [t.type, t._id]));
  const propsByType = new Map(existing.map((t) => [t.type, new Set(Object.keys(t.properties || {}))]));

  // pass 1 — tables
  for (const t of TABLES) {
    if (idByType.has(t.type)) {
      console.log(`  = table ${t.type}`);
      continue;
    }
    const res = await call(STRUCT, "POST", {
      type: t.type,
      label: t.label,
      description: t.description,
      icon: t.icon,
      mustTheTableBeVisibleOnBackOffice: t.visible,
    });
    idByType.set(t.type, res.insertedId);
    propsByType.set(t.type, new Set());
    console.log(`  + table ${t.type} (${res.insertedId})`);
  }

  // pass 2 — properties (refs resolvable now that every table exists)
  let added = 0;
  for (const t of TABLES) {
    const structureId = idByType.get(t.type);
    const have = propsByType.get(t.type) || new Set();
    for (const p of t.props) {
      if (have.has(p.name)) continue;
      const { __ref, __rel, ...prop } = p;
      if (__ref) {
        const targetId = idByType.get(__ref);
        if (!targetId) throw new Error(`Unknown ref target "${__ref}" for ${t.type}.${p.name}`);
        prop.objectReference = { objectReferenceTypeId: targetId, objectReferenceRelation: __rel };
      }
      // canRepeat MUST be true: Totalum enforces uniqueness when it is not set,
      // which would break every one-to-many relation and repeated value.
      await call(`${STRUCT}/${structureId}/property`, "POST", { canRepeat: true, ...prop });
      added++;
      console.log(`  + ${t.type}.${p.name}`);
    }
  }

  // pass 3 — self references (declared here to keep pass 2 declarative)
  const SELF_REFS = [
    { table: "partner", name: "parent_partner", label: "Partner padre", target: "partner" },
    { table: "seller", name: "supervisor", label: "Supervisor", target: "seller" },
    { table: "branch", name: "parent_branch", label: "Sucursal padre", target: "branch" },
    // AUD-D03: ledger_account.parent (chart hierarchy) — resources.ts expands it.
    { table: "ledger_account", name: "parent", label: "Cuenta padre", target: "ledger_account" },
  ];
  for (const r of SELF_REFS) {
    const have = propsByType.get(r.table) || new Set();
    if (have.has(r.name)) continue;
    await call(`${STRUCT}/${idByType.get(r.table)}/property`, "POST", {
      name: r.name, label: r.label, propertyType: "objectReference", canRepeat: true,
      objectReference: { objectReferenceTypeId: idByType.get(r.target), objectReferenceRelation: "manyToOne" },
    });
    added++;
    console.log(`  + ${r.table}.${r.name} (self)`);
  }

  // pass 3b — auth user table tenant scoping (user table is owned by Better Auth)
  const AUTH_USER_REFS = [
    { name: "company_id", label: "Empresa", target: "company" },
    { name: "partner_id", label: "Partner (portal B2B)", target: "partner" },
  ];
  const userStructureId = existing.find((t) => t.type === "user")?._id;
  const userProps = propsByType.get("user") || new Set();
  for (const r of AUTH_USER_REFS) {
    if (!userStructureId || userProps.has(r.name)) continue;
    await call(`${STRUCT}/${userStructureId}/property`, "POST", {
      name: r.name, label: r.label, propertyType: "objectReference", canRepeat: true,
      objectReference: { objectReferenceTypeId: idByType.get(r.target), objectReferenceRelation: "manyToOne" },
    });
    added++;
    console.log(`  + user.${r.name}`);
  }

  // pass 4 — many-to-many authorisations
  const M2M = [
    { table: "partner", name: "authorized_products", label: "Productos autorizados", target: "product" },
    { table: "seller", name: "authorized_products", label: "Productos autorizados", target: "product" },
  ];
  for (const r of M2M) {
    const have = propsByType.get(r.table) || new Set();
    if (have.has(r.name)) continue;
    await call(`${STRUCT}/${idByType.get(r.table)}/property`, "POST", {
      name: r.name, label: r.label, propertyType: "objectReference", canRepeat: true,
      objectReference: { objectReferenceTypeId: idByType.get(r.target), objectReferenceRelation: "manyToMany" },
    });
    added++;
    console.log(`  + ${r.table}.${r.name} (m2m)`);
  }

  console.log(`\n✔ Schema ready — ${TABLES.length} tables, ${added} properties added.`);
}

main().catch((e) => {
  console.error("✖ Schema setup failed:", e.message);
  process.exit(1);
});
