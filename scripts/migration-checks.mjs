/**
 * El inventario de lo que las migraciones 0021-0066 tienen que haber creado.
 *
 * Vive aparte porque lo leen DOS cosas: `verify-migrations.mjs`, que se lo
 * pregunta a la base real, y una prueba que comprueba que cada línea de esta
 * lista existe de verdad en algún archivo de migración. Sin esa prueba, un
 * nombre mal escrito aquí haría que el verificador reportara un fallo que no
 * existe —y hacer dudar de una base que está bien es peor que no comprobarla.
 */
/**
 * Qué tiene que existir, agrupado por la migración que lo trajo.
 *
 * `table` comprueba que la tabla existe; `columns` que existen esas columnas
 * (PostgREST devuelve 42703 cuando se pide una que no está); `enum` que un valor
 * del enum es aceptable (22P02 cuando no), y `rpc` que la función está publicada.
 */
export const MIGRATION_CHECKS = [
  /**
   * 0021 y 0030 — LAS COLUMNAS DE EJECUCIÓN.
   *
   * Este inventario empezaba en 0032, y esas dos migraciones se quedaron fuera
   * justamente por ser las más antiguas. Fue un punto ciego real: la búsqueda
   * sin acentos (0062) falló en producción con «column email does not exist»
   * porque `seller.email` —que añade 0030— no estaba, y nadie lo había
   * comprobado nunca.
   *
   * Y no era solo la búsqueda: sin esas columnas, PostgREST rechaza el UPDATE
   * ENTERO al guardar un vendedor, así que escribir su teléfono perdía también
   * el nombre. Es el mismo fallo que ya apareció con 0042 y 0044, en una
   * migración que nadie miraba.
   */
  {
    migration: "0021 — columnas de ejecución (primera ronda)",
    columns: [
      ["booking", ["booking_date"]],
      ["product", ["sort_order"]],
      ["product_modality", ["sort_order"]],
    ],
  },
  {
    migration: "0030 — columnas de ejecución (segunda ronda)",
    columns: [
      ["booking", ["unit_price", "hotel_id", "pickup_time", "pickup_location", "room_number",
                   "voucher_code", "checked_in_at", "checked_in_pax", "override_reason",
                   "notes", "internal_notes"]],
      ["participant", ["full_name", "age", "nationality", "special_requirements", "notes"]],
      ["voucher", ["issued_at", "notes"]],
      ["departure", ["branch_id", "departure_time", "available_pax", "waitlist_pax",
                     "meeting_point", "notes"]],
      ["sales_order", ["promotion_id"]],
      ["customer", ["hotel_id", "assigned_seller_id", "whatsapp", "language", "room",
                    "address", "preferences"]],
      // Las que tumbaron 0062 en producción.
      ["seller", ["branch_id", "email", "phone", "whatsapp", "seller_role", "monthly_goal",
                  "currency", "photo_url", "hire_date", "notes"]],
      ["product", ["category_id", "short_description", "cover_image_url", "video_url",
                   "location", "meeting_point", "duration_hours", "languages", "min_age",
                   "default_capacity", "restrictions", "recommendations", "inclusions",
                   "exclusions", "terms", "instructions", "base_cost", "featured"]],
      ["product_modality", ["cost", "age_from", "age_to", "capacity_weight"]],
      ["price_rule", ["time_from", "time_to"]],
      ["zone", ["zone_type", "max_capacity", "current_occupancy", "requires_wristband"]],
      ["cash_register", ["branch_id", "terminal"]],
      ["cash_session", ["branch_id", "code", "difference", "card_total", "transfer_total",
                        "expenses_total", "withdrawals_total", "notes"]],
      ["commission", ["beneficiary_name", "generated_at", "notes"]],
      ["commission_rule", ["category_id", "description"]],
      ["settlement", ["sales_total", "cancellations_total", "notes"]],
      ["receivable", ["notes"]],
      ["payable", ["supplier_id", "concept", "paid_at", "notes"]],
    ],
  },
  {
    migration: "0032 — profundidad de la cotización",
    tables: ["quote_option"],
    columns: [
      ["quote", ["version", "revision_of_id", "selected_option_id", "deposit_type",
                 "deposit_percent", "deposit_amount", "deposit_due_date", "balance_due_date",
                 "payment_terms", "inclusions", "exclusions"]],
      ["quote_line", ["option_id", "is_optional", "sort_order", "line_type",
                      "adults", "children", "infants", "supplier_id"]],
    ],
  },
  {
    migration: "0033 — cierre de la salida",
    columns: [
      ["departure", ["closed_at", "closed_by", "departed_at", "returned_at",
                     "actual_pax", "no_show_pax", "incident_notes", "guide_notes"]],
    ],
  },
  {
    migration: "0034/0035 — bandeja de salida",
    tables: ["message_template", "message"],
    columns: [["message", ["channel", "status", "dedupe_key", "scheduled_at", "attachment_kind"]]],
  },
  {
    migration: "0036 — extras vendibles",
    tables: ["product_extra", "booking_extra"],
    columns: [["booking", ["extras_amount", "extras_cost"]]],
  },
  {
    migration: "0037 — facturación fiscal",
    tables: ["invoice_line", "ncf_sequence"],
    columns: [
      ["invoice", ["credit_note_of_id", "ncf_expires_at", "balance", "issued_by"]],
      ["ncf_sequence", ["ncf_type", "next_number", "max_number", "expires_at", "status"]],
    ],
    rpc: ["next_ncf"],
  },
  {
    migration: "0038 — arqueo de caja",
    tables: ["cash_count"],
    columns: [
      ["cash_session", ["closed_by", "approved_by", "approved_at", "requires_approval",
                        "expected_by_currency", "counted_by_currency", "difference_by_currency",
                        "card_batch_total", "card_batch_reference", "deposit_reference"]],
      ["cash_register", ["difference_tolerance"]],
      ["cash_count", ["currency", "kind", "breakdown", "counted_total", "expected_total", "difference"]],
      ["ledger_entry", ["cash_session_id"]],
    ],
    enums: [["cash_session", "status", "pending_approval"]],
  },
  {
    migration: "0039 — anticipo, saldo y cuotas",
    tables: ["payment_schedule"],
    columns: [
      ["payment_schedule", ["order_id", "sequence", "kind", "due_date", "amount",
                            "paid_amount", "balance", "status", "reminded_at"]],
      ["sales_order", ["deposit_type", "deposit_percent", "deposit_amount", "deposit_due_date",
                       "balance_due_date", "payment_terms", "hold_until", "collection_status"]],
      ["product", ["deposit_type", "deposit_percent", "deposit_amount", "balance_due_days"]],
      ["booking", ["balance_due_date"]],
      ["payment", ["schedule_id"]],
      ["organizations", ["hold_hours"]],
    ],
    enums: [
      ["sales_order", "collection_status", "overdue"],
      // El enum `aging_bucket` se renombró para hablar como la pantalla.
      ["receivable", "aging_bucket", "d1_30"],
    ],
  },
  {
    migration: "0040 — liquidación de proveedores",
    tables: ["booking_cost"],
    columns: [
      ["booking_cost", ["booking_id", "supplier_id", "product_cost_id", "settlement_id",
                        "concept", "cost_type", "quantity", "unit_cost", "amount",
                        "confirmed_amount", "status"]],
      ["settlement", ["supplier_id", "services_total", "confirmed_total", "adjustments_total",
                      "retention_isr", "retention_itbis", "retention_total", "net_total",
                      "supplier_invoice_number", "supplier_invoice_ncf", "supplier_invoice_date",
                      "confirmed_at", "confirmed_by", "dispute_reason", "beneficiary_name",
                      "last_payment_at"]],
      ["supplier", ["tax_regime", "retention_isr_pct", "retention_itbis_pct", "tax_rate",
                    "bank_name", "bank_account"]],
      ["booking", ["accrued_cost"]],
    ],
    enums: [["settlement", "beneficiary_type", "supplier"]],
  },
  {
    migration: "0041 — satélite de MembeGo",
    tables: ["membego_link", "membego_user", "membego_customer", "membego_event", "membego_sso_jti"],
    columns: [
      ["membego_link", ["membego_company_id", "status", "linked_by", "last_event_at", "events_received"]],
      ["membego_user", ["membego_sub", "user_id", "membego_role", "role_managed", "last_login_at"]],
      ["membego_customer", ["membego_cliente_id", "customer_id", "plan_id", "plan_name",
                            "membership_id", "membership_paid", "membership_valid_until",
                            "visits", "purchases"]],
      ["membego_event", ["event_id", "tipo", "payload", "status", "error", "received_at"]],
    ],
  },
  {
    migration: "0042 — el plan como contrato aplicable",
    columns: [["organizations", ["trial_ends_at", "next_billing_at", "storage_used_mb"]]],
  },
  /**
   * 0043 — límite de peticiones. NO se comprueba aquí a propósito.
   *
   * `app.rate_limit_bucket` vive en el esquema `app`, que PostgREST no expone.
   * `sb.from("app.rate_limit_bucket")` no la encontraría nunca y este script
   * reportaría un fallo permanente sobre una base correcta — que es justo lo
   * que no puede hacer. Lo que sí la comprueba es `scripts/db-test.sh`.
   */
  {
    migration: "0044 — avisos internos",
    columns: [["notification", ["audience_role", "event_key", "entity_type", "entity_id", "dedupe_key"]]],
  },
  {
    migration: "0045 — reprogramar sin cancelar",
    columns: [["booking", ["previous_departure_id", "rescheduled_at", "reschedule_reason", "reschedule_count"]]],
  },
  {
    migration: "0046 — ámbito de sucursal",
    columns: [["organization_memberships", ["branch_id"]]],
  },
  {
    migration: "0047 — motor de reservas público",
    columns: [
      ["organizations", ["public_booking_enabled", "public_intro", "public_terms"]],
      ["product", ["published", "public_price_from"]],
      ["booking", ["public_request"]],
    ],
  },
  {
    migration: "0048 — embarque sin conexión",
    columns: [["booking", ["checkin_key"]]],
  },
  {
    migration: "0049 — declaración 606",
    columns: [
      ["expense", ["ncf", "ncf_type", "ncf_modified", "supplier_rnc", "itbis_amount",
                   "itbis_withheld", "isr_withheld", "selective_tax", "other_taxes",
                   "legal_tip", "goods_service_type", "paid_date"]],
    ],
  },
  {
    migration: "0050 — llaves de API",
    tables: ["api_key"],
    columns: [
      ["api_key", ["prefix", "secret_hash", "scope", "partner_id", "revoked_at", "last_used_at"]],
      ["sales_order", ["idempotency_key"]],
    ],
  },
  {
    migration: "0051 — RR. HH.",
    tables: ["payroll_run", "payroll_line"],
    columns: [
      ["staff", ["payroll_code", "salary_type", "base_salary", "hourly_rate",
                 "social_security_id", "bank_account", "bank_name",
                 "applies_social_security", "termination_date"]],
      ["certification", ["reminder_sent_at", "checked_at"]],
      ["shift", ["published_at", "published_by"]],
      ["attendance", ["break_min", "regular_hours", "approved_at", "payroll_run_id"]],
      // Los porcentajes se CONGELAN en la corrida: una nómina de marzo no puede
      // recalcularse con los tipos de junio.
      ["payroll_run", ["period_start", "period_end", "period_type", "status",
                       "sfs_employee_pct", "afp_employee_pct", "sfs_employer_pct",
                       "afp_employer_pct", "risk_employer_pct", "employer_cost"]],
      ["payroll_line", ["staff_id", "days_worked", "regular_hours", "overtime_hours",
                        "extra_overtime_hours", "gross_amount", "sfs_employee",
                        "afp_employee", "isr_amount", "net_amount"]],
    ],
  },
  {
    migration: "0052 — recepción de compra y existencias apartadas",
    columns: [
      ["stock_movement", ["purchase_order_line_id", "booking_extra_id"]],
      ["product_extra", ["inventory_item_id", "warehouse_id", "consumes_stock", "stock_per_unit"]],
      ["booking_extra", ["inventory_item_id", "warehouse_id", "stock_quantity", "stock_state"]],
      ["purchase_order", ["receipt_count", "last_received_by"]],
    ],
  },
  {
    migration: "0053 — cierre contable",
    tables: ["accounting_period"],
    columns: [
      ["accounting_period", ["period", "status", "closed_at", "closed_by", "locked_at", "reopened_at"]],
      ["ledger_entry", ["is_closing", "closes_year"]],
      // El 608 necesita el motivo de anulación; sin él la declaración no se arma.
      ["invoice", ["void_reason_code"]],
    ],
  },
  {
    migration: "0054 — motor de cupos",
    columns: [
      // Cancelar devuelve las plazas a SU cupo: sin estas dos, no se sabe a cuál.
      ["booking", ["allotment_id", "allotment_seats"]],
      ["allotment", ["released_at", "release_runs", "closed_at", "closed_by"]],
    ],
  },
  {
    migration: "0055 — la marca en los documentos",
    columns: [
      /**
       * Estas son las que más importan de toda la lista.
       *
       * Faltaban en producción mientras la pantalla de Configuración las pedía,
       * y PostgREST rechaza el UPDATE ENTERO cuando una sola columna no existe:
       * escribir un WhatsApp perdía también el nombre y el RNC del formulario.
       */
      ["organizations", ["whatsapp", "address", "city", "group_name", "notes",
                         "logo_url", "brand_color", "document_footer",
                         "voucher_terms", "invoice_terms"]],
    ],
  },
  {
    migration: "0056 — conector OTA (OCTO)",
    columns: [
      ["booking", ["octo_uuid", "octo_option_id", "octo_status", "octo_reseller_reference",
                   "octo_unit_items", "octo_contact", "octo_test_mode",
                   "octo_confirmed_at", "octo_api_key_id"]],
      ["organizations", ["octo_max_hold_minutes"]],
    ],
  },
  {
    migration: "0057 — canje de beneficios MembeGo",
    tables: ["membego_redemption"],
    columns: [
      ["membego_redemption", ["order_id", "booking_id", "customer_id", "membego_cliente_id",
                              "benefit_type", "benefit_id", "redemption_id", "uses_left",
                              "effect_kind", "amount_discounted", "status", "idempotency_key"]],
      ["booking", ["membego_benefit", "membego_discount"]],
    ],
  },
  {
    migration: "0058 — atribución comercial",
    tables: ["seller_type", "seller_link", "seller_attribution"],
    columns: [
      ["seller_link", ["seller_id", "slug", "name", "channel", "product_id", "campaign", "status"]],
      ["seller_attribution", ["seller_id", "link_id", "customer_id", "visitor_id",
                              "stage", "channel", "landing", "campaign",
                              "order_id", "booking_id"]],
      ["seller", ["seller_type_id"]],
      // Sin estas dos, la venta no puede decir POR QUÉ le tocó a ese vendedor.
      ["sales_order", ["attribution_id", "attribution_policy"]],
      ["organizations", ["attribution_policy", "attribution_window_days"]],
    ],
  },
  {
    migration: "0059 — profundidad de las comisiones",
    tables: ["commission_adjustment"],
    columns: [
      ["commission_adjustment", ["commission_id", "amount", "currency", "reason",
                                 "reason_code", "booking_id", "settlement_id", "created_by"]],
      // Sin `breakdown` la comisión no se puede explicar, y sin `net_amount` la
      // liquidación no sabe cuánto queda por pagar de verdad.
      ["commission", ["breakdown", "pax_adults", "pax_children",
                      "adjustment_total", "net_amount"]],
      ["commission_rule", ["tier_basis", "effective_from", "effective_to"]],
    ],
    // Los tres tipos de cálculo por pasajero: sin ellos, una regla guardada con
    // uno de ellos rompería el INSERT entero.
    enums: [["commission_rule", "calc_type", "per_adult"]],
  },
  {
    migration: "0060 — metas comerciales y bonos",
    tables: ["seller_goal", "seller_bonus"],
    columns: [
      ["seller_goal", ["seller_id", "seller_type_id", "branch_id", "product_id", "category_id",
                       "period", "period_from", "period_to",
                       "target_signups", "target_bookings", "target_sales",
                       "target_pax", "target_revenue", "currency", "reward", "status"]],
      ["seller_bonus", ["seller_id", "goal_id", "description", "condition", "amount",
                        "currency", "payout_kind", "status", "settlement_id",
                        "awarded_at", "paid_at", "approved_by"]],
      // Sin estas dos, la liquidación no puede separar lo que se transfiere de
      // lo que ya se entregó, y la operadora transfiere de más.
      ["settlement", ["bonus_total", "in_kind_total"]],
    ],
  },
  {
    migration: "0061 — combos y paquetes",
    tables: ["product_bundle_item"],
    columns: [
      ["product_bundle_item", ["bundle_id", "product_id", "modality_id", "day_offset",
                               "sort_order", "fixed_time", "allow_overlap", "is_optional"]],
      ["product", ["is_bundle", "bundle_buffer_minutes"]],
      // Sin estas dos, cancelar un paquete no encuentra sus actividades y
      // quedan plazas bloqueadas en salidas sin ninguna reserva que las explique.
      ["booking", ["bundle_booking_id", "bundle_item_id"]],
    ],
  },
  {
    migration: "0062 — búsqueda sin acentos",
    columns: [
      // Sin la columna, la búsqueda de personas vuelve a fallar con «jose
      // perez» — y no da error: devuelve cero, que parece «no existe».
      ["customer", ["search_text"]],
      ["seller", ["search_text"]],
      ["product", ["search_text"]],
      ["supplier", ["search_text"]],
    ],
  },
  {
    migration: "0064 — salud del sistema",
    tables: ["job_run", "system_incident"],
    columns: [
      // Sin `status`, un trabajo colgado no se distingue de uno que terminó, y
      // la pantalla de estado diría que todo va bien mientras nada corre.
      // `trigger` distingue «corrió solo» de «lo empujó alguien», que es la
      // diferencia que importa cuando se investiga por qué algo no se envió.
      ["job_run", ["organization_id", "job", "trigger", "started_at", "finished_at", "status", "summary", "error"]],
      // `fingerprint` y `occurrences` son la agrupación entera: sin ellas, mil
      // ocurrencias del mismo fallo son mil filas y la pantalla es ilegible
      // justo el día que hay que leerla.
      ["system_incident", [
        "organization_id", "fingerprint", "source", "message", "level",
        "occurrences", "first_seen_at", "last_seen_at", "status", "context",
      ]],
    ],
    // `public.health_probe()` NO se comprueba aquí, y está dicho por qué: se le
    // revoca el permiso a todo el mundo salvo al servicio, así que el
    // verificador —que pregunta con la llave pública— recibiría un «permiso
    // denegado» y lo reportaría como fallo sobre una base correcta. Un
    // verificador que da falsas alarmas se deja de mirar. La cubre
    // supabase/tests/system_health.test.sql, que además comprueba que detecta el
    // enganche roto.
  },
  {
    migration: "0065 — logística del día",
    columns: [
      // `pickup_offset_min` en la zona es lo que hace utilizable el del hotel:
      // sin él, nadie pone el margen a doscientos hoteles uno por uno y la hora
      // de recogida sigue siendo la que teclee quien vende.
      ["zone", ["pickup_offset_min"]],
      // `planned_time` va SEPARADA de `pickup_time` a propósito. Si faltara, el
      // motor escribiría sobre la hora que el cliente ya tiene en su voucher.
      // Sin `sequence` no hay hoja de ruta: el conductor decide el recorrido en
      // la calle.
      ["pickup", ["planned_time", "sequence"]],
      // Sin `auto_key`, cada clic en «armar rutas» duplicaría las rutas del día.
      ["pickup_route", ["auto_key"]],
      // El estado 'conflict' existe en el check desde 0010; el motivo escrito al
      // lado es lo que evita que el despacho tenga que adivinar qué pasa.
      ["departure_resource", ["conflict_reason"]],
    ],
  },
  {
    migration: "0066 — lista de espera",
    tables: ["waitlist_entry"],
    columns: [
      // Sin `status` y `offer_expires_at` no hay oferta con plazo: la plaza se
      // guardaría para siempre a nombre de quien no contestó. Sin `booking_id`
      // no se puede contestar la única pregunta que justifica el módulo, que es
      // cuánta venta recuperó la lista.
      ["waitlist_entry", [
        "organization_id", "departure_id", "customer_id",
        "contact_name", "contact_phone", "contact_email",
        "seller_id", "partner_id", "pax", "status",
        "offered_at", "offer_expires_at", "booking_id", "notes",
      ]],
    ],
  },
];
