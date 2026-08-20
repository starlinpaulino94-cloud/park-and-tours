"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";
import { MEMBERSHIP_PLAN_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="membership_plan"
      eyebrow="Catálogo"
      title="Planes de membresía"
      description="Pases de temporada, membresías anuales y planes de visitas con sus beneficios y límites."
      emptyIcon="IdCard"
      filters={[
        { name: "plan_type", label: "Tipo", dict: MEMBERSHIP_PLAN_TYPE },
      ]}
      columns={[
        { key: "name", header: "Plan" },
        { key: "code", header: "Código" },
        { key: "plan_type", header: "Tipo", kind: "badge", dict: MEMBERSHIP_PLAN_TYPE },
        { key: "price", header: "Precio", kind: "money", align:"right" },
        { key: "duration_days", header: "Vigencia (días)", kind: "number", align:"right" },
        { key: "visits_included", header: "Visitas", kind: "number", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
