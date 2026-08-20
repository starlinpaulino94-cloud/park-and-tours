"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
import { ALLOTMENT_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="allotment"
      eyebrow="Distribución"
      title="Allotments"
      description="Cupos garantizados y free sale por socio o canal, con liberación automática antes de la salida."
      emptyIcon="TableProperties"
      filters={[
        { name: "allotment_type", label: "Tipo", dict: ALLOTMENT_TYPE },
      ]}
      columns={[
        { key: "partner", header: "Socio", kind: "ref" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "allotment_type", header: "Tipo", kind: "badge", dict: ALLOTMENT_TYPE },
        { key: "seats", header: "Cupos", kind: "number", align:"right" },
        { key: "seats_used", header: "Usados", kind: "number", align:"right" },
        { key: "valid_from", header: "Desde", kind: "date", hideOn:"md" },
        { key: "valid_to", header: "Hasta", kind: "date", hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
