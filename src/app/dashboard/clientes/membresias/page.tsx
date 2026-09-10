"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { MEMBERSHIP_STATUS, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="membership"
      eyebrow="Clientes"
      title="Membresías activas"
      description="Membresías vendidas con su vigencia, visitas consumidas y pases de invitado disponibles."
      emptyIcon="ContactRound"
      filters={[
        { name: "status", label: "Estado", dict: MEMBERSHIP_STATUS },
      ]}
      emptyTitle="Sin membresías activas"
      emptyDescription="Altas de socios con su plan, vigencia y renovación."
      createLabel="Nueva membresía"
      fields={[
        { name: "membership_plan", label: "Plan", type: "reference", resource: "membership_plan", required: true },
        { name: "customer", label: "Socio", type: "reference", resource: "customer", required: true, optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email },
        { name: "code", label: "Código" },
        { name: "starts_at", label: "Vigente desde", type: "date" },
        { name: "ends_at", label: "Vigente hasta", type: "date" },
        { name: "amount_paid", label: "Importe pagado", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "auto_renew", label: "Renovación automática", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(MEMBERSHIP_STATUS) },
      ]}
      columns={[
        { key: "code", header: "Membresía" },
        { key: "membership_plan", header: "Plan", kind: "ref" },
        { key: "customer", header: "Titular", kind: "ref" },
        { key: "status", header: "Estado", kind: "badge", dict: MEMBERSHIP_STATUS },
        { key: "starts_at", header: "Desde", kind: "date", hideOn:"md" },
        { key: "ends_at", header: "Hasta", kind: "date" },
        { key: "visits_used", header: "Visitas", kind: "number", align:"right" },
      ]}
    />
  );
}
