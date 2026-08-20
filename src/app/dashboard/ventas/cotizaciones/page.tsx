"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { QUOTE_STATUS, QUOTE_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="quote"
      eyebrow="Ventas"
      title="Cotizaciones"
      description="Propuestas para grupos, corporativos y eventos, con su margen y vigencia antes de convertirse en venta."
      emptyIcon="FileText"
      filters={[
        { name: "status", label: "Estado", dict: QUOTE_STATUS },
        { name: "quote_type", label: "Tipo", dict: QUOTE_TYPE },
      ]}
      columns={[
        { key: "code", header: "Cotización" },
        { key: "customer", header: "Cliente", kind: "ref" },
        { key: "quote_type", header: "Tipo", kind: "badge", dict: QUOTE_TYPE, hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: QUOTE_STATUS },
        { key: "pax", header: "Pax", kind: "number", align:"right" },
        { key: "total", header: "Total", kind: "money", align:"right" },
        { key: "valid_until", header: "Vigente hasta", kind: "date" },
      ]}
    />
  );
}
