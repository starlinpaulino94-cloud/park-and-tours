"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ASSET_STATUS, ASSET_TYPE, CRITICALITY, YES_NO } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="asset"
      eyebrow="Mantenimiento"
      title="Fuera de servicio"
      description="Activos que no están operativos. Cada uno reduce la capacidad vendible de las salidas y atracciones que dependen de él."
      emptyIcon="OctagonX"
      filters={[
        { name: "operational_status", label: "Estado", dict: ASSET_STATUS },
        { name: "criticality", label: "Criticidad", dict: CRITICALITY },
      ]}
      createLabel="Nuevo activo"
      fields={[
        { name: "name", label: "Activo", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "asset_type", label: "Tipo", type: "select", options: optionsFrom(ASSET_TYPE) },
        { name: "operational_status", label: "Estado operativo", type: "select",
          options: optionsFrom(ASSET_STATUS) },
        { name: "criticality", label: "Criticidad", type: "select", options: optionsFrom(CRITICALITY) },
        { name: "serial_number", label: "Número de serie" },
        { name: "location", label: "Ubicación" },
        { name: "next_maintenance_at", label: "Próximo mantenimiento", type: "date" },
        { name: "warranty_until", label: "Garantía hasta", type: "date" },
        { name: "status", label: "Alta/baja", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Activo" },
        { key: "code", header: "Código" },
        { key: "operational_status", header: "Estado", kind: "badge", dict: ASSET_STATUS },
        { key: "criticality", header: "Criticidad", kind: "badge", dict: CRITICALITY },
        { key: "blocks_capacity", header: "Baja cupo", kind: "badge", dict: YES_NO },
        { key: "attraction", header: "Atracción", kind: "ref", hideOn:"md" },
        { key: "capacity", header: "Capacidad", kind: "number", align:"right" },
      ]}
    />
  );
}
