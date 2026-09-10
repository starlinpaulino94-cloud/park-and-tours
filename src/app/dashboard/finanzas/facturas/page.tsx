"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { INVOICE_STATUS, INVOICE_TYPE, NCF_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

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
      emptyTitle="Sin facturas emitidas"
      emptyDescription="Comprobantes fiscales con su NCF, su cliente y su vencimiento."
      createLabel="Nueva factura"
      fields={[
        { name: "number", label: "Número", required: true },
        { name: "invoice_type", label: "Tipo", type: "select", defaultValue: "sale", options: optionsFrom(INVOICE_TYPE) },
        { name: "status", label: "Estado", type: "select", defaultValue: "draft", options: optionsFrom(INVOICE_STATUS) },
        { name: "customer", label: "Cliente", type: "reference", resource: "customer", optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email },
        { name: "order", label: "Orden", type: "reference", resource: "order", optionLabel: (o: any) => o.order_number || o._id },
        { name: "customer_name", label: "Razón social" },
        { name: "customer_tax_id", label: "RNC / Identificación" },
        { name: "ncf", label: "NCF" },
        { name: "ncf_type", label: "Tipo de NCF", type: "select", options: optionsFrom(NCF_TYPE) },
        { name: "issued_at", label: "Emitida", type: "date" },
        { name: "due_date", label: "Vence", type: "date" },
        { name: "subtotal", label: "Subtotal", type: "number" },
        { name: "tax", label: "Impuesto", type: "number" },
        { name: "tax_rate", label: "Tasa", type: "number", suffix: "%" },
        { name: "discount", label: "Descuento", type: "number" },
        { name: "total", label: "Total", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "customer_address", label: "Dirección", span: 2 },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
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
