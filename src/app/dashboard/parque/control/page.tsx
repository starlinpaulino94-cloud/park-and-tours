"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ATTRACTION_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="attraction"
      eyebrow="Parque"
      title="Centro de control"
      description="Estado operativo de cada atracción en vivo. El cambio de estado y el tablero en tiempo real llegan en la siguiente iteración."
      emptyIcon="MonitorDot"
      filters={[
        { name: "operational_status", label: "Estado", dict: ATTRACTION_STATUS },
      ]}
      columns={[
        { key: "name", header: "Atracción" },
        { key: "operational_status", header: "Estado", kind: "badge", dict: ATTRACTION_STATUS },
        { key: "zone", header: "Zona", kind: "ref" },
        { key: "queue_minutes", header: "Cola (min)", kind: "number", align:"right" },
        { key: "guests_today", header: "Visitantes hoy", kind: "number", align:"right" },
        { key: "downtime_minutes_today", header: "Downtime hoy (min)", kind: "number", align:"right",hideOn:"md" },
      ]}
    />
  );
}
