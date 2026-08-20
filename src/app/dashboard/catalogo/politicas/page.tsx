"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="cancellation_policy"
      eyebrow="Catálogo"
      title="Políticas de cancelación"
      description="Escalas de penalidad por antelación y tratamiento del no-show. Se aplican al calcular reembolsos."
      emptyIcon="FileWarning"
      columns={[
        { key: "name", header: "Política" },
        { key: "description", header: "Descripción", hideOn:"md" },
        { key: "no_show_refund_pct", header: "Reembolso no-show (%)", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
