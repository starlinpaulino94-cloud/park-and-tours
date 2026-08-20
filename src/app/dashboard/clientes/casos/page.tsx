"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CASE_STATUS, CASE_TYPE, PRIORITY } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="guest_case"
      eyebrow="Clientes"
      title="Casos y reclamos"
      description="Reclamos, quejas, objetos perdidos y solicitudes de los visitantes, con su compensación y resolución."
      emptyIcon="Headset"
      filters={[
        { name: "status", label: "Estado", dict: CASE_STATUS },
        { name: "case_type", label: "Tipo", dict: CASE_TYPE },
        { name: "priority", label: "Prioridad", dict: PRIORITY },
      ]}
      columns={[
        { key: "code", header: "Caso" },
        { key: "subject", header: "Asunto" },
        { key: "case_type", header: "Tipo", kind: "badge", dict: CASE_TYPE },
        { key: "status", header: "Estado", kind: "badge", dict: CASE_STATUS },
        { key: "priority", header: "Prioridad", kind: "badge", dict: PRIORITY },
        { key: "customer", header: "Cliente", kind: "ref", hideOn:"md" },
        { key: "opened_at", header: "Abierto", kind: "datetime" },
      ]}
    />
  );
}
