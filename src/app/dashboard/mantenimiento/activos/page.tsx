"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { ASSET_STATUS, ASSET_TYPE, CRITICALITY, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

export default function ActivosPage() {
  return (
    <ResourcePage
      resource="asset"
      eyebrow="Mantenimiento"
      title="Activos"
      description="Atracciones, vehículos, embarcaciones y equipos con su estado, medidores y criticidad. Marcar un activo como bloqueante hace que su caída reduzca el cupo vendible."
      createLabel="Nuevo activo"
      emptyIcon="Cog"
      emptyTitle="Sin activos registrados"
      emptyDescription="Registra los activos que sostienen la operación para controlar su mantenimiento y su impacto en ventas."
      filters={[
        { name: "operational_status", label: "Estado", options: optionsFrom(ASSET_STATUS) },
        { name: "asset_type", label: "Tipo", options: optionsFrom(ASSET_TYPE) },
        { name: "criticality", label: "Criticidad", options: optionsFrom(CRITICALITY) },
      ]}
      columns={[
        {
          key: "name", header: "Activo",
          render: (a: any) => (
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {[a.code, a.serial_number, a.zone?.name || a.location].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (a: any) => <StatusBadge value={a.asset_type} dict={ASSET_TYPE} dot={false} /> },
        { key: "op", header: "Estado", render: (a: any) => <StatusBadge value={a.operational_status} dict={ASSET_STATUS} /> },
        { key: "crit", header: "Criticidad", hideOn: "sm", render: (a: any) => <StatusBadge value={a.criticality} dict={CRITICALITY} dot={false} /> },
        { key: "blocks", header: "Bloquea cupo", hideOn: "lg", render: (a: any) => <StatusBadge value={a.blocks_capacity} dict={YES_NO} dot={false} /> },
        {
          key: "meter", header: "Medidor", align: "right", hideOn: "lg",
          render: (a: any) => (
            <span className="tf-num text-xs">
              {a.meter_hours ? `${formatNumber(a.meter_hours)} h` : a.meter_km ? `${formatNumber(a.meter_km)} km` : "—"}
            </span>
          ),
        },
        { key: "next", header: "Próximo mant.", hideOn: "lg", render: (a: any) => <span className="tf-num text-xs">{a.next_maintenance_at ? formatDate(a.next_maintenance_at) : "—"}</span> },
        { key: "status", header: "Alta", render: (a: any) => <StatusBadge value={a.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "asset_type", label: "Tipo", type: "select", defaultValue: "equipment", options: optionsFrom(ASSET_TYPE) },
        { name: "operational_status", label: "Estado operativo", type: "select", defaultValue: "in_service", options: optionsFrom(ASSET_STATUS) },
        { name: "criticality", label: "Criticidad", type: "select", defaultValue: "medium", options: optionsFrom(CRITICALITY) },
        { name: "blocks_capacity", label: "Bloquea capacidad", type: "select", defaultValue: "no", options: optionsFrom(YES_NO),
          help: "Si es Sí, al salir de servicio se recalcula el cupo vendible de las salidas que lo usan." },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "serial_number", label: "Serie / VIN" },
        { name: "location", label: "Ubicación" },
        { name: "capacity", label: "Capacidad", type: "number", suffix: "pax" },
        { name: "purchase_date", label: "Fecha de compra", type: "date" },
        { name: "purchase_cost", label: "Costo de compra", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "warranty_until", label: "Garantía hasta", type: "date" },
        { name: "meter_hours", label: "Horómetro", type: "number", suffix: "h" },
        { name: "meter_km", label: "Kilometraje", type: "number", suffix: "km" },
        { name: "next_maintenance_at", label: "Próximo mantenimiento", type: "datetime" },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Alta", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
