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
      TENANT(), REF("booking", "Reserva", "booking"),
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
      REF("rule", "Regla aplicada", "commission_rule"),
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
      OPT("status", "Estado", ["pending", "approved", "partially_paid", "paid", "held", "disputed"]),
      D("issued_at", "Emitida"), FILE("pdf_file", "Documento"), TXT("notes", "Notas"),
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
      D("issue_date", "Emision", false), D("due_date", "Vencimiento", false),
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
      await call(`${STRUCT}/${structureId}/property`, "POST", prop);
      added++;
      console.log(`  + ${t.type}.${p.name}`);
    }
  }

  // pass 3 — self references (declared here to keep pass 2 declarative)
  const SELF_REFS = [
    { table: "partner", name: "parent_partner", label: "Partner padre", target: "partner" },
    { table: "seller", name: "supervisor", label: "Supervisor", target: "seller" },
    { table: "branch", name: "parent_branch", label: "Sucursal padre", target: "branch" },
  ];
  for (const r of SELF_REFS) {
    const have = propsByType.get(r.table) || new Set();
    if (have.has(r.name)) continue;
    await call(`${STRUCT}/${idByType.get(r.table)}/property`, "POST", {
      name: r.name, label: r.label, propertyType: "objectReference",
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
      name: r.name, label: r.label, propertyType: "objectReference",
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
      name: r.name, label: r.label, propertyType: "objectReference",
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
