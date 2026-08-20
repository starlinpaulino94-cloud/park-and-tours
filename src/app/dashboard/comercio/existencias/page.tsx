"use client";

import { SimpleResource } from "@/components/tf/simple-resource";

export default function Page() {
  return (
    <SimpleResource
      resource="stock_level"
      eyebrow="Comercio"
      title="Existencias"
      description="Saldo actual por artículo y almacén, con su costo promedio ponderado y la fecha del último movimiento."
      emptyIcon="Layers3"
      columns={[
        { key: "inventory_item", header: "Artículo", kind: "ref" },
        { key: "warehouse", header: "Almacén", kind: "ref" },
        { key: "quantity", header: "Existencia", kind: "number", align:"right" },
        { key: "reserved", header: "Reservado", kind: "number", align:"right",hideOn:"md" },
        { key: "available", header: "Disponible", kind: "number", align:"right" },
        { key: "avg_cost", header: "Costo promedio", kind: "money", align:"right" },
        { key: "last_movement_at", header: "Último movimiento", kind: "datetime", hideOn:"lg" },
      ]}
    />
  );
}
