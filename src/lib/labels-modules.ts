/**
 * Spanish labels + tones for the enums introduced by the blueprint modules
 * (park operations, safety, maintenance, retail, guest experience, accounting,
 * team and administration). Same contract as `labels.ts`.
 */
import type { LabelDef, Tone } from "@/lib/labels";

const d = (label: string, tone: Tone = "neutral"): LabelDef => ({ label, tone });

/** Builds a dictionary from `[value, label, tone]` triples. */
function dict(...rows: [string, string, Tone?][]): Record<string, LabelDef> {
  return Object.fromEntries(rows.map(([v, l, t]) => [v, d(l, t)]));
}

export const YES_NO = dict(["yes", "Sí", "success"], ["no", "No", "neutral"]);
export const PRIORITY = dict(
  ["low", "Baja"], ["medium", "Media", "warning"], ["high", "Alta", "warning"], ["urgent", "Urgente", "danger"]
);

/* ------------------------------------------------------------------ parque */
export const ZONE_TYPE = dict(
  ["attraction_area", "Área de atracciones", "info"], ["pool", "Piscina", "info"], ["beach", "Playa", "warning"],
  ["restaurant", "Restaurante", "warning"], ["shop", "Tienda", "violet"], ["parking", "Estacionamiento"],
  ["backstage", "Área interna"], ["entrance", "Entrada", "success"], ["trail", "Sendero", "success"]
);
export const ATTRACTION_TYPE = dict(
  ["ride", "Atracción mecánica", "info"], ["water", "Acuática", "info"], ["show", "Espectáculo", "violet"],
  ["animal", "Fauna", "success"], ["adventure", "Aventura", "warning"], ["exhibit", "Exhibición"],
  ["play_area", "Área de juegos", "warning"], ["service", "Servicio"]
);
export const ATTRACTION_STATUS = dict(
  ["open", "Abierta", "success"], ["delayed", "Con retraso", "warning"], ["paused", "En pausa", "warning"],
  ["closed", "Cerrada"], ["maintenance", "En mantenimiento", "danger"], ["weather_hold", "Detenida por clima", "info"]
);
export const ATTRACTION_EVENT = dict(
  ["status_change", "Cambio de estado", "info"], ["capacity_change", "Cambio de aforo", "violet"],
  ["incident", "Incidente", "danger"], ["weather", "Clima", "info"], ["cleaning", "Limpieza"],
  ["headcount", "Conteo", "success"], ["note", "Nota"]
);
export const TICKET_TYPE = dict(
  ["day_pass", "Pase del día", "info"], ["single_use", "Uso único"], ["multi_day", "Multidía", "violet"],
  ["season_pass", "Pase de temporada", "warning"], ["annual", "Anual", "success"], ["wristband", "Pulsera", "info"],
  ["locker", "Casillero"], ["parking", "Estacionamiento"]
);
export const TICKET_STATUS = dict(
  ["issued", "Emitido", "info"], ["active", "Activo", "success"], ["redeemed", "Redimido"],
  ["partially_used", "Parcialmente usado", "warning"], ["expired", "Expirado"], ["void", "Anulado", "danger"],
  ["transferred", "Transferido", "violet"]
);

