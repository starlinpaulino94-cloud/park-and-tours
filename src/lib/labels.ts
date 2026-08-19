/**
 * Spanish labels + colour tokens for every enum used across the ERP.
 * Keeping them in one place guarantees the same wording in every screen.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "violet";

export interface LabelDef {
  label: string;
  tone: Tone;
}

const def = (label: string, tone: Tone = "neutral"): LabelDef => ({ label, tone });

export const BOOKING_STATUS: Record<string, LabelDef> = {
  draft: def("Borrador"),
  pending: def("Pendiente", "warning"),
  pending_payment: def("Pendiente de pago", "warning"),
  confirmed: def("Confirmada", "info"),
  partially_paid: def("Parcialmente pagada", "accent"),
  paid: def("Pagada", "success"),
  checked_in: def("Check-in realizado", "violet"),
  no_show: def("No-show", "danger"),
  completed: def("Completada", "success"),
  cancelled: def("Cancelada", "danger"),
  refunded: def("Reembolsada", "danger"),
  partially_refunded: def("Parcialmente reembolsada", "warning"),
};

export const ORDER_STATUS: Record<string, LabelDef> = {
  draft: def("Borrador"),
  pending: def("Pendiente", "warning"),
  pending_payment: def("Pendiente de pago", "warning"),
  confirmed: def("Confirmada", "info"),
  partially_paid: def("Parcialmente pagada", "accent"),
  paid: def("Pagada", "success"),
  completed: def("Completada", "success"),
  cancelled: def("Cancelada", "danger"),
  refunded: def("Reembolsada", "danger"),
};

export const DEPARTURE_STATUS: Record<string, LabelDef> = {
  available: def("Disponible", "success"),
  almost_full: def("Próximo a llenarse", "warning"),
  full: def("Lleno", "danger"),
  closed: def("Cerrada", "neutral"),
  cancelled: def("Cancelada", "danger"),
  completed: def("Completada", "info"),
};

export const PAYMENT_METHOD: Record<string, LabelDef> = {
  cash: def("Efectivo", "success"),
  card: def("Tarjeta", "info"),
  transfer: def("Transferencia", "violet"),
  payment_link: def("Link de pago", "accent"),
  deposit: def("Depósito", "info"),
  b2b_credit: def("Crédito B2B", "warning"),
  mixed: def("Mixto", "neutral"),
  other: def("Otro", "neutral"),
};

export const PAYMENT_STATUS: Record<string, LabelDef> = {
  pending: def("Pendiente", "warning"),
  authorized: def("Autorizado", "info"),
  completed: def("Completado", "success"),
  rejected: def("Rechazado", "danger"),
  cancelled: def("Cancelado", "neutral"),
  refunded: def("Reembolsado", "danger"),
  partially_refunded: def("Parcialmente reembolsado", "warning"),
};

export const COMMISSION_STATUS: Record<string, LabelDef> = {
  pending: def("Pendiente", "warning"),
  approved: def("Aprobada", "info"),
  settled: def("Liquidada", "violet"),
  paid: def("Pagada", "success"),
  cancelled: def("Cancelada", "neutral"),
  held: def("Retenida", "danger"),
  disputed: def("En disputa", "danger"),
};

export const SETTLEMENT_STATUS: Record<string, LabelDef> = {
  pending: def("Pendiente", "warning"),
  approved: def("Aprobada", "info"),
  partially_paid: def("Parcialmente pagada", "accent"),
  paid: def("Pagada", "success"),
  held: def("Retenida", "danger"),
  disputed: def("En disputa", "danger"),
};

export const LEAD_STATUS: Record<string, LabelDef> = {
  new: def("Nuevo", "info"),
  contacted: def("Contactado", "accent"),
  interested: def("Interesado", "violet"),
  quoted: def("Cotización enviada", "warning"),
  follow_up: def("Seguimiento", "warning"),
  booked: def("Reservado", "success"),
  lost: def("Perdido", "danger"),
};

export const CHANNEL: Record<string, LabelDef> = {
  direct: def("Directo", "info"),
  web: def("Web", "violet"),
  phone: def("Teléfono", "neutral"),
  whatsapp: def("WhatsApp", "success"),
  walk_in: def("Walk-in", "accent"),
  b2b_portal: def("Portal B2B", "violet"),
  agency: def("Agencia", "warning"),
  tour_center: def("Tour Center", "accent"),
  ota: def("OTA", "info"),
  pos: def("Punto de venta", "neutral"),
};

export const PARTNER_TYPE: Record<string, LabelDef> = {
  tour_center: def("Tour Center", "accent"),
  agency: def("Agencia", "warning"),
  subagency: def("Subagencia", "neutral"),
  tour_operator: def("Tour Operator", "violet"),
  hotel: def("Hotel", "info"),
  ota: def("OTA", "info"),
  reseller: def("Revendedor", "neutral"),
};

export const COMPANY_TYPE: Record<string, LabelDef> = {
  park: def("Parque turístico", "success"),
  excursion_company: def("Empresa de excursiones", "accent"),
  tour_operator: def("Tour Operator", "violet"),
  tour_center: def("Tour Center", "warning"),
  agency: def("Agencia", "info"),
  transport: def("Transporte turístico", "neutral"),
  mixed_operator: def("Operador mixto", "violet"),
  other: def("Otro", "neutral"),
};

export const PRODUCT_TYPE: Record<string, LabelDef> = {
  excursion: def("Excursión", "success"),
  ticket: def("Entrada", "accent"),
  transport: def("Transporte", "info"),
  package: def("Paquete", "violet"),
  activity: def("Actividad", "warning"),
  rental: def("Alquiler", "neutral"),
};

export const MODALITY_TYPE: Record<string, LabelDef> = {
  adult: def("Adulto"),
  child: def("Niño"),
  infant: def("Infante"),
  resident: def("Residente"),
  foreigner: def("Extranjero"),
  private: def("Privado", "violet"),
  vip: def("VIP", "accent"),
  group: def("Grupo"),
  vehicle: def("Vehículo"),
  couple: def("Pareja"),
};

export const CHECKIN_STATUS: Record<string, LabelDef> = {
  pending: def("Pendiente", "warning"),
  partial: def("Parcial", "accent"),
  done: def("Realizado", "success"),
  no_show: def("No-show", "danger"),
};

export const VOUCHER_STATUS: Record<string, LabelDef> = {
  valid: def("Válido", "success"),
  used: def("Utilizado", "info"),
  cancelled: def("Cancelado", "danger"),
  expired: def("Expirado", "neutral"),
};

export const AGING_BUCKET: Record<string, LabelDef> = {
  current: def("Corriente", "success"),
  d1_30: def("1–30 días", "info"),
  d31_60: def("31–60 días", "warning"),
  d61_90: def("61–90 días", "accent"),
  d90_plus: def("+90 días", "danger"),
};

export const GENERIC_STATUS: Record<string, LabelDef> = {
  active: def("Activo", "success"),
  inactive: def("Inactivo", "neutral"),
  suspended: def("Suspendido", "danger"),
  blocked: def("Bloqueado", "danger"),
  pending: def("Pendiente", "warning"),
  approved: def("Aprobado", "info"),
  paid: def("Pagado", "success"),
  rejected: def("Rechazado", "danger"),
  cancelled: def("Cancelado", "neutral"),
  draft: def("Borrador", "neutral"),
  seasonal: def("Temporada", "accent"),
  open: def("Abierta", "success"),
  closed: def("Cerrada", "neutral"),
  reconciled: def("Cuadrada", "info"),
  available: def("Disponible", "success"),
  in_service: def("En servicio", "info"),
  maintenance: def("Mantenimiento", "warning"),
  out_of_service: def("Fuera de servicio", "danger"),
  unavailable: def("No disponible", "warning"),
  planned: def("Planificado", "info"),
  confirmed: def("Confirmado", "success"),
  conflict: def("Conflicto", "danger"),
  in_progress: def("En curso", "accent"),
  completed: def("Completado", "success"),
  overdue: def("Vencido", "danger"),
  partially_paid: def("Parcial", "accent"),
  written_off: def("Incobrable", "neutral"),
  trial: def("Prueba", "warning"),
  past_due: def("Vencida", "danger"),
  picked_up: def("Recogido", "success"),
  no_show: def("No-show", "danger"),
  done: def("Hecho", "success"),
  held: def("Retenida", "danger"),
  disputed: def("En disputa", "danger"),
  expired: def("Expirado", "neutral"),
  failed: def("Fallido", "danger"),
  refunded: def("Reembolsado", "danger"),
};

export const SELLER_ROLE: Record<string, LabelDef> = {
  seller: def("Vendedor"),
  supervisor: def("Supervisor", "violet"),
  manager: def("Gerente", "accent"),
  promoter: def("Promotor", "info"),
  agent: def("Agente", "neutral"),
};

export const STAFF_TYPE: Record<string, LabelDef> = {
  guide: def("Guía", "success"),
  driver: def("Conductor", "info"),
  photographer: def("Fotógrafo", "violet"),
  coordinator: def("Coordinador", "accent"),
  external: def("Externo", "neutral"),
};

export const VEHICLE_TYPE: Record<string, LabelDef> = {
  bus: def("Autobús"),
  minibus: def("Minibús"),
  van: def("Van"),
  suv_4x4: def("4x4"),
  boat: def("Barco"),
  catamaran: def("Catamarán"),
  buggy: def("Buggy"),
  other: def("Otro"),
};

export const SUPPLIER_TYPE: Record<string, LabelDef> = {
  transport: def("Transporte"),
  restaurant: def("Restaurante"),
  boat: def("Embarcación"),
  park: def("Parque"),
  guide: def("Guías"),
  hotel: def("Hotel"),
  equipment: def("Equipos"),
  other: def("Otro"),
};

export const BENEFICIARY_TYPE: Record<string, LabelDef> = {
  seller: def("Vendedor", "info"),
  supervisor: def("Supervisor", "violet"),
  partner: def("Partner", "accent"),
  guide: def("Guía", "success"),
  supplier: def("Proveedor", "neutral"),
};

export const CALC_TYPE: Record<string, LabelDef> = {
  percentage: def("Porcentaje", "info"),
  fixed: def("Monto fijo", "accent"),
  tiered: def("Escalonado", "violet"),
  volume: def("Por volumen", "warning"),
};

export const ACTIVITY_TYPE: Record<string, LabelDef> = {
  call: def("Llamada", "info"),
  whatsapp: def("WhatsApp", "success"),
  email: def("Email", "violet"),
  sms: def("SMS", "accent"),
  note: def("Nota", "neutral"),
  task: def("Tarea", "warning"),
  meeting: def("Reunión", "info"),
};

export const EXPENSE_METHOD: Record<string, LabelDef> = {
  cash: def("Efectivo"),
  card: def("Tarjeta"),
  transfer: def("Transferencia"),
  credit: def("Crédito"),
  other: def("Otro"),
};

export const LANGUAGE: Record<string, LabelDef> = {
  es: def("Español"), en: def("Inglés"), fr: def("Francés"),
  de: def("Alemán"), it: def("Italiano"), pt: def("Portugués"), ru: def("Ruso"),
};

export const MODULE_LABEL: Record<string, string> = {
  bookings: "Reservas", crm: "CRM", commissions: "Comisiones",
  settlements: "Liquidaciones", payments: "Pagos", cash_pos: "Caja y POS",
  transport: "Transporte", pickups: "Pickups", operations: "Operaciones",
  b2b_portal: "Portal B2B", accounting: "Contabilidad", reports: "Reportes", audit: "Auditoría",
};

/** Resolves a label from a dictionary, falling back to a humanised key. */
export function labelOf(dict: Record<string, LabelDef>, key?: string | null): LabelDef {
  if (!key) return def("—");
  return dict[key] ?? GENERIC_STATUS[key] ?? def(key.replace(/_/g, " "));
}
