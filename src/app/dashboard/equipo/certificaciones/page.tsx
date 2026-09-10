"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CERT_STATUS, CERT_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

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
      emptyTitle="Sin certificaciones"
      emptyDescription="Licencias y acreditaciones del equipo, con su vencimiento."
      createLabel="Nueva certificación"
      fields={[
        { name: "name", label: "Certificación", required: true },
        { name: "staff", label: "Personal", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name || s.code },
        { name: "cert_type", label: "Tipo", type: "select", defaultValue: "first_aid", options: optionsFrom(CERT_TYPE) },
        { name: "issuer", label: "Emitida por" },
        { name: "number", label: "Número" },
        { name: "issued_at", label: "Emitida el", type: "date" },
        { name: "expires_at", label: "Vence", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "valid", options: optionsFrom(CERT_STATUS) },
        { name: "blocks_assignment", label: "Bloquea asignación si vence", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
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
