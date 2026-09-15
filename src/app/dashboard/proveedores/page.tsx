"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, SUPPLIER_TYPE, TAX_REGIME } from "@/lib/labels";
import { formatMoney } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Supplier } from "@/lib/types";

export default function SuppliersPage() {
  return (
    <ResourcePage
      resource="supplier"
      eyebrow="Finanzas"
      title="Proveedores"
      description="Transportistas, restaurantes, embarcaciones, parques, guías y servicios externos con sus condiciones de pago y saldo."
      createLabel="Nuevo proveedor"
      emptyIcon="Truck"
      emptyTitle="Sin proveedores"
      filters={[{ name: "supplier_type", label: "Tipo", options: optionsFrom(SUPPLIER_TYPE) }]}
      columns={[
        {
          key: "name", header: "Proveedor",
          render: (s: any) => (
            <div>
              <p className="font-semibold">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.contact_name || s.email || s.phone || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (s: any) => <StatusBadge value={s.supplier_type} dict={SUPPLIER_TYPE} dot={false} /> },
        { key: "terms", header: "Condiciones", align: "right", hideOn: "sm", render: (s: any) => `${s.payment_terms_days ?? 0} días` },
        { key: "balance", header: "Saldo", align: "right", render: (s: any) => formatMoney(s.balance ?? 0, s.currency || "usd") },
        { key: "status", header: "Estado", render: (s: any) => <StatusBadge value={s.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "supplier_type", label: "Tipo", type: "select", defaultValue: "transport", options: optionsFrom(SUPPLIER_TYPE) },
        { name: "tax_id", label: "RNC / Identificación" },
        { name: "contact_name", label: "Contacto" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "payment_terms_days", label: "Días de pago", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        // Régimen fiscal y retenciones (0040). Es lo que decide cuánto se le
        // transfiere de verdad: a una persona física hay que retenerle ISR e
        // ITBIS, y pagarle el bruto deja a la empresa debiéndoselo al fisco.
        { name: "tax_regime", label: "Régimen fiscal", type: "select", defaultValue: "company",
          options: optionsFrom(TAX_REGIME),
          help: "Una persona física lleva retención de ISR e ITBIS; una empresa formal, normalmente ninguna." },
        { name: "tax_rate", label: "ITBIS que factura (%)", type: "number",
          help: "Para poder separar el impuesto del importe bruto. En blanco, se entiende que no factura ITBIS." },
        { name: "retention_isr_pct", label: "Retención de ISR (%)", type: "number",
          help: "En blanco, se aplica la del régimen. Un 0 explícito significa no retener." },
        { name: "retention_itbis_pct", label: "Retención de ITBIS (%)", type: "number",
          help: "Porcentaje del ITBIS facturado que se retiene." },
        { name: "bank_name", label: "Banco" },
        { name: "bank_account", label: "Cuenta bancaria" },
        { name: "address", label: "Dirección", span: 2 },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
