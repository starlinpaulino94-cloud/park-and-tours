"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS, MODALITY_TYPE } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="product_modality"
      eyebrow="Catálogo"
      title="Modalidades"
      description="Variantes vendibles de cada producto: adulto, niño, VIP, privado o por vehículo, con su precio y costo."
      emptyIcon="Layers"
      filters={[
        { name: "modality_type", label: "Tipo", dict: MODALITY_TYPE },
      ]}
      columns={[
        { key: "name", header: "Modalidad" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "modality_type", header: "Tipo", kind: "badge", dict: MODALITY_TYPE },
        { key: "price", header: "Precio", kind: "money", align:"right" },
        { key: "cost", header: "Costo", kind: "money", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
