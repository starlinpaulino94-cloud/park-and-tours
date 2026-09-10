"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { PO_STATUS } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

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
      emptyTitle="Sin órdenes de compra"
      emptyDescription="Pedidos a proveedores con su recepción y su cuenta por pagar."
      createLabel="Nueva orden de compra"
      fields={[
        { name: "code", label: "Código" },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier", required: true },
        { name: "warehouse", label: "Almacén", type: "reference", resource: "warehouse" },
        { name: "status", label: "Estado", type: "select", defaultValue: "draft", options: optionsFrom(PO_STATUS) },
        { name: "ordered_at", label: "Fecha de pedido", type: "date" },
        { name: "expected_at", label: "Llegada prevista", type: "date" },
        { name: "subtotal", label: "Subtotal", type: "number" },
        { name: "tax", label: "Impuesto", type: "number" },
        { name: "total", label: "Total", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "payment_terms", label: "Condiciones de pago" },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
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