/* --------------------------------------------------------------- seguridad */
export const WAIVER_STATUS = dict(
  ["signed", "Firmado", "success"], ["pending", "Pendiente", "warning"], ["expired", "Expirado"],
  ["revoked", "Revocado", "danger"]
);
export const WAIVER_CHANNEL = dict(
  ["kiosk", "Kiosco", "info"], ["online", "En línea", "violet"], ["counter", "Mostrador"], ["mobile", "Móvil", "info"]
);
export const INCIDENT_SEVERITY = dict(
  ["minor", "Leve"], ["moderate", "Moderada", "warning"], ["major", "Grave", "warning"],
  ["critical", "Crítica", "danger"], ["fatality", "Fatal", "danger"]
);
export const INCIDENT_TYPE = dict(
  ["injury", "Lesión", "danger"], ["illness", "Enfermedad", "warning"], ["near_miss", "Cuasi-accidente", "warning"],
  ["property_damage", "Daño a la propiedad", "violet"], ["lost_child", "Menor extraviado", "danger"],
  ["security", "Seguridad", "info"], ["environmental", "Ambiental", "success"],
  ["ride_stoppage", "Parada de atracción"], ["food_safety", "Inocuidad alimentaria", "warning"], ["other", "Otro"]
);
export const INCIDENT_STATUS = dict(
  ["open", "Abierto", "danger"], ["investigating", "En investigación", "warning"],
  ["action_required", "Requiere acción", "warning"], ["resolved", "Resuelto", "success"], ["closed", "Cerrado"],
  ["escalated", "Escalado", "violet"]
);
export const ACTION_STATUS = dict(
  ["pending", "Pendiente", "warning"], ["in_progress", "En curso", "info"], ["done", "Hecha", "success"],
  ["cancelled", "Cancelada"], ["verified", "Verificada", "violet"]
);
export const INSPECTION_RESULT = dict(
  ["pass", "Aprobada", "success"], ["pass_with_observations", "Con observaciones", "warning"],
  ["fail", "Fallida", "danger"], ["not_applicable", "No aplica"]
);
export const INSPECTION_FREQUENCY = dict(
  ["pre_opening", "Pre-apertura", "danger"], ["daily", "Diaria", "info"], ["weekly", "Semanal", "info"],
  ["monthly", "Mensual", "violet"], ["quarterly", "Trimestral", "warning"], ["annual", "Anual"],
  ["on_demand", "Bajo demanda"]
);
export const INSPECTION_CATEGORY = dict(
  ["safety", "Seguridad", "danger"], ["mechanical", "Mecánica"], ["electrical", "Eléctrica", "warning"],
  ["hygiene", "Higiene", "info"], ["water_quality", "Calidad del agua", "info"],
  ["food_safety", "Inocuidad alimentaria", "warning"], ["vehicle", "Vehículos", "violet"],
  ["fire", "Incendios", "danger"], ["general", "General"]
);

/* ---------------------------------------------------------- mantenimiento */
export const ASSET_TYPE = dict(
  ["ride", "Atracción", "info"], ["vehicle", "Vehículo", "info"], ["boat", "Embarcación", "info"],
  ["buggy", "Buggy", "warning"], ["equipment", "Equipo", "violet"], ["facility", "Instalación"],
  ["it", "Tecnología"], ["pool", "Piscina", "info"]
);
export const ASSET_STATUS = dict(
  ["in_service", "En servicio", "success"], ["maintenance", "En mantenimiento", "warning"],
  ["out_of_service", "Fuera de servicio", "danger"], ["retired", "Retirado"]
);
export const CRITICALITY = dict(
  ["critical", "Crítica", "danger"], ["high", "Alta", "warning"], ["medium", "Media", "warning"], ["low", "Baja"]
);
export const WORK_ORDER_TYPE = dict(
  ["corrective", "Correctivo", "warning"], ["preventive", "Preventivo", "info"],
  ["predictive", "Predictivo", "violet"], ["improvement", "Mejora", "success"],
  ["inspection_followup", "Seguimiento de inspección", "info"], ["emergency", "Emergencia", "danger"]
);
export const WORK_ORDER_STATUS = dict(
  ["draft", "Borrador"], ["open", "Abierta", "info"], ["assigned", "Asignada", "info"],
  ["in_progress", "En curso", "warning"], ["waiting_parts", "Esperando repuestos", "warning"],
  ["waiting_approval", "Esperando aprobación", "violet"], ["done", "Terminada", "success"],
  ["verified", "Verificada", "success"], ["cancelled", "Cancelada"]
);
export const TRIGGER_TYPE = dict(
  ["calendar", "Calendario", "info"], ["meter_hours", "Horómetro", "violet"], ["meter_km", "Kilometraje", "info"],
  ["usage_count", "Usos", "warning"], ["condition", "Condición", "warning"]
);

