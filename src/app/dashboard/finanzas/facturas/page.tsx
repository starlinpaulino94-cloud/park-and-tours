"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { INVOICE_STATUS, INVOICE_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="invoice"
      eyebrow="Finanzas"
      title="Facturación"
      description="Facturas fiscales con NCF/e-CF y notas de crédito, con su estado de cobro."
      emptyIcon="Receipt"
      filters={[
        { name: "status", label: "Estado", dict: INVOICE_STATUS },
        { name: "invoice_type", label: "Tipo", dict: INVOICE_TYPE },
      ]}
      columns={[
        { key: "number", header: "Número" },
        { key: "ncf", header: "NCF / e-CF" },
        { key: "customer_name", header: "Cliente" },
        { key: "invoice_type", header: "Tipo", kind: "badge", dict: INVOICE_TYPE, hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: INVOICE_STATUS },
        { key: "issued_at", header: "Emitida", kind: "date", hideOn:"md" },
        { key: "total", header: "Total", kind: "money", align:"right" },
      ]}
    />
  );
}
