"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { PRIORITY, WORK_ORDER_STATUS, WORK_ORDER_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";

export default function OrdenesTrabajoPage() {
  return (
    <ResourcePage
      resource="work_order"
      eyebrow="Mantenimiento"
      title="Órdenes de trabajo"
      description="Correctivo, preventivo y emergencias con su costo real y su downtime. Si la orden baja el activo, el sistema lo refleja en la capacidad vendible."
      createLabel="Nueva orden"
      emptyIcon="Wrench"
      emptyTitle="Sin órdenes de trabajo"
      emptyDescription="Abre una orden cuando un activo requiera intervención, o deja que los planes preventivos las generen."
      initialSort="-opened_at"
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(WORK_ORDER_STATUS) },
        { name: "order_type", label: "Tipo", options: optionsFrom(WORK_ORDER_TYPE) },
        { name: "priority", label: "Prioridad", options: optionsFrom(PRIORITY) },
      ]}
      columns={[
        {
          key: "title", header: "Orden",
          render: (w: any) => (
            <div>
              <p className="font-semibold">{w.title || w.code}</p>
              <p className="text-xs text-muted-foreground">
                {[w.code, w.asset?.name || w.attraction?.name || w.vehicle?.name].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (w: any) => <StatusBadge value={w.order_type} dict={WORK_ORDER_TYPE} dot={false} /> },
        { key: "prio", header: "Prioridad", render: (w: any) => <StatusBadge value={w.priority} dict={PRIORITY} /> },
        { key: "status", header: "Estado", render: (w: any) => <StatusBadge value={w.status} dict={WORK_ORDER_STATUS} /> },
        { key: "who", header: "Asignado", hideOn: "lg", render: (w: any) => <span className="text-xs">{w.assigned_to?.full_name || w.supplier?.name || "Sin asignar"}</span> },
        { key: "down", header: "Downtime", align: "right", hideOn: "sm", render: (w: any) => <span className="tf-num">{formatNumber(w.downtime_min)} min</span> },
        { key: "cost", header: "Costo", align: "right", render: (w: any) => formatMoney(w.total_cost, w.currency || "usd") },
        { key: "sched", header: "Programada", hideOn: "lg", render: (w: any) => <span className="tf-num text-xs">{w.scheduled_at ? formatDateTime(w.scheduled_at) : "—"}</span> },
      ]}
      fields={[
        { name: "title", label: "Título", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "order_type", label: "Tipo", type: "select", defaultValue: "corrective", options: optionsFrom(WORK_ORDER_TYPE) },
        { name: "priority", label: "Prioridad", type: "select", defaultValue: "medium", options: optionsFrom(PRIORITY) },
        { name: "status", label: "Estado", type: "select", defaultValue: "open", options: optionsFrom(WORK_ORDER_STATUS) },
        { name: "asset", label: "Activo", type: "reference", resource: "asset" },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "assigned_to", label: "Asignado a", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "supplier", label: "Proveedor externo", type: "reference", resource: "supplier" },
        { name: "incident", label: "Incidente origen", type: "reference", resource: "incident", optionLabel: (i: any) => i.title || i.code || i._id },
        { name: "takes_asset_down", label: "Baja el activo", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "opened_at", label: "Abierta", type: "datetime" },
        { name: "scheduled_at", label: "Programada", type: "datetime" },
        { name: "started_at", label: "Iniciada", type: "datetime" },
        { name: "finished_at", label: "Finalizada", type: "datetime" },
        { name: "labor_hours", label: "Horas de mano de obra", type: "number", suffix: "h" },
        { name: "labor_cost", label: "Costo de mano de obra", type: "number" },
        { name: "parts_cost", label: "Costo de repuestos", type: "number" },
        { name: "total_cost", label: "Costo total", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "downtime_min", label: "Downtime", type: "number", suffix: "min" },
        { name: "meter_reading", label: "Lectura de medidor", type: "number" },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "work_performed", label: "Trabajo realizado", type: "textarea", span: 2 },
      ]}
    />
  );
}
