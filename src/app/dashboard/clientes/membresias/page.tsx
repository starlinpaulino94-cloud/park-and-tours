"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { MEMBERSHIP_STATUS } from "@/lib/labels-modules";

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
