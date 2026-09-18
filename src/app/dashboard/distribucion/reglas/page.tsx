"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, BENEFICIARY_TYPE, CALC_TYPE, CHANNEL, GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

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
      createLabel="Nueva regla"
      fields={[
        { name: "name", label: "Nombre de la regla", required: true, span: 2 },
        { name: "beneficiary_type", label: "Para quién", type: "select", required: true,
          options: optionsFrom(BENEFICIARY_TYPE) },
        { name: "calc_type", label: "Cómo se calcula", type: "select", required: true,
          options: optionsFrom(CALC_TYPE) },
        { name: "value", label: "Valor", type: "number",
          help: "Porcentaje o importe, según el cálculo elegido." },
        { name: "priority", label: "Prioridad", type: "number", defaultValue: 100,
          help: "Gana la de número más bajo cuando dos reglas encajan." },
        { name: "product", label: "Solo para esta excursión", type: "reference", resource: "product",
          optionLabel: (p: any) => p.name },
        { name: "seller", label: "Solo para este vendedor", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") || s.code },
        { name: "channel", label: "Solo por este canal", type: "select", options: optionsFrom(CHANNEL) },
        { name: "season_from", label: "Vigente desde", type: "date" },
        { name: "season_to", label: "Vigente hasta", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
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
