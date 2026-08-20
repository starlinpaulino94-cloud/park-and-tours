"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { WAIVER_CHANNEL, WAIVER_STATUS } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDate, formatDateTime } from "@/lib/format";

export default function WaiversPage() {
  return (
    <ResourcePage
      resource="waiver"
      eyebrow="Seguridad"
      title="Waivers firmados"
      description="Cada waiver guarda una copia congelada del texto legal que la persona aceptó, con su versión y fecha. Es la evidencia que vale ante un reclamo."
      createLabel="Registrar waiver"
      emptyIcon="FileCheck"
      emptyTitle="Sin waivers firmados"
      emptyDescription="Los waivers se firman en el kiosco, en línea o en mostrador antes del acceso o el abordaje."
      initialSort="-signed_at"
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(WAIVER_STATUS) },
        { name: "channel", label: "Canal", options: optionsFrom(WAIVER_CHANNEL) },
      ]}
      columns={[
        {
          key: "who", header: "Firmante",
          render: (w: any) => (
            <div>
              <p className="font-semibold">
                {w.signature_name || `${w.customer?.first_name || ""} ${w.customer?.last_name || ""}`.trim() || "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {[w.document_id, w.guardian_name ? `tutor: ${w.guardian_name}` : null].filter(Boolean).join(" · ") || "Sin documento"}
              </p>
            </div>
          ),
        },
        {
          key: "template", header: "Plantilla", hideOn: "md",
          render: (w: any) => (
            <span className="text-xs">
              {w.waiver_template?.name || "—"}
              {w.template_version && <span className="tf-num text-muted-foreground"> v{w.template_version}</span>}
            </span>
          ),
        },
        { key: "signed", header: "Firmado", render: (w: any) => <span className="tf-num text-xs">{formatDateTime(w.signed_at)}</span> },
        { key: "valid", header: "Vigente hasta", hideOn: "sm", render: (w: any) => <span className="tf-num text-xs">{w.valid_until ? formatDate(w.valid_until) : "Sin límite"}</span> },
        { key: "channel", header: "Canal", hideOn: "lg", render: (w: any) => <StatusBadge value={w.channel} dict={WAIVER_CHANNEL} dot={false} /> },
        { key: "status", header: "Estado", render: (w: any) => <StatusBadge value={w.status} dict={WAIVER_STATUS} /> },
      ]}
      fields={[
        { name: "signature_name", label: "Nombre de quien firma", required: true, span: 2 },
        { name: "waiver_template", label: "Plantilla", type: "reference", resource: "waiver_template", required: true },
        { name: "template_version", label: "Versión aceptada", help: "Se congela en el momento de la firma." },
        { name: "customer", label: "Cliente", type: "reference", resource: "customer",
          optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || c._id },
        { name: "participant", label: "Participante", type: "reference", resource: "participant",
          optionLabel: (p: any) => p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || p._id },
        { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id },
        { name: "product", label: "Producto", type: "reference", resource: "product" },
        { name: "document_id", label: "Documento de identidad" },
        { name: "document_type", label: "Tipo de documento", type: "select", defaultValue: "id_card",
          options: [
            { value: "passport", label: "Pasaporte" }, { value: "id_card", label: "Cédula" },
            { value: "driver_license", label: "Licencia" }, { value: "minor_id", label: "Documento de menor" },
          ] },
        { name: "guardian_name", label: "Tutor (si es menor)" },
        { name: "guardian_document", label: "Documento del tutor" },
        { name: "signed_at", label: "Firmado", type: "datetime", required: true },
        { name: "valid_until", label: "Vigente hasta", type: "date" },
        { name: "channel", label: "Canal", type: "select", defaultValue: "counter", options: optionsFrom(WAIVER_CHANNEL) },
        { name: "status", label: "Estado", type: "select", defaultValue: "signed", options: optionsFrom(WAIVER_STATUS) },
        { name: "health_flags", label: "Declaraciones de salud", type: "textarea", span: 2 },
        { name: "body_snapshot", label: "Texto aceptado (copia congelada)", type: "textarea", span: 2,
          help: "No se debe editar: es la evidencia de lo que la persona aceptó." },
      ]}
    />
  );
}
