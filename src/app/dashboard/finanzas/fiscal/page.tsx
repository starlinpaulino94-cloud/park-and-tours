"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
import { TAX_COUNTRY } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="tax_profile"
      eyebrow="Finanzas"
      title="Perfiles fiscales"
      description="Impuestos, secuencias de comprobante y configuración de facturación electrónica por país."
      emptyIcon="Landmark"
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
