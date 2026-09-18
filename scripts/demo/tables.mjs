/**
 * TODAS las tablas que el sembrador de demostración llena, EN ORDEN DE
 * DEPENDENCIA.
 *
 * Una sola lista, y de ella salen dos cosas que antes iban por separado y se
 * desincronizaban: el orden de siembra y —al revés— el orden de borrado.
 *
 * POR QUÉ IMPORTA EL ORDEN
 *
 * `organization_id` referencia a `organizations` con `on delete restrict`. O sea
 * que borrar la organización demo NO arrastra sus filas: la base lo impide
 * mientras quede una. Si una tabla sembrada falta en esta lista, su contenido
 * sobrevive al borrado y la siguiente siembra falla contra restos de la
 * anterior — o peor, el borrado parece funcionar y la empresa demo se queda
 * medio llena.
 *
 * Por eso hay una prueba que compara esta lista con las tablas que el sembrador
 * escribe de verdad: añadir una tabla nueva y olvidarse de apuntarla aquí rompe
 * la prueba en vez de romper la demostración.
 */
export const SEED_TABLES = [
  // ── cimientos ────────────────────────────────────────────────────────────
  "branch", "zone", "tax_profile", "currency_rate", "ledger_account",
  "accounting_period", "warehouse", "expense_category",

  // ── catálogo ─────────────────────────────────────────────────────────────
  "product_category", "cancellation_policy", "product", "product_modality",
  "price_rule", "product_extra", "product_bundle_item", "product_cost",
  "waiver_template", "inspection_template", "membership_plan",

  // ── personas y terceros ──────────────────────────────────────────────────
  "supplier", "hotel", "staff", "customer", "membership",
  "seller_type", "seller", "seller_link",

  // ── operación ────────────────────────────────────────────────────────────
  "vehicle", "asset", "maintenance_plan", "attraction", "departure",
  "departure_resource", "pickup_route", "shift", "attendance", "certification",
  "inventory_item", "stock_level",

  // ── comercial ────────────────────────────────────────────────────────────
  "promotion", "commission_rule", "seller_goal", "quote", "quote_option",
  "quote_line", "lead", "crm_activity",

  // ── venta y su rastro ────────────────────────────────────────────────────
  "sales_order", "booking", "booking_extra", "booking_cost", "participant",
  "voucher", "access_ticket", "waiver", "pickup", "seller_attribution",
  "payment_schedule", "payment", "receivable", "invoice", "invoice_line",
  "ncf_sequence", "gift_card", "gift_card_movement",

  // ── dinero ───────────────────────────────────────────────────────────────
  "cash_register", "cash_session", "cash_movement", "cash_count", "expense",
  "purchase_order", "purchase_order_line", "stock_movement",
  "commission", "commission_adjustment", "settlement", "seller_bonus",
  "payable", "ledger_entry", "payroll_run", "payroll_line",

  // ── operación diaria y plataforma ────────────────────────────────────────
  "work_order", "inspection", "incident", "incident_action", "guest_case",
  "attraction_log", "document", "document_ack", "task", "approval_request",
  "message_template", "message", "notification", "integration",
  "job_run", "system_incident", "audit_log",
];

/** El borrado va al revés: los hijos antes que los padres. */
export const TEARDOWN_TABLES = [...SEED_TABLES].reverse();
