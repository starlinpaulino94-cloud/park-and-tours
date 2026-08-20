"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { ACTION_STATUS, PRIORITY } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDate, relativeDay } from "@/lib/format";

export default function AccionesPage() {
  return (
    <ResourcePage
      resource="incident_action"
      eyebrow="Seguridad"
      title="Acciones correctivas"
      description="Las acciones que cierran el ciclo de un incidente: responsable, vencimiento y verificación independiente. Sin acción verificada, el incidente no se cierra."
      createLabel="Nueva acción"
      emptyIcon="ListChecks"
      emptyTitle="Sin acciones pendientes"
      emptyDescription="Las acciones se crean desde un incidente para asegurar que la causa raíz se corrige."
      initialSort="due_date"
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(ACTION_STATUS) },
        { name: "priority", label: "Prioridad", options: optionsFrom(PRIORITY) },
      ]}
      columns={[
        {
          key: "action", header: "Acción",
          render: (a: any) => (
            <div>
              <p className="font-semibold">{a.action}</p>
              <p className="text-xs text-muted-foreground">{a.incident?.title || a.incident?.code || "Sin incidente"}</p>
            </div>
          ),
        },
        { key: "prio", header: "Prioridad", render: (a: any) => <StatusBadge value={a.priority} dict={PRIORITY} /> },
        {
          key: "due", header: "Vence", hideOn: "sm",
          render: (a: any) => {
            const overdue = a.due_date && new Date(a.due_date) < new Date() && !["done", "verified", "cancelled"].includes(a.status);
            return (
              <span className={`tf-num text-xs ${overdue ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                {a.due_date ? `${formatDate(a.due_date)} · ${relativeDay(a.due_date)}` : "—"}
              </span>
            );
          },
        },
        { key: "who", header: "Responsable", hideOn: "md", render: (a: any) => <span className="text-xs">{a.assigned_to?.full_name || "Sin asignar"}</span> },
        { key: "status", header: "Estado", render: (a: any) => <StatusBadge value={a.status} dict={ACTION_STATUS} /> },
      ]}
      fields={[
        { name: "action", label: "Acción", required: true, span: 2 },
        { name: "incident", label: "Incidente", type: "reference", resource: "incident", optionLabel: (i: any) => i.title || i.code || i._id },
        { name: "assigned_to", label: "Responsable", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "priority", label: "Prioridad", type: "select", defaultValue: "medium", options: optionsFrom(PRIORITY) },
        { name: "status", label: "Estado", type: "select", defaultValue: "pending", options: optionsFrom(ACTION_STATUS) },
        { name: "due_date", label: "Vence", type: "date" },
        { name: "completed_at", label: "Completada", type: "datetime" },
        { name: "description", label: "Detalle", type: "textarea", span: 2 },
        { name: "verification_notes", label: "Notas de verificación", type: "textarea", span: 2 },
      ]}
    />
  );
}
