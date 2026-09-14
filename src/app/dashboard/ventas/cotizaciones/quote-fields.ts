import type { FieldDef } from "@/components/tf/resource-form";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { QUOTE_TYPE, DEPOSIT_TYPE } from "@/lib/labels-modules";

/**
 * La cabecera de una cotización, completa.
 *
 * El formulario anterior pedía seis cosas —tipo, moneda, pax, dos fechas y unas
 * "condiciones" de una línea— y con eso no se puede mandar una propuesta a nadie:
 * faltaba a quién va dirigida, cuánto anticipo se pide y cuándo, qué incluye y
 * qué no, y qué pasa si el grupo cancela. Cada bloque de abajo es un bloque del
 * documento que el cliente lee, y por eso se comparte entre el alta y la edición:
 * una propuesta no se "completa después" en otra pantalla.
 */
export const QUOTE_FIELDS: FieldDef[] = [
  // ── identidad ───────────────────────────────────────────────────────────
  { name: "title", label: "Título de la propuesta", span: 2, required: true,
    placeholder: "Colegio San Juan — 3 días Punta Cana",
    help: "Es como la reconocen el vendedor y el cliente en el asunto del correo." },
  { name: "quote_type", label: "Tipo", type: "select", options: optionsFrom(QUOTE_TYPE), defaultValue: "group" },
  { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS, defaultValue: "usd" },

  // ── con quién se negocia ────────────────────────────────────────────────
  { name: "customer", label: "Cliente", type: "reference", resource: "customer",
    optionLabel: (r: any) => [r.first_name, r.last_name].filter(Boolean).join(" ") || r.commercial_name || r.name,
    help: "Necesario para convertirla en reserva; si todavía no existe, basta el contacto." },
  { name: "seller", label: "Vendedor", type: "reference", resource: "seller",
    optionLabel: (r: any) => [r.first_name, r.last_name].filter(Boolean).join(" ") },
  { name: "company_name", label: "Empresa o institución", placeholder: "Colegio San Juan" },
  { name: "contact_name", label: "Persona de contacto", placeholder: "Coordinadora del viaje" },
  { name: "contact_email", label: "Correo del contacto", type: "email" },
  { name: "contact_phone", label: "Teléfono del contacto", type: "phone" },
  { name: "partner", label: "Agencia o partner", type: "reference", resource: "partner",
    optionLabel: (r: any) => r.commercial_name || r.name },
  { name: "lead", label: "Oportunidad del CRM", type: "reference", resource: "lead",
    optionLabel: (r: any) => r.title || r.contact_name || r.code },

  // ── el viaje ────────────────────────────────────────────────────────────
  { name: "pax", label: "Pasajeros estimados", type: "number" },
  { name: "event_date", label: "Fecha del viaje o evento", type: "date" },
  { name: "valid_until", label: "Vigente hasta", type: "date",
    help: "Sin plazo no se puede enviar: una propuesta sin fecha no se sostiene." },
  { name: "follow_up_at", label: "Próximo seguimiento", type: "date",
    help: "Aparece en la cola de seguimiento del vendedor." },

  // ── dinero ──────────────────────────────────────────────────────────────
  { name: "tax_percent", label: "Impuesto", type: "number", suffix: "%",
    help: "En República Dominicana el ITBIS es 18%. Se aplica sobre la base, después del descuento." },
  { name: "deposit_type", label: "Anticipo", type: "select", options: optionsFrom(DEPOSIT_TYPE), defaultValue: "none" },
  { name: "deposit_percent", label: "Anticipo (%)", type: "number", suffix: "%",
    help: "Entre 0 y 100. Lo habitual en grupos es entre el 20% y el 50%." },
  { name: "deposit_amount", label: "Anticipo (importe)", type: "number" },
  { name: "deposit_due_date", label: "Anticipo a pagar antes del", type: "date" },
  { name: "balance_due_date", label: "Saldo a pagar antes del", type: "date" },

  // ── el documento ────────────────────────────────────────────────────────
  { name: "inclusions", label: "Qué incluye", type: "textarea", span: 2,
    placeholder: "Transporte ida y vuelta · Guía en español · Almuerzo · Entradas" },
  { name: "exclusions", label: "Qué NO incluye", type: "textarea", span: 2,
    placeholder: "Bebidas alcohólicas · Propinas · Gastos personales",
    help: "Es el bloque que evita la mitad de las reclamaciones." },
  { name: "cancellation_policy", label: "Política de cancelación", type: "textarea", span: 2,
    placeholder: "Sin cargo hasta 15 días antes · 50% entre 14 y 7 días · sin reembolso después" },
  { name: "payment_terms", label: "Forma de pago", type: "textarea", span: 2,
    placeholder: "Anticipo por transferencia · saldo a la llegada · se acepta tarjeta" },
  { name: "terms", label: "Otras condiciones", type: "textarea", span: 2 },
  { name: "notes", label: "Notas para el cliente", type: "textarea", span: 2 },
  { name: "internal_notes", label: "Notas internas", type: "textarea", span: 2,
    help: "No salen en el documento del cliente: coste del proveedor, margen negociable, histórico de la llamada." },
];
