"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { MOVEMENT_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

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
      emptyTitle="Sin movimientos de inventario"
      emptyDescription="Entradas, salidas, mermas y transferencias entre almacenes."
      createLabel="Nuevo movimiento"
      fields={[
        { name: "inventory_item", label: "Artículo", type: "reference", resource: "inventory_item", required: true },
        { name: "warehouse", label: "Almacén", type: "reference", resource: "warehouse", required: true },
        { name: "movement_type", label: "Tipo", type: "select", defaultValue: "receipt", options: optionsFrom(MOVEMENT_TYPE) },
        { name: "quantity", label: "Cantidad", type: "number", required: true },
        { name: "unit_cost", label: "Costo unitario", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "to_warehouse", label: "Almacén destino", type: "reference", resource: "warehouse", help: "Solo para transferencias." },
        { name: "moved_at", label: "Fecha", type: "datetime" },
        { name: "lot_code", label: "Lote" },
        { name: "expires_at", label: "Caduca", type: "date" },
        { name: "reference", label: "Referencia" },
        { name: "reason", label: "Motivo", type: "textarea", span: 2 },
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
