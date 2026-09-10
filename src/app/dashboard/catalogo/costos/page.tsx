"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { COST_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="product_cost"
      eyebrow="Catálogo"
      title="Costos por producto"
      description="Costos directos por producto y proveedor. Son la base del cálculo de margen y rentabilidad."
      emptyIcon="Calculator"
      filters={[
        { name: "cost_type", label: "Tipo", dict: COST_TYPE },
      ]}
      emptyTitle="Sin costos registrados"
      emptyDescription="Sin costo por producto no hay margen que calcular."
      createLabel="Nuevo costo"
      fields={[
        { name: "product", label: "Producto", type: "reference", resource: "product", required: true },
        { name: "concept", label: "Concepto", required: true },
        { name: "cost_type", label: "Tipo", type: "select", defaultValue: "per_person", options: optionsFrom(COST_TYPE) },
        { name: "amount", label: "Costo", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "concept", header: "Concepto" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "supplier", header: "Proveedor", kind: "ref" },
        { key: "cost_type", header: "Tipo", kind: "badge", dict: COST_TYPE },
        { key: "amount", header: "Costo", kind: "money", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
