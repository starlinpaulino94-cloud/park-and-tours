"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ASSET_STATUS, CRITICALITY, YES_NO } from "@/lib/labels-modules";

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
