/**
 * El inventario de lo que las migraciones 0032-0040 tienen que haber creado.
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
];
