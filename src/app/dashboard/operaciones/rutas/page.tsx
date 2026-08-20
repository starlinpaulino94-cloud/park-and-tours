"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
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
