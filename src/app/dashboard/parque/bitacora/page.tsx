"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { ATTRACTION_EVENT } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDateTime, formatNumber } from "@/lib/format";

export default function BitacoraPage() {
  return (
    <ResourcePage
      resource="attraction_log"
      eyebrow="Parque"
      title="Bitácora de atracciones"
      description="Registro inmutable de cada cambio de estado, parada y conteo. Es la fuente del downtime y de la disponibilidad histórica."
      emptyIcon="ClipboardList"
      emptyTitle="Sin eventos registrados"
      emptyDescription="Los eventos se generan desde el centro de control al cambiar el estado de una atracción."
      canWrite={false}
      filters={[{ name: "event_type", label: "Evento", options: optionsFrom(ATTRACTION_EVENT) }]}
      columns={[
        { key: "when", header: "Fecha", render: (l: any) => <span className="tf-num">{formatDateTime(l.logged_at)}</span> },
        {
          key: "attraction", header: "Atracción",
          render: (l: any) => <span className="font-semibold">{l.attraction?.name || "—"}</span>,
        },
        { key: "event", header: "Evento", render: (l: any) => <StatusBadge value={l.event_type} dict={ATTRACTION_EVENT} dot={false} /> },
        {
          key: "change", header: "Cambio", hideOn: "sm",
          render: (l: any) => (
            <span className="text-xs text-muted-foreground">
              {l.from_status && l.to_status ? `${l.from_status} → ${l.to_status}` : l.to_status || "—"}
            </span>
          ),
        },
        { key: "duration", header: "Duración", align: "right", hideOn: "sm", render: (l: any) => <span className="tf-num">{formatNumber(l.duration_min)} min</span> },
        { key: "guests", header: "Visitantes", align: "right", hideOn: "md", render: (l: any) => <span className="tf-num">{formatNumber(l.guests)}</span> },
        { key: "who", header: "Registró", hideOn: "lg", render: (l: any) => <span className="text-xs">{l.user?.name || l.staff?.full_name || "Sistema"}</span> },
        { key: "reason", header: "Motivo", hideOn: "lg", render: (l: any) => <span className="text-xs text-muted-foreground">{l.reason || "—"}</span> },
      ]}
      fields={[]}
    />
  );
}
