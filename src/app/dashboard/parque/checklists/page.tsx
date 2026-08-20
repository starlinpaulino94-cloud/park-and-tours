"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { INSPECTION_CATEGORY, INSPECTION_FREQUENCY, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatNumber } from "@/lib/format";

export default function ChecklistsPage() {
  return (
    <ResourcePage
      resource="inspection_template"
      eyebrow="Seguridad"
      title="Checklists de inspección"
      description="Plantillas de inspección con su frecuencia y su criterio de bloqueo. Marcar una plantilla como bloqueante es lo que convierte el checklist en un control real."
      createLabel="Nuevo checklist"
      emptyIcon="ClipboardCheck"
      emptyTitle="Sin checklists definidos"
      emptyDescription="Define al menos el checklist de pre-apertura de cada atracción y la revisión diaria de vehículos."
      filters={[
        { name: "frequency", label: "Frecuencia", options: optionsFrom(INSPECTION_FREQUENCY) },
        { name: "category", label: "Categoría", options: optionsFrom(INSPECTION_CATEGORY) },
      ]}
      columns={[
        {
          key: "name", header: "Checklist",
          render: (t: any) => (
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {t.code || t.attraction?.name || t.asset?.name || "General"}
              </p>
            </div>
          ),
        },
        { key: "freq", header: "Frecuencia", render: (t: any) => <StatusBadge value={t.frequency} dict={INSPECTION_FREQUENCY} dot={false} /> },
        { key: "cat", header: "Categoría", hideOn: "md", render: (t: any) => <StatusBadge value={t.category} dict={INSPECTION_CATEGORY} dot={false} /> },
        { key: "thr", header: "Umbral", align: "right", hideOn: "sm", render: (t: any) => <span className="tf-num">{formatNumber(t.pass_threshold)}%</span> },
        { key: "blocks", header: "Bloquea", render: (t: any) => <StatusBadge value={t.blocks_operation_on_fail} dict={YES_NO} dot={false} /> },
        { key: "status", header: "Estado", render: (t: any) => <StatusBadge value={t.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "frequency", label: "Frecuencia", type: "select", defaultValue: "daily", options: optionsFrom(INSPECTION_FREQUENCY) },
        { name: "category", label: "Categoría", type: "select", defaultValue: "safety", options: optionsFrom(INSPECTION_CATEGORY) },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "asset", label: "Activo", type: "reference", resource: "asset" },
        { name: "pass_threshold", label: "Umbral de aprobación", type: "number", suffix: "%" },
        { name: "estimated_min", label: "Duración estimada", type: "number", suffix: "min" },
        { name: "requires_signature", label: "Requiere firma", type: "select", defaultValue: "yes", options: optionsFrom(YES_NO) },
        { name: "blocks_operation_on_fail", label: "Bloquea operación si falla", type: "select", defaultValue: "yes", options: optionsFrom(YES_NO),
          help: "Si es Sí, un resultado fallido impide abrir la atracción o despachar el recurso." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
        { name: "checklist", label: "Ítems (uno por línea)", type: "textarea", span: 2,
          help: "Cada línea es un punto a verificar." },
      ]}
    />
  );
}
