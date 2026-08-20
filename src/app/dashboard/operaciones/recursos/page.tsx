"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { RESOURCE_ROLE, RESOURCE_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="departure_resource"
      eyebrow="Operaciones"
      title="Asignación de recursos"
      description="Qué vehículo, guía y personal cubre cada salida. Un conflicto aquí es una salida que no puede operar."
      emptyIcon="Boxes"
      filters={[
        { name: "resource_role", label: "Rol", dict: RESOURCE_ROLE },
        { name: "status", label: "Estado", dict: RESOURCE_STATUS },
      ]}
      columns={[
        { key: "departure", header: "Salida", kind: "ref" },
        { key: "resource_role", header: "Rol", kind: "badge", dict: RESOURCE_ROLE },
        { key: "vehicle", header: "Vehículo", kind: "ref" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "pax_assigned", header: "Pax", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: RESOURCE_STATUS },
      ]}
    />
  );
}
