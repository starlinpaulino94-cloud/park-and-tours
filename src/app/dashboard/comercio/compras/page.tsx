"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { PO_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="purchase_order"
      eyebrow="Comercio"
      title="Órdenes de compra"
      description="Requisición, aprobación y recepción de compras a proveedores. La recepción alimenta el inventario."
      emptyIcon="FileInput"
      filters={[
        { name: "status", label: "Estado", dict: PO_STATUS },
      ]}
      columns={[
        { key: "code", header: "Orden" },
        { key: "supplier", header: "Proveedor", kind: "ref" },
        { key: "status", header: "Estado", kind: "badge", dict: PO_STATUS },
        { key: "ordered_at", header: "Emitida", kind: "date", hideOn:"md" },
        { key: "expected_at", header: "Llegada esperada", kind: "date" },
        { key: "total", header: "Total", kind: "money", align:"right" },
      ]}
    />
  );
}
