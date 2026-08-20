"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
import { COST_TYPE } from "@/lib/labels-modules";

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
