"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { MOVEMENT_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="stock_movement"
      eyebrow="Comercio"
      title="Movimientos de inventario"
      description="Kardex inmutable: entradas, salidas, consumos, transferencias, mermas y ajustes con el saldo resultante."
      emptyIcon="ArrowRightLeft"
      filters={[
        { name: "movement_type", label: "Tipo", dict: MOVEMENT_TYPE },
      ]}
      columns={[
        { key: "moved_at", header: "Fecha", kind: "datetime" },
        { key: "movement_type", header: "Tipo", kind: "badge", dict: MOVEMENT_TYPE },
        { key: "inventory_item", header: "Artículo", kind: "ref" },
        { key: "warehouse", header: "Almacén", kind: "ref", hideOn:"md" },
        { key: "quantity", header: "Cantidad", kind: "number", align:"right" },
        { key: "balance_after", header: "Saldo", kind: "number", align:"right" },
        { key: "reference", header: "Referencia", hideOn:"lg" },
      ]}
    />
  );
}
