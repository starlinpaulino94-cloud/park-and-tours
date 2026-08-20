"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CERT_STATUS, CERT_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="certification"
      eyebrow="Equipo"
      title="Certificaciones"
      description="Licencias, cursos y certificados del personal. Una certificación vencida puede bloquear la asignación a un turno."
      emptyIcon="Award"
      filters={[
        { name: "status", label: "Estado", dict: CERT_STATUS },
        { name: "cert_type", label: "Tipo", dict: CERT_TYPE },
      ]}
      columns={[
        { key: "name", header: "Certificación" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "cert_type", header: "Tipo", kind: "badge", dict: CERT_TYPE },
        { key: "issued_at", header: "Emitida", kind: "date", hideOn:"md" },
        { key: "expires_at", header: "Vence", kind: "date" },
        { key: "status", header: "Estado", kind: "badge", dict: CERT_STATUS },
      ]}
    />
  );
}