/* -------------------------------------------------------------- comercio */
export const WAREHOUSE_TYPE = dict(
  ["main", "Principal", "info"], ["kitchen", "Cocina", "warning"], ["bar", "Bar", "violet"],
  ["shop", "Tienda", "success"], ["maintenance", "Taller"], ["uniforms", "Uniformes", "info"],
  ["transit", "En tránsito", "warning"]
);
export const ITEM_TYPE = dict(
  ["food", "Alimentos", "warning"], ["beverage", "Bebidas", "info"], ["retail", "Retail", "violet"],
  ["souvenir", "Souvenirs", "warning"], ["uniform", "Uniformes", "info"], ["spare_part", "Repuestos"],
  ["consumable", "Consumibles"], ["fuel", "Combustible", "danger"], ["chemical", "Químicos", "success"],
  ["packaging", "Empaque"]
);
export const ITEM_UNIT = dict(
  ["unit", "Unidad"], ["kg", "Kilogramo"], ["g", "Gramo"], ["l", "Litro"], ["ml", "Mililitro"],
  ["box", "Caja"], ["pack", "Paquete"], ["bottle", "Botella"], ["case", "Cajón"]
);
export const MOVEMENT_TYPE = dict(
  ["receipt", "Entrada", "success"], ["sale", "Venta", "info"], ["consumption", "Consumo", "violet"],
  ["transfer_out", "Transferencia salida", "warning"], ["transfer_in", "Transferencia entrada", "info"],
  ["waste", "Merma", "danger"], ["adjustment", "Ajuste", "warning"], ["return", "Devolución"],
  ["count", "Conteo"]
);
export const PO_STATUS = dict(
  ["draft", "Borrador"], ["pending_approval", "Por aprobar", "warning"], ["approved", "Aprobada", "info"],
  ["sent", "Enviada", "info"], ["partially_received", "Parcialmente recibida", "warning"],
  ["received", "Recibida", "success"], ["invoiced", "Facturada", "success"], ["cancelled", "Cancelada"],
  ["rejected", "Rechazada", "danger"]
);

/* -------------------------------------------------------------- clientes */
export const MEMBERSHIP_PLAN_TYPE = dict(
  ["annual_pass", "Pase anual", "success"], ["season_pass", "Pase de temporada", "warning"],
  ["monthly", "Mensual", "info"], ["corporate", "Corporativa", "violet"], ["family", "Familiar", "info"],
  ["vip", "VIP", "warning"]
);
export const MEMBERSHIP_STATUS = dict(
  ["active", "Activa", "success"], ["pending", "Pendiente", "warning"], ["suspended", "Suspendida", "warning"],
  ["expired", "Expirada"], ["cancelled", "Cancelada", "danger"]
);
export const GIFT_CARD_STATUS = dict(
  ["active", "Activa", "success"], ["redeemed", "Redimida"], ["partially_used", "Parcialmente usada", "warning"],
  ["expired", "Expirada"], ["void", "Anulada", "danger"]
);
export const GIFT_MOVEMENT_TYPE = dict(
  ["issue", "Emisión", "success"], ["redeem", "Redención", "info"], ["refund", "Reembolso", "warning"],
  ["adjustment", "Ajuste", "violet"], ["expire", "Expiración"]
);
export const CASE_TYPE = dict(
  ["complaint", "Queja", "danger"], ["claim", "Reclamo", "warning"], ["compliment", "Felicitación", "success"],
  ["lost_item", "Objeto perdido", "warning"], ["found_item", "Objeto encontrado", "info"],
  ["refund_request", "Solicitud de reembolso", "violet"], ["accessibility", "Accesibilidad", "info"],
  ["special_request", "Solicitud especial"]
);
export const CASE_STATUS = dict(
  ["open", "Abierto", "danger"], ["in_progress", "En curso", "warning"],
  ["waiting_customer", "Esperando al cliente", "info"], ["resolved", "Resuelto", "success"],
  ["closed", "Cerrado"], ["escalated", "Escalado", "violet"]
);
export const CASE_CHANNEL = dict(
  ["counter", "Mostrador"], ["phone", "Teléfono", "info"], ["email", "Email", "info"],
  ["whatsapp", "WhatsApp", "success"], ["web", "Web", "violet"], ["social", "Redes sociales", "warning"],
  ["review_site", "Sitio de reseñas", "warning"]
);
export const COMPENSATION_TYPE = dict(
  ["none", "Ninguna"], ["refund", "Reembolso", "danger"], ["voucher", "Voucher", "info"],
  ["free_visit", "Visita gratis", "success"], ["upgrade", "Mejora", "violet"], ["gift", "Obsequio", "warning"]
);

/* ---------------------------------------------------- ventas y cotización */
export const QUOTE_STATUS = dict(
  ["draft", "Borrador"], ["sent", "Enviada", "info"], ["negotiating", "En negociación", "warning"],
  ["accepted", "Aceptada", "success"], ["rejected", "Rechazada", "danger"], ["expired", "Expirada"],
  ["converted", "Convertida", "success"]
);
export const QUOTE_TYPE = dict(
  ["group", "Grupo", "info"], ["corporate", "Corporativa", "violet"], ["wedding", "Boda", "warning"],
  ["school", "Escolar", "success"], ["incentive", "Incentivo", "warning"], ["cruise", "Crucero", "info"],
  ["custom", "Personalizada"]
);
export const ALLOTMENT_TYPE = dict(
  ["free_sale", "Venta libre", "success"], ["guaranteed", "Garantizado", "info"],
  ["on_request", "Bajo petición", "warning"], ["closed", "Cerrado", "danger"]
);

