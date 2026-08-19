"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, VEHICLE_TYPE } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import type { Vehicle } from "@/lib/types";

const expiring = (value?: string) => {
  if (!value) return false;
  const days = (new Date(value).getTime() - Date.now()) / 86_400_000;
  return days < 45;
};

export default function TransportPage() {
  return (
    <ResourcePage
      resource="vehicle"
      eyebrow="Operación"
      title="Flota y transporte"
      description="Vehículos propios y de proveedores con capacidad, conductor asignado, seguros e inspecciones. El despacho impide asignar más pasajeros que plazas."
      createLabel="Nuevo vehículo"
      searchPlaceholder="Buscar por nombre o placa…"
      emptyIcon="Bus"
      emptyTitle="Sin vehículos registrados"
      filters={[
        { name: "vehicle_type", label: "Tipo", options: optionsFrom(VEHICLE_TYPE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["available", "in_service", "maintenance", "out_of_service"]) },
      ]}
      columns={[
        {
          key: "name", header: "Vehículo",
          render: (v: any) => (
            <div>
              <p className="font-semibold">{v.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{v.plate || "Sin placa"}</p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (v: any) => <StatusBadge value={v.vehicle_type} dict={VEHICLE_TYPE} dot={false} /> },
        { key: "capacity", header: "Plazas", align: "right", render: (v: any) => v.capacity ?? 0 },
        { key: "driver", header: "Conductor", hideOn: "md",
          render: (v: any) => (typeof v.driver === "object" && v.driver ? v.driver.full_name : "Sin asignar") },
        { key: "supplier", header: "Proveedor", hideOn: "lg",
          render: (v: any) => (typeof v.supplier === "object" && v.supplier ? v.supplier.name : "Flota propia") },
        {
          key: "docs", header: "Documentos", hideOn: "lg",
          render: (v: any) => (
            <div className="text-xs">
              <p className={expiring(v.insurance_expiry) ? "font-semibold text-destructive" : "text-muted-foreground"}>
                Seguro: {formatDate(v.insurance_expiry)}
              </p>
              <p className={expiring(v.inspection_expiry) ? "font-semibold text-destructive" : "text-muted-foreground"}>
                Inspección: {formatDate(v.inspection_expiry)}
              </p>
            </div>
          ),
        },
        { key: "status", header: "Estado", render: (v: any) => <StatusBadge value={v.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre / unidad", required: true },
        { name: "plate", label: "Placa" },
        { name: "vehicle_type", label: "Tipo", type: "select", defaultValue: "minibus", options: optionsFrom(VEHICLE_TYPE) },
        { name: "capacity", label: "Capacidad (plazas)", type: "number", required: true },
        { name: "driver", label: "Conductor habitual", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "insurance_expiry", label: "Vencimiento del seguro", type: "date" },
        { name: "inspection_expiry", label: "Vencimiento de inspección", type: "date" },
        { name: "photo_url", label: "Foto (URL)", type: "url" },
        { name: "status", label: "Estado", type: "select", defaultValue: "available", options: [
          { value: "available", label: "Disponible" }, { value: "in_service", label: "En servicio" },
          { value: "maintenance", label: "Mantenimiento" }, { value: "out_of_service", label: "Fuera de servicio" },
        ] },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
