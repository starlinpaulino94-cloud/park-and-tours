"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { optionsFrom } from "@/components/tf/options";
import { ROUTE_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="pickup_route"
      eyebrow="Operaciones"
      title="Rutas de pickup"
      description="Rutas de recogida por zona con su vehículo, conductor, guía y número de paradas."
      emptyIcon="Route"
      filters={[
        { name: "status", label: "Estado", dict: ROUTE_STATUS },
      ]}
      createLabel="Nueva ruta"
      fields={[
        { name: "name", label: "Nombre de la ruta", required: true, span: 2 },
        { name: "departure", label: "Salida", type: "reference", resource: "departure",
          optionLabel: (d: any) => `${d.product?.name || "Salida"} · ${String(d.departure_at || "").slice(0, 16).replace("T", " ")}`,
          span: 2 },
        { name: "zone", label: "Zona", type: "reference", resource: "zone", optionLabel: (z: any) => z.name },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle",
          optionLabel: (v: any) => v.plate || v.name || v.code },
        { name: "driver", label: "Chófer", type: "reference", resource: "staff",
          optionLabel: (s: any) => s.full_name || s.code },
        { name: "guide", label: "Guía", type: "reference", resource: "staff",
          optionLabel: (s: any) => s.full_name || s.code },
        { name: "start_time", label: "Primera recogida", placeholder: "06:30" },
        { name: "pax_total", label: "Pasajeros", type: "number" },
        { name: "stops_count", label: "Paradas", type: "number" },
        { name: "status", label: "Estado", type: "select", options: optionsFrom(ROUTE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Ruta" },
        { key: "departure", header: "Salida", kind: "ref" },
        { key: "zone", header: "Zona", kind: "ref" },
        { key: "start_time", header: "Inicio" },
        { key: "pax_total", header: "Pax", kind: "number", align:"right" },
        { key: "stops_count", header: "Paradas", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: ROUTE_STATUS },
      ]}
    />
  );
}
