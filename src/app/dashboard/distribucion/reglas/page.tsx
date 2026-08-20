"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { BENEFICIARY_TYPE, CALC_TYPE, GENERIC_STATUS } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="commission_rule"
      eyebrow="Distribución"
      title="Reglas de comisión"
      description="Cómo se calcula la comisión por socio, vendedor, producto y canal. La regla de mayor prioridad gana."
      emptyIcon="Sliders"
      filters={[
        { name: "beneficiary_type", label: "Beneficiario", dict: BENEFICIARY_TYPE },
      ]}
      columns={[
        { key: "name", header: "Regla" },
        { key: "beneficiary_type", header: "Beneficiario", kind: "badge", dict: BENEFICIARY_TYPE },
        { key: "calc_type", header: "Cálculo", kind: "badge", dict: CALC_TYPE },
        { key: "value", header: "Valor", kind: "number", align:"right" },
        { key: "partner", header: "Socio", kind: "ref", hideOn:"md" },
        { key: "priority", header: "Prioridad", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
