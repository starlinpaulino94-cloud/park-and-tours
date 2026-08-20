"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { SHIFT_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="shift"
      eyebrow="Equipo"
      title="Turnos"
      description="Planificación de turnos por persona, zona y atracción, con horas previstas y costo estimado."
      emptyIcon="BriefcaseBusiness"
      filters={[
        { name: "status", label: "Estado", dict: SHIFT_STATUS },
      ]}
      columns={[
        { key: "shift_date", header: "Fecha", kind: "date" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "role_label", header: "Puesto" },
        { key: "starts_at", header: "Entrada", kind: "datetime" },
        { key: "ends_at", header: "Salida", kind: "datetime" },
        { key: "hours_planned", header: "Horas", kind: "number", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: SHIFT_STATUS },
      ]}
    />
  );
}
