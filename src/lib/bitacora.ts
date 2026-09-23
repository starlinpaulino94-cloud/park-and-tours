/**
 * LA BITÁCORA, EN CASTELLANO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY QUE TRADUCIR
 *
 * La tabla guarda `record_updated` sobre `booking_cost`, que es exacto y no le
 * dice nada a quien firma el cierre del mes. Un reporte que hay que descifrar no
 * se lee: se archiva sin mirar, y entonces daba igual tenerlo.
 *
 * Y hay que AGRUPAR. Doscientos eventos en una lista plana no dicen si el mes
 * fue tranquilo o si alguien estuvo anulando facturas; el mismo listado
 * agrupado por módulo lo dice de un vistazo.
 *
 * Todo esto es puro a propósito: entra una fila, sale texto. Se puede probar
 * sin base de datos y sin navegador.
 */

export interface EventoBitacora {
  _id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  description?: string | null;
  severity?: string | null;
  occurred_at?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
}

/** Cómo se dice cada acción. Lo que no esté aquí sale con su nombre técnico. */
export const ACCION: Record<string, string> = {
  // Venta y su rastro
  order_created: "Venta creada",
  booking_cancelled: "Reserva cancelada",
  booking_checked_in: "Check-in realizado",
  booking_partial_checkin: "Check-in parcial",
  booking_no_show: "No-show registrado",
  booking_rescheduled: "Reserva reprogramada",
  capacity_override: "Cupo excedido con autorización",
  // Dinero
  payment_registered: "Cobro registrado",
  refund_registered: "Reembolso registrado",
  cash_session_opened: "Caja abierta",
  cash_session_closed: "Caja cerrada",
  cash_movement_registered: "Movimiento de caja",
  settlement_generated: "Liquidación generada",
  invoice_issued: "Factura emitida",
  invoice_issue_failed: "Cobro sin factura (falló la emisión)",
  invoice_voided: "Factura anulada",
  ledger_entry_posted: "Asiento contable",
  ledger_entry_reversed: "Asiento revertido",
  ledger_chart_updated: "Plan de cuentas actualizado",
  // Operación
  stock_movement_posted: "Movimiento de inventario",
  asset_status_changed: "Estado de activo cambiado",
  attraction_status_changed: "Estado de atracción cambiado",
  departures_generated: "Salidas generadas",
  // Plataforma
  record_created: "Registro creado",
  record_updated: "Registro editado",
  record_deleted: "Registro eliminado",
  file_uploaded: "Archivo subido",
  company_updated: "Empresa actualizada",
  workspace_switched: "Cambio de empresa",
  impersonation_started: "Suplantación iniciada",
  impersonation_stopped: "Suplantación finalizada",
  // Canales externos y huéspedes
  survey_answered: "Encuesta respondida",
  survey_opted_out: "Baja de encuestas",
  octo_booking_confirmed: "Reserva de OTA confirmada",
  octo_booking_cancelled: "Reserva de OTA cancelada",
  octo_hold_extended: "Retención de OTA extendida",
  membego_event_applied: "Evento de MembeGo",
  stripe_event_processed: "Evento de Stripe",

  // El resto de lo que el sistema escribe, traducido: en una hoja impresa
  // nadie debería encontrarse con `octo_hold_extended`.
  access_ticket_voided: "Ticket anulado",
  api_booking_created: "Reserva creada por la API de socios",
  api_key_created: "Llave de API creada",
  api_key_revoked: "Llave de API revocada",
  approval_requested: "Autorización solicitada",
  approval_signed: "Autorización firmada",
  approvals_expired: "Autorizaciones caducadas",
  attendance_approved: "Asistencia aprobada",
  attendance_unapproved: "Aprobación de asistencia retirada",
  cash_session_approved: "Cierre de caja aprobado",
  cash_session_recount: "Recuento de caja",
  commission_adjusted: "Comisión ajustada",
  commission_clawback: "Comisión recuperada",
  company_created_by_superadmin: "Empresa creada por el superadministrador",
  company_data_exported: "Datos de la empresa exportados",
  company_logo_updated: "Logo de la empresa actualizado",
  company_onboarded: "Empresa dada de alta",
  company_updated_by_superadmin: "Empresa editada por el superadministrador",
  credit_limit_override: "Límite de crédito excedido con autorización",
  data_exported: "Datos exportados",
  demo_data_seeded: "Datos de demostración sembrados",
  departure_closed: "Salida cerrada",
  dgii_report_generated: "Declaración DGII generada",
  drafts_reconciled: "Borradores conciliados",
  invoice_ncf_burned: "NCF quemado sin emitir",
  membego_benefit_redeemed: "Beneficio de MembeGo canjeado",
  membego_reversal_failed: "Reverso de MembeGo fallido",
  membego_reversal_manual: "Reverso de MembeGo manual",
  membego_unlinked: "MembeGo desvinculado",
  message_cancelled: "Mensaje cancelado",
  message_enqueued: "Mensaje encolado",
  message_retried: "Mensaje reintentado",
  mfa_reset: "Verificación en dos pasos restablecida",
  octo_booking_reserved: "Reserva de OTA retenida",
  payment_schedule_set: "Calendario de pagos fijado",
  payroll_exported: "Nómina exportada",
  payroll_generated: "Nómina generada",
  plan_created: "Plan creado",
  plan_deleted: "Plan eliminado",
  plan_updated: "Plan actualizado",
  public_booking_requested: "Reserva solicitada desde la web",
  purchase_order_received: "Orden de compra recibida",
  quote_created: "Cotización creada",
  quote_line_added: "Línea de cotización añadida",
  quote_line_removed: "Línea de cotización eliminada",
  quote_line_updated: "Línea de cotización editada",
  quote_option_added: "Opción de cotización añadida",
  quote_option_removed: "Opción de cotización eliminada",
  quote_option_selected: "Opción de cotización elegida",
  quote_revised: "Cotización revisada",
  seller_bonus_awarded: "Bono otorgado",
  settlement_paid: "Liquidación pagada",
  shifts_published: "Turnos publicados",
  statements_exported: "Estados de cuenta exportados",
  supplier_settlement_generated: "Liquidación a proveedor generada",
  task_completed: "Tarea completada",
  team_member_created: "Miembro del equipo creado",
  team_member_invited: "Miembro del equipo invitado",
  seller_account_linked: "Cuenta de acceso vinculada a un vendedor",
  seller_link_created: "Enlace de venta creado",
  team_member_updated: "Miembro del equipo editado",
  year_closed: "Cierre de año",
};

