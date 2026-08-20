"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
import { HOTEL_CATEGORY } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="hotel"
      eyebrow="Administración"
      title="Hoteles y puntos de recogida"
      description="Hoteles, resorts y puntos de encuentro con su zona y el desfase de recogida que aplica el despacho diario."
      emptyIcon="Hotel"
      filters={[
        { name: "status", label: "Estado", dict: GENERIC_STATUS },
      ]}
      columns={[
        { key: "name", header: "Hotel" },
        { key: "category", header: "Categoría", kind: "badge", dict: HOTEL_CATEGORY },
        { key: "zone", header: "Zona", kind: "ref" },
        { key: "pickup_point", header: "Punto de recogida", hideOn:"md" },
        { key: "pickup_offset_min", header: "Desfase (min)", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