/* -------------------------------------------------------------- finanzas */
export const ACCOUNT_TYPE = dict(
  ["asset", "Activo", "info"], ["liability", "Pasivo", "warning"], ["equity", "Patrimonio", "violet"],
  ["revenue", "Ingreso", "success"], ["expense", "Gasto", "danger"], ["contra", "Contra-cuenta"]
);
export const SUBLEDGER = dict(
  ["cash", "Efectivo", "success"], ["bank", "Banco", "info"], ["receivable", "Por cobrar", "info"],
  ["payable", "Por pagar", "warning"], ["inventory", "Inventario", "violet"],
  ["deferred_revenue", "Ingreso diferido", "warning"], ["tax", "Impuestos", "danger"],
  ["commission", "Comisiones", "violet"], ["payroll", "Nómina"], ["fixed_asset", "Activo fijo"],
  ["gift_card_liability", "Pasivo gift cards", "warning"], ["membership_liability", "Pasivo membresías", "warning"]
);
export const NORMAL_SIDE = dict(["debit", "Débito", "info"], ["credit", "Crédito", "warning"]);
export const LEDGER_SOURCE = dict(
  ["sale", "Venta", "success"], ["payment", "Pago", "info"], ["refund", "Reembolso", "danger"],
  ["commission", "Comisión", "violet"], ["settlement", "Liquidación", "info"], ["expense", "Gasto", "warning"],
  ["payable", "Por pagar", "warning"], ["purchase", "Compra", "warning"], ["inventory", "Inventario", "violet"],
  ["payroll", "Nómina"], ["adjustment", "Ajuste"], ["opening", "Apertura"], ["tax", "Impuesto", "danger"],
  ["gift_card", "Gift card", "warning"], ["membership", "Membresía", "warning"]
);
export const INVOICE_STATUS = dict(
  ["draft", "Borrador"], ["issued", "Emitida", "info"], ["sent", "Enviada", "info"],
  ["paid", "Pagada", "success"], ["partially_paid", "Parcialmente pagada", "warning"],
  ["overdue", "Vencida", "danger"], ["cancelled", "Cancelada"], ["voided", "Anulada", "danger"]
);
export const INVOICE_TYPE = dict(
  ["sale", "Factura", "success"], ["credit_note", "Nota de crédito", "danger"],
  ["debit_note", "Nota de débito", "warning"], ["proforma", "Proforma"]
);
export const EFAC_STATUS = dict(
  ["pending", "Pendiente", "warning"], ["sent", "Enviado", "info"], ["accepted", "Aceptado", "success"],
  ["rejected", "Rechazado", "danger"], ["not_applicable", "No aplica"]
);
export const TAX_COUNTRY = dict(
  ["do", "República Dominicana", "info"], ["mx", "México", "success"], ["co", "Colombia", "warning"],
  ["cr", "Costa Rica", "info"], ["pa", "Panamá", "violet"], ["us", "Estados Unidos"], ["es", "España", "warning"],
  ["other", "Otro"]
);

/* ---------------------------------------------------------------- equipo */
export const SHIFT_STATUS = dict(
  ["planned", "Planificado"], ["published", "Publicado", "info"], ["confirmed", "Confirmado", "info"],
  ["in_progress", "En curso", "warning"], ["completed", "Completado", "success"],
  ["no_show", "No asistió", "danger"], ["cancelled", "Cancelado"]
);
export const ATTENDANCE_STATUS = dict(
  ["present", "Presente", "success"], ["late", "Con retraso", "warning"], ["absent", "Ausente", "danger"],
  ["excused", "Justificado"], ["holiday", "Feriado", "info"], ["vacation", "Vacaciones", "info"],
  ["sick", "Enfermedad", "warning"]
);
export const ATTENDANCE_METHOD = dict(
  ["kiosk", "Kiosco", "info"], ["qr", "QR", "violet"], ["manual", "Manual"], ["biometric", "Biométrico", "info"],
  ["mobile", "Móvil", "success"]
);
export const CERT_STATUS = dict(
  ["valid", "Vigente", "success"], ["expiring", "Por vencer", "warning"], ["expired", "Vencida", "danger"],
  ["revoked", "Revocada"], ["pending", "Pendiente", "info"]
);
export const CERT_TYPE = dict(
  ["first_aid", "Primeros auxilios", "danger"], ["lifeguard", "Salvavidas", "info"],
  ["driving_license", "Licencia de conducir", "info"], ["ride_operator", "Operador de atracción", "violet"],
  ["food_handling", "Manipulación de alimentos", "warning"], ["guide_license", "Licencia de guía", "success"],
  ["language", "Idioma", "warning"], ["forklift", "Montacargas"], ["height_work", "Trabajo en altura"],
  ["other", "Otra"]
);

