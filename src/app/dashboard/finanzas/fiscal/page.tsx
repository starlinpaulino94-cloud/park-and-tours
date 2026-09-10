"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { TAX_COUNTRY, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="tax_profile"
      eyebrow="Finanzas"
      title="Perfiles fiscales"
      description="Impuestos, secuencias de comprobante y configuración de facturación electrónica por país."
      emptyIcon="Landmark"
      emptyTitle="Sin perfil fiscal"
      emptyDescription="Define el impuesto y la numeración de comprobantes con la que se factura."
      createLabel="Nuevo perfil fiscal"
      fields={[
        { name: "name", label: "Perfil", required: true },
        { name: "country", label: "País", type: "select", defaultValue: "do", options: optionsFrom(TAX_COUNTRY) },
        { name: "tax_name", label: "Nombre del impuesto", placeholder: "ITBIS" },
        { name: "tax_rate", label: "Tasa", type: "number", suffix: "%" },
        { name: "included_in_price", label: "Incluido en el precio", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "tourism_tax_rate", label: "Impuesto turístico", type: "number", suffix: "%" },
        { name: "service_charge_rate", label: "Cargo por servicio", type: "number", suffix: "%" },
        { name: "tax_id_label", label: "Etiqueta del identificador", placeholder: "RNC" },
        { name: "ncf_series", label: "Serie NCF" },
        { name: "ncf_next", label: "Próximo NCF", type: "number" },
        { name: "ncf_expires", label: "Vencimiento de la serie", type: "date" },
        { name: "efac_enabled", label: "Factura electrónica", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "rounding", label: "Redondeo" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "name", header: "Perfil" },
        { key: "country", header: "País", kind: "badge", dict: TAX_COUNTRY },
        { key: "tax_name", header: "Impuesto" },
        { key: "tax_rate", header: "Tasa (%)", kind: "number", align:"right" },
        { key: "ncf_series", header: "Serie NCF", hideOn:"md" },
        { key: "ncf_next", header: "Próximo", kind: "number", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