/**
 * A qué módulo pertenece cada tabla.
 *
 * Se agrupa por la ENTIDAD y no por la acción porque es lo que entiende quien
 * lee: «Caja» reúne la apertura, el cierre y cada movimiento, aunque sean
 * acciones distintas.
 */
const MODULO_POR_ENTIDAD: Record<string, string> = {
  sales_order: "Ventas", booking: "Reservas", participant: "Reservas", voucher: "Reservas",
  access_ticket: "Tickets", waitlist_entry: "Lista de espera",
  payment: "Cobros", receivable: "Cobros", payment_schedule: "Cobros",
  invoice: "Facturación", invoice_line: "Facturación", ncf_sequence: "Facturación",
  cash_session: "Caja", cash_movement: "Caja", cash_count: "Caja", cash_register: "Caja",
  commission: "Comisiones", commission_adjustment: "Comisiones", settlement: "Liquidaciones",
  payable: "Cuentas por pagar", expense: "Gastos",
  ledger_entry: "Contabilidad", ledger_account: "Contabilidad", accounting_period: "Contabilidad",
  payroll_run: "Nómina", payroll_line: "Nómina", staff: "Personal",
  attendance: "Personal", certification: "Personal", shift: "Personal",
  departure: "Salidas", departure_resource: "Salidas", pickup: "Recogidas", pickup_route: "Recogidas",
  product: "Catálogo", product_modality: "Catálogo", price_rule: "Catálogo", product_extra: "Catálogo",
  customer: "Clientes", lead: "CRM", crm_activity: "CRM", quote: "Cotizaciones",
  supplier: "Proveedores", hotel: "Hoteles", vehicle: "Transporte",
  inventory_item: "Almacén", stock_movement: "Almacén", purchase_order: "Almacén", stock_level: "Almacén",
  asset: "Mantenimiento", work_order: "Mantenimiento", maintenance_plan: "Mantenimiento",
  inspection: "Mantenimiento", attraction: "Parque", attraction_log: "Parque",
  incident: "Incidencias", incident_action: "Incidencias", guest_case: "Casos de huésped",
  guest_survey: "Encuestas", seller: "Vendedores", seller_goal: "Metas", seller_bonus: "Bonos",
  organizations: "Empresa", membego_event: "MembeGo",
};

/** El módulo de un evento. Sin entidad conocida, «Otros» — nunca vacío. */
export function moduloDe(e: EventoBitacora): string {
  const t = (e.entity_type || "").trim();
  if (t && MODULO_POR_ENTIDAD[t]) return MODULO_POR_ENTIDAD[t];
  if (e.action?.startsWith("octo_")) return "Canal OTA";
  if (e.action?.startsWith("stripe_")) return "Suscripción";
  if (e.action?.startsWith("impersonation_")) return "Soporte";
  return "Otros";
}

export interface ResumenModulo {
  modulo: string;
  total: number;
  /** Cuántos de esos eventos pedían atención. Es lo que se mira primero. */
  atencion: number;
}

/**
 * El resumen por módulo, de más a menos.
 *
 * A igualdad de total, alfabético: sin desempate, dos módulos con el mismo
 * número bailan de sitio entre dos impresiones del MISMO período, y entonces
 * dos copias del mismo reporte no se pueden comparar.
 */
export function resumirPorModulo(eventos: EventoBitacora[]): ResumenModulo[] {
  const mapa = new Map<string, ResumenModulo>();
  for (const e of eventos) {
    const modulo = moduloDe(e);
    const actual = mapa.get(modulo) || { modulo, total: 0, atencion: 0 };
    actual.total += 1;
    if (e.severity === "warning" || e.severity === "critical") actual.atencion += 1;
    mapa.set(modulo, actual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.modulo.localeCompare(b.modulo, "es"));
}