/* ------------------------------------------------------- administración */
export const TASK_STATUS = dict(
  ["todo", "Por hacer"], ["in_progress", "En curso", "info"], ["blocked", "Bloqueada", "danger"],
  ["waiting", "En espera", "warning"], ["done", "Hecha", "success"], ["cancelled", "Cancelada"]
);
export const TASK_TYPE = dict(
  ["general", "General"], ["follow_up", "Seguimiento", "info"], ["operational", "Operativa", "info"],
  ["maintenance", "Mantenimiento", "warning"], ["safety", "Seguridad", "danger"], ["finance", "Finanzas", "success"],
  ["sales", "Ventas", "violet"], ["onboarding", "Incorporación", "warning"]
);
export const DOC_TYPE = dict(
  ["sop", "Procedimiento", "info"], ["policy", "Política", "violet"], ["manual", "Manual", "info"],
  ["contract", "Contrato", "warning"], ["permit", "Permiso", "danger"], ["insurance", "Seguro", "warning"],
  ["certificate", "Certificado", "success"], ["emergency_plan", "Plan de emergencia", "danger"],
  ["menu", "Menú", "warning"], ["price_list", "Lista de precios", "success"], ["other", "Otro"]
);
export const DOC_STATUS = dict(
  ["draft", "Borrador", "warning"], ["published", "Publicado", "success"], ["archived", "Archivado"]
);
export const APPROVAL_ACTION = dict(
  ["discount_over_limit", "Descuento sobre el límite", "warning"], ["refund", "Reembolso", "danger"],
  ["void_sale", "Anulación de venta", "danger"], ["cash_adjustment", "Ajuste de caja", "warning"],
  ["price_change", "Cambio de precio", "violet"], ["commission_override", "Override de comisión", "violet"],
  ["clawback", "Clawback", "danger"], ["purchase_order", "Orden de compra", "info"],
  ["credit_note", "Nota de crédito", "warning"], ["capacity_override", "Override de aforo", "warning"],
  ["waiver_bypass", "Omisión de waiver", "danger"], ["payout", "Pago a la red", "success"],
  ["expense", "Gasto", "info"], ["schedule_change", "Cambio de programación"]
);
export const APPROVAL_STATUS = dict(
  ["pending", "Pendiente", "warning"], ["approved", "Aprobada", "success"], ["rejected", "Rechazada", "danger"],
  ["cancelled", "Cancelada"], ["expired", "Expirada"]
);
export const INTEGRATION_PROVIDER = dict(
  ["octo", "OCTO", "info"], ["viator", "Viator", "success"], ["getyourguide", "GetYourGuide", "warning"],
  ["expedia", "Expedia", "warning"], ["civitatis", "Civitatis", "violet"], ["tripadvisor", "Tripadvisor", "info"],
  ["stripe", "Stripe", "violet"], ["whatsapp", "WhatsApp", "success"], ["mailchimp", "Mailchimp", "warning"],
  ["quickbooks", "QuickBooks", "info"], ["dgii", "DGII", "danger"], ["google_calendar", "Google Calendar", "info"],
  ["zapier", "Zapier", "warning"], ["webhook", "Webhook"], ["custom", "Personalizada"]
);
export const INTEGRATION_STATUS = dict(
  ["connected", "Conectada", "success"], ["disconnected", "Desconectada"], ["error", "Con error", "danger"],
  ["pending", "Pendiente", "warning"], ["sandbox", "Pruebas", "info"]
);
export const INTEGRATION_CATEGORY = dict(
  ["distribution", "Distribución", "info"], ["payments", "Pagos", "success"], ["messaging", "Mensajería", "info"],
  ["accounting", "Contabilidad", "violet"], ["tax", "Fiscal", "danger"], ["marketing", "Marketing", "warning"],
  ["other", "Otra"]
);
export const SYNC_FREQUENCY = dict(
  ["realtime", "Tiempo real", "success"], ["every_5_min", "Cada 5 minutos", "info"], ["hourly", "Cada hora", "info"],
  ["daily", "Diaria", "warning"], ["manual", "Manual"]
);

