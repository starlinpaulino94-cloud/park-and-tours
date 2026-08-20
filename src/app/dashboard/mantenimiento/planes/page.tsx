"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { TRIGGER_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDate, formatNumber, relativeDay } from "@/lib/format";

export default function PlanesPreventivosPage() {
  return (
    <ResourcePage
      resource="maintenance_plan"
      eyebrow="Mantenimiento"
      title="Planes preventivos"
      description="Disparadores por calendario, horómetro, kilometraje o uso. El preventivo cumplido es lo que evita el correctivo en plena temporada."
      createLabel="Nuevo plan"
      emptyIcon="CalendarClock"
      emptyTitle="Sin planes preventivos"
      emptyDescription="Define los preventivos de tus activos críticos para adelantarte a las fallas."
      initialSort="next_due_at"
      filters={[{ name: "trigger_type", label: "Disparador", options: optionsFrom(TRIGGER_TYPE) }]}
      columns={[
        {
          key: "name", header: "Plan",
          render: (p: any) => (
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-muted-foreground">
                {p.asset?.name || p.attraction?.name || p.vehicle?.name || "General"}
              </p>
            </div>
          ),
        },
        { key: "trig", header: "Disparador", render: (p: any) => <StatusBadge value={p.trigger_type} dict={TRIGGER_TYPE} dot={false} /> },
        {
          key: "interval", header: "Intervalo", align: "right", hideOn: "sm",
          render: (p: any) => (
            <span className="tf-num text-xs">
              {p.interval_days ? `${formatNumber(p.interval_days)} días`
                : p.interval_hours ? `${formatNumber(p.interval_hours)} h`
                : p.interval_km ? `${formatNumber(p.interval_km)} km` : "—"}
            </span>
          ),
        },
        {
          key: "next", header: "Próximo",
          render: (p: any) => {
            const overdue = p.next_due_at && new Date(p.next_due_at) < new Date();
            return (
              <span className={`tf-num text-xs ${overdue ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
                {p.next_due_at ? `${formatDate(p.next_due_at)} · ${relativeDay(p.next_due_at)}` : "Sin programar"}
              </span>
            );
          },
        },
        { key: "down", header: "Baja activo", hideOn: "lg", render: (p: any) => <StatusBadge value={p.takes_asset_down} dict={YES_NO} dot={false} /> },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "trigger_type", label: "Disparador", type: "select", defaultValue: "calendar", options: optionsFrom(TRIGGER_TYPE) },
        { name: "asset", label: "Activo", type: "reference", resource: "asset" },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "inspection_template", label: "Checklist asociado", type: "reference", resource: "inspection_template" },
        { name: "staff", label: "Responsable", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "interval_days", label: "Intervalo (días)", type: "number" },
        { name: "interval_hours", label: "Intervalo (horas)", type: "number" },
        { name: "interval_km", label: "Intervalo (km)", type: "number" },
        { name: "lead_time_days", label: "Anticipación", type: "number", suffix: "días" },
        { name: "estimated_min", label: "Duración estimada", type: "number", suffix: "min" },
        { name: "estimated_cost", label: "Costo estimado", type: "number" },
        { name: "last_executed_at", label: "Última ejecución", type: "datetime" },
        { name: "next_due_at", label: "Próximo vencimiento", type: "datetime" },
        { name: "takes_asset_down", label: "Baja el activo", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
        { name: "task_list", label: "Tareas (una por línea)", type: "textarea", span: 2 },
      ]}
    />
  );
}
