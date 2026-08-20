"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { NOTIFICATION_TYPE, YES_NO } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="notification"
      eyebrow="Inicio"
      title="Notificaciones"
      description="Avisos del sistema sobre reservas, pagos, operación y liquidaciones."
      emptyIcon="Bell"
      filters={[
        { name: "notification_type", label: "Tipo", dict: NOTIFICATION_TYPE },
        { name: "read_status", label: "Leída", dict: YES_NO },
      ]}
      columns={[
        { key: "title", header: "Aviso" },
        { key: "notification_type", header: "Tipo", kind: "badge", dict: NOTIFICATION_TYPE },
        { key: "message", header: "Detalle", hideOn:"md" },
        { key: "read_status", header: "Leída", kind: "badge", dict: YES_NO },
        { key: "createdAt", header: "Recibida", kind: "datetime" },
      ]}
    />
  );
}