export const BRANCH_TYPE = dict(
  ["park", "Parque", "success"], ["office", "Oficina", "info"], ["tour_center", "Tour center", "violet"],
  ["pos", "Punto de venta", "accent"], ["warehouse", "Almacén", "warning"], ["other", "Otra"]
);
export const PRICE_TYPE = dict(
  ["standard", "Estándar", "info"], ["per_person", "Por persona", "success"], ["per_group", "Por grupo", "violet"],
  ["per_vehicle", "Por vehículo", "warning"], ["b2c", "B2C", "accent"], ["b2b", "B2B", "info"]
);
export const COST_TYPE = dict(
  ["per_person", "Por persona", "info"], ["per_group", "Por grupo", "violet"],
  ["per_departure", "Por salida", "accent"], ["per_vehicle", "Por vehículo", "warning"],
  ["percentage", "Porcentaje", "success"], ["fixed", "Fijo"]
);
export const HOTEL_CATEGORY = dict(
  ["1_star", "1 estrella"], ["2_star", "2 estrellas"], ["3_star", "3 estrellas", "info"],
  ["4_star", "4 estrellas", "accent"], ["5_star", "5 estrellas", "success"],
  ["boutique", "Boutique", "violet"], ["apartment", "Apartamento", "warning"]
);
export const RESOURCE_ROLE = dict(
  ["guide", "Guía", "success"], ["driver", "Conductor", "info"], ["photographer", "Fotógrafo", "violet"],
  ["coordinator", "Coordinador", "accent"], ["vehicle", "Vehículo", "warning"], ["equipment", "Equipo"]
);
export const RESOURCE_STATUS = dict(
  ["planned", "Planificado", "info"], ["confirmed", "Confirmado", "success"],
  ["conflict", "En conflicto", "danger"], ["cancelled", "Cancelado"]
);
export const WEEKDAY = dict(
  ["mon", "Lunes", "info"], ["tue", "Martes", "info"], ["wed", "Miércoles", "info"],
  ["thu", "Jueves", "info"], ["fri", "Viernes", "info"],
  ["sat", "Sábado", "violet"], ["sun", "Domingo", "violet"]
);
export const NCF_TYPE = dict(
  ["b01", "B01 · Crédito fiscal", "info"], ["b02", "B02 · Consumidor final", "accent"],
  ["b04", "B04 · Nota de crédito", "warning"], ["b14", "B14 · Régimen especial", "violet"],
  ["b15", "B15 · Gubernamental"],
  ["e31", "e-CF 31 · Crédito fiscal", "info"], ["e32", "e-CF 32 · Consumo", "accent"],
  ["e34", "e-CF 34 · Nota de crédito", "warning"], ["e44", "e-CF 44 · Régimen especial", "violet"],
  ["e45", "e-CF 45 · Gubernamental"]
);
export const DELIVERY_CHANNEL = dict(
  ["email", "Email", "info"], ["print", "Impresa"], ["physical", "Física", "violet"],
  ["whatsapp", "WhatsApp", "success"]
);
export const DOC_AUDIENCE = dict(
  ["all", "Todos"], ["managers", "Gerencia", "info"], ["operations", "Operaciones", "accent"],
  ["guides", "Guías", "success"], ["drivers", "Conductores", "warning"],
  ["cashiers", "Cajeros", "violet"], ["maintenance", "Mantenimiento", "warning"],
  ["safety", "Seguridad", "danger"]
);
export const TASK_SOURCE = dict(
  ["manual", "Manual"], ["automatic", "Automática", "info"],
  ["escalation", "Escalamiento", "danger"], ["checklist", "Checklist", "accent"]
);

export const NOTIFICATION_TYPE = dict(
  ["info", "Informativa"], ["booking", "Reserva", "info"], ["payment", "Pago", "success"],
  ["operation", "Operación", "accent"], ["alert", "Alerta", "danger"], ["settlement", "Liquidación", "violet"]
);
export const ROUTE_STATUS = dict(
  ["planned", "Planificada", "info"], ["confirmed", "Confirmada", "accent"],
  ["in_progress", "En curso", "warning"], ["completed", "Completada", "success"],
  ["cancelled", "Cancelada", "danger"]
);

/** `[{value,label}]` list for a Select, from any of the dictionaries above. */
export function toOptions(source: Record<string, LabelDef>): { value: string; label: string }[] {
  return Object.entries(source).map(([value, def]) => ({ value, label: def.label }));
}
