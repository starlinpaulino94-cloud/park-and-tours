"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { INCIDENT_SEVERITY, INCIDENT_STATUS, INCIDENT_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDateTime, formatMoney } from "@/lib/format";

export default function IncidentesPage() {
  return (
    <ResourcePage
      resource="incident"
      eyebrow="Seguridad"
      title="Incidentes"
      description="Accidentes, cuasi-accidentes y eventos de seguridad con severidad, causa raíz y acciones derivadas. Un incidente crítico puede cerrar una atracción."
      createLabel="Reportar incidente"
      emptyIcon="TriangleAlert"
      emptyTitle="Sin incidentes registrados"
      emptyDescription="Reportar cuasi-accidentes es lo que evita los accidentes. Registra todo evento relevante."
      initialSort="-occurred_at"
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(INCIDENT_STATUS) },
        { name: "severity", label: "Severidad", options: optionsFrom(INCIDENT_SEVERITY) },
        { name: "incident_type", label: "Tipo", options: optionsFrom(INCIDENT_TYPE) },
      ]}
      columns={[
        {
          key: "title", header: "Incidente",
          render: (i: any) => (
            <div>
              <p className="font-semibold">{i.title || i.code || "Sin título"}</p>
              <p className="text-xs text-muted-foreground">
                {[i.code, i.attraction?.name || i.zone?.name || i.location].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "sev", header: "Severidad", render: (i: any) => <StatusBadge value={i.severity} dict={INCIDENT_SEVERITY} /> },
        { key: "type", header: "Tipo", hideOn: "md", render: (i: any) => <StatusBadge value={i.incident_type} dict={INCIDENT_TYPE} dot={false} /> },
        { key: "when", header: "Ocurrió", hideOn: "sm", render: (i: any) => <span className="tf-num text-xs">{formatDateTime(i.occurred_at)}</span> },
        { key: "who", header: "Asignado", hideOn: "lg", render: (i: any) => <span className="text-xs">{i.assigned_to?.full_name || i.reported_by?.full_name || "Sin asignar"}</span> },
        { key: "cost", header: "Costo", align: "right", hideOn: "lg", render: (i: any) => formatMoney(i.estimated_cost, i.currency || "usd") },
        { key: "status", header: "Estado", render: (i: any) => <StatusBadge value={i.status} dict={INCIDENT_STATUS} /> },
      ]}
      fields={[
        { name: "title", label: "Título", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "incident_type", label: "Tipo", type: "select", defaultValue: "near_miss", options: optionsFrom(INCIDENT_TYPE) },
        { name: "severity", label: "Severidad", type: "select", defaultValue: "minor", options: optionsFrom(INCIDENT_SEVERITY) },
        { name: "status", label: "Estado", type: "select", defaultValue: "open", options: optionsFrom(INCIDENT_STATUS) },
        { name: "occurred_at", label: "Ocurrió", type: "datetime", required: true },
        { name: "reported_at", label: "Reportado", type: "datetime" },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "asset", label: "Activo", type: "reference", resource: "asset" },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "reported_by", label: "Reportado por", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "assigned_to", label: "Asignado a", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id },
        { name: "location", label: "Ubicación exacta" },
        { name: "medical_attention", label: "Atención médica", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "evacuation", label: "Evacuación", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "authority_notified", label: "Autoridad notificada", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "insurance_claim", label: "Reclamo a seguro", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "estimated_cost", label: "Costo estimado", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "description", label: "Descripción", type: "textarea", span: 2, required: true },
        { name: "immediate_action", label: "Acción inmediata", type: "textarea", span: 2 },
        { name: "root_cause", label: "Causa raíz", type: "textarea", span: 2 },
        { name: "witnesses", label: "Testigos", type: "textarea", span: 2 },
      ]}
    />
  );
}
