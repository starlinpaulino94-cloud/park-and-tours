"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { APPROVAL_ACTION, APPROVAL_STATUS } from "@/lib/labels-modules";
import type { LabelDef } from "@/lib/labels";

/**
 * El ámbito "Solo las que puedo decidir" se resuelve en el servidor con
 * `decidableFilter`, la misma función que alimenta el contador de "Mi día" y el
 * badge del menú: rol mínimo por acción, sin autoaprobaciones, sin expiradas y
 * sin las que ya firmé. La pantalla no repite ninguna regla de permisos.
 */
const APPROVAL_SCOPE: Record<string, LabelDef> = {
  decidable: { label: "Solo las que puedo decidir", tone: "warning" },
};

export default function Page() {
  return (
    <SimpleResource
      resource="approval_request"
      eyebrow="Administración"
      title="Aprobaciones"
      description="Solicitudes de acciones sensibles pendientes de una segunda firma: descuentos sobre el límite, reembolsos, anulaciones y ajustes de caja."
      emptyIcon="UserCheck"
      filters={[
        { name: "scope", label: "Ámbito", dict: APPROVAL_SCOPE },
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
