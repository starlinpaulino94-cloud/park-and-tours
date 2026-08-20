"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { APPROVAL_ACTION, APPROVAL_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="approval_request"
      eyebrow="Administración"
      title="Aprobaciones"
      description="Solicitudes de acciones sensibles pendientes de una segunda firma: descuentos sobre el límite, reembolsos, anulaciones y ajustes de caja."
      emptyIcon="UserCheck"
      filters={[
        { name: "status", label: "Estado", dict: APPROVAL_STATUS },
        { name: "action_type", label: "Acción", dict: APPROVAL_ACTION },
      ]}
      columns={[
        { key: "code", header: "Código" },
        { key: "action_type", header: "Acción", kind: "badge", dict: APPROVAL_ACTION },
        { key: "status", header: "Estado", kind: "badge", dict: APPROVAL_STATUS },
        { key: "amount", header: "Monto", kind: "money", align:"right" },
        { key: "reason", header: "Justificación", hideOn:"md" },
        { key: "requested_by", header: "Solicitada por", kind: "ref" },
        { key: "requested_at", header: "Solicitada", kind: "datetime" },
      ]}
    />
  );
}
