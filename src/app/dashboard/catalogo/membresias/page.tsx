"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { MEMBERSHIP_PLAN_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

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
      emptyTitle="Sin planes de membresía"
      emptyDescription="Define los pases de temporada y planes de visitas que vendes."
      createLabel="Nuevo plan"
      fields={[
        { name: "name", label: "Plan", required: true },
        { name: "code", label: "Código" },
        { name: "plan_type", label: "Tipo", type: "select", defaultValue: "annual_pass", options: optionsFrom(MEMBERSHIP_PLAN_TYPE) },
        { name: "price", label: "Precio", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "duration_days", label: "Vigencia", type: "number", suffix: "días" },
        { name: "visits_included", label: "Visitas incluidas", type: "number", help: "Vacío = ilimitadas." },
        { name: "guest_passes", label: "Pases de invitado", type: "number" },
        { name: "discount_percent", label: "Descuento del socio", type: "number", suffix: "%" },
        { name: "auto_renew", label: "Renovación automática", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "image_url", label: "Imagen", type: "url" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "benefits", label: "Beneficios", type: "textarea", span: 2, help: "Uno por línea." },
        { name: "blackout_dates", label: "Fechas bloqueadas", type: "textarea", span: 2 },
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
