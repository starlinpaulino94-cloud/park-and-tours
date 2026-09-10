"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="cancellation_policy"
      eyebrow="Catálogo"
      title="Políticas de cancelación"
      description="Escalas de penalidad por antelación y tratamiento del no-show. Se aplican al calcular reembolsos."
      emptyIcon="FileWarning"
      emptyTitle="Sin políticas de cancelación"
      emptyDescription="Definen cuánto se reembolsa según la antelación de la cancelación."
      createLabel="Nueva política"
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "no_show_refund_pct", label: "Reembolso por no-show", type: "number", suffix: "%" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "name", header: "Política" },
        { key: "description", header: "Descripción", hideOn:"md" },
        { key: "no_show_refund_pct", header: "Reembolso no-show (%)", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
