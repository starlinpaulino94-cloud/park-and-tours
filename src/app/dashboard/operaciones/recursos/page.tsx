"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { optionsFrom } from "@/components/tf/options";
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
      createLabel="Asignar recurso"
      fields={[
        { name: "departure", label: "Salida", type: "reference", resource: "departure",
          optionLabel: (d: any) => `${d.product?.name || "Salida"} · ${String(d.departure_at || "").slice(0, 16).replace("T", " ")}`,
          required: true, span: 2 },
        { name: "resource_role", label: "Rol", type: "select", options: optionsFrom(RESOURCE_ROLE) },
        { name: "staff", label: "Persona", type: "reference", resource: "staff",
          optionLabel: (s: any) => s.full_name || s.code },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle",
          optionLabel: (v: any) => v.plate || v.name || v.code },
        { name: "pax_assigned", label: "Pasajeros asignados", type: "number" },
        { name: "start_time", label: "Desde", placeholder: "07:00" },
        { name: "end_time", label: "Hasta", placeholder: "15:00" },
        { name: "status", label: "Estado", type: "select", options: optionsFrom(RESOURCE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
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
