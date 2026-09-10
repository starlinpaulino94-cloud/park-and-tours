"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CASE_CHANNEL, CASE_STATUS, CASE_TYPE, COMPENSATION_TYPE, PRIORITY } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="guest_case"
      eyebrow="Clientes"
      title="Casos y reclamos"
      description="Reclamos, quejas, objetos perdidos y solicitudes de los visitantes, con su compensación y resolución."
      emptyIcon="Headset"
      filters={[
        { name: "status", label: "Estado", dict: CASE_STATUS },
        { name: "case_type", label: "Tipo", dict: CASE_TYPE },
        { name: "priority", label: "Prioridad", dict: PRIORITY },
      ]}
      emptyTitle="Sin casos abiertos"
      emptyDescription="Quejas, reclamos y objetos perdidos, con su seguimiento y compensación."
      createLabel="Nuevo caso"
      fields={[
        { name: "subject", label: "Asunto", required: true },
        { name: "case_type", label: "Tipo", type: "select", defaultValue: "complaint", options: optionsFrom(CASE_TYPE) },
        { name: "priority", label: "Prioridad", type: "select", defaultValue: "medium", options: optionsFrom(PRIORITY) },
        { name: "status", label: "Estado", type: "select", defaultValue: "open", options: optionsFrom(CASE_STATUS) },
        { name: "channel", label: "Canal", type: "select", defaultValue: "counter", options: optionsFrom(CASE_CHANNEL) },
        { name: "customer", label: "Cliente", type: "reference", resource: "customer", optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email },
        { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id },
        { name: "assigned_to", label: "Responsable", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name || s.code },
        { name: "opened_at", label: "Abierto el", type: "datetime" },
        { name: "compensation_type", label: "Compensación", type: "select", defaultValue: "none", options: optionsFrom(COMPENSATION_TYPE) },
        { name: "compensation_amount", label: "Importe compensado", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "resolution", label: "Resolución", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "code", header: "Caso" },
        { key: "subject", header: "Asunto" },
        { key: "case_type", header: "Tipo", kind: "badge", dict: CASE_TYPE },
        { key: "status", header: "Estado", kind: "badge", dict: CASE_STATUS },
        { key: "priority", header: "Prioridad", kind: "badge", dict: PRIORITY },
        { key: "customer", header: "Cliente", kind: "ref", hideOn:"md" },
        { key: "opened_at", header: "Abierto", kind: "datetime" },
      ]}
    />
  );
}
