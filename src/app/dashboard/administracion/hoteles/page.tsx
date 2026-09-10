"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS } from "@/lib/labels";
import { HOTEL_CATEGORY } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="hotel"
      eyebrow="Administración"
      title="Hoteles y puntos de recogida"
      description="Hoteles, resorts y puntos de encuentro con su zona y el desfase de recogida que aplica el despacho diario."
      emptyIcon="Hotel"
      filters={[
        { name: "status", label: "Estado", dict: ACTIVE_STATUS },
      ]}
      emptyTitle="Sin hoteles registrados"
      emptyDescription="Los hoteles alimentan las recogidas y las rutas de transporte."
      createLabel="Nuevo hotel"
      fields={[
        { name: "name", label: "Hotel", required: true },
        { name: "category", label: "Categoría", type: "select", options: optionsFrom(HOTEL_CATEGORY) },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "address", label: "Dirección", span: 2 },
        { name: "phone", label: "Teléfono", type: "phone" },
        { name: "pickup_point", label: "Punto de recogida" },
        { name: "pickup_offset_min", label: "Margen de recogida", type: "number", suffix: "min", help: "Minutos antes de la salida a los que pasa el transporte." },
        { name: "latitude", label: "Latitud", type: "number" },
        { name: "longitude", label: "Longitud", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Hotel" },
        { key: "category", header: "Categoría", kind: "badge", dict: HOTEL_CATEGORY },
        { key: "zone", header: "Zona", kind: "ref" },
        { key: "pickup_point", header: "Punto de recogida", hideOn:"md" },
        { key: "pickup_offset_min", header: "Desfase (min)", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: ACTIVE_STATUS },
      ]}
    />
  );
}
