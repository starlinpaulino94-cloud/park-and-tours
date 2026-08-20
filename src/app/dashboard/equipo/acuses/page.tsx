"use client";

import { SimpleResource } from "@/components/tf/simple-resource";

export default function Page() {
  return (
    <SimpleResource
      resource="document_ack"
      eyebrow="Equipo"
      title="Acuses de lectura"
      description="Quién leyó y aceptó cada versión de un procedimiento o política. Es la evidencia de cumplimiento."
      emptyIcon="Signature"
      columns={[
        { key: "document", header: "Documento", kind: "ref" },
        { key: "user", header: "Persona", kind: "ref" },
        { key: "version_acked", header: "Versión" },
        { key: "acknowledged_at", header: "Aceptado", kind: "datetime" },
        { key: "quiz_score", header: "Puntaje", kind: "number", align:"right",hideOn:"md" },
      ]}
    />
  );
}
