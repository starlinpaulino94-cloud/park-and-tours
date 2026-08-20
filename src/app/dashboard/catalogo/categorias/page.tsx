"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="product_category"
      eyebrow="Catálogo"
      title="Categorías"
      description="Agrupación comercial del catálogo. Ordena cómo se presentan los productos en el punto de venta y el portal B2B."
      emptyIcon="FolderTree"
      columns={[
        { key: "name", header: "Categoría" },
        { key: "description", header: "Descripción", hideOn:"md" },
        { key: "sort_order", header: "Orden", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
