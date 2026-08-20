"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { INSPECTION_RESULT, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDateTime, formatNumber } from "@/lib/format";

export default function InspeccionesPage() {
  return (
    <ResourcePage
      resource="inspection"
      eyebrow="Seguridad"
      title="Inspecciones"
      description="Resultado de cada inspección ejecutada. Una inspección fallida en un checklist bloqueante impide abrir la atracción o despachar el vehículo."
      createLabel="Registrar inspección"
      emptyIcon="SearchCheck"
      emptyTitle="Sin inspecciones registradas"
      emptyDescription="Ejecuta las inspecciones de pre-apertura para dejar evidencia del estado con que abriste."
      initialSort="-performed_at"
      filters={[{ name: "result", label: "Resultado", options: optionsFrom(INSPECTION_RESULT) }]}
      columns={[
        {
          key: "what", header: "Inspección",
          render: (i: any) => (
            <div>
              <p className="font-semibold">{i.inspection_template?.name || "Inspección"}</p>
              <p className="text-xs text-muted-foreground">
                {i.attraction?.name || i.asset?.name || i.vehicle?.name || "General"}
              </p>
            </div>
          ),
        },
        { key: "result", header: "Resultado", render: (i: any) => <StatusBadge value={i.result} dict={INSPECTION_RESULT} /> },
        {
          key: "score", header: "Ítems", align: "right", hideOn: "sm",
          render: (i: any) => (
            <span className="tf-num">
              {formatNumber((i.items_total || 0) - (i.items_failed || 0))}
              <span className="text-muted-foreground">/{formatNumber(i.items_total)}</span>
            </span>
          ),
        },
        { key: "when", header: "Realizada", hideOn: "sm", render: (i: any) => <span className="tf-num text-xs">{formatDateTime(i.performed_at)}</span> },
        { key: "who", header: "Por", hideOn: "md", render: (i: any) => <span className="text-xs">{i.performed_by?.full_name || i.signature_name || "—"}</span> },
        { key: "blocked", header: "Bloqueó", hideOn: "lg", render: (i: any) => <StatusBadge value={i.blocked_operation} dict={YES_NO} dot={false} /> },
      ]}
      fields={[
        { name: "inspection_template", label: "Plantilla", type: "reference", resource: "inspection_template", required: true, span: 2 },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "asset", label: "Activo", type: "reference", resource: "asset" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "performed_by", label: "Realizada por", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "performed_at", label: "Realizada", type: "datetime", required: true },
        { name: "result", label: "Resultado", type: "select", defaultValue: "pass", options: optionsFrom(INSPECTION_RESULT) },
        { name: "items_total", label: "Ítems totales", type: "number" },
        { name: "items_failed", label: "Ítems fallidos", type: "number" },
        { name: "score", label: "Puntaje", type: "number", suffix: "%" },
        { name: "blocked_operation", label: "Bloqueó la operación", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "next_due_at", label: "Próxima inspección", type: "datetime" },
        { name: "signature_name", label: "Firmado por" },
        { name: "findings", label: "Hallazgos", type: "textarea", span: 2 },
      ]}
    />
  );
}
