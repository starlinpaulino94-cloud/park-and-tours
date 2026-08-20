"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { DOC_STATUS, DOC_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="document"
      eyebrow="Equipo"
      title="Documentos y SOP"
      description="Procedimientos, políticas, permisos y contratos versionados, con acuse de lectura obligatorio."
      emptyIcon="FolderOpen"
      filters={[
        { name: "doc_type", label: "Tipo", dict: DOC_TYPE },
        { name: "status", label: "Estado", dict: DOC_STATUS },
      ]}
      columns={[
        { key: "title", header: "Documento" },
        { key: "doc_type", header: "Tipo", kind: "badge", dict: DOC_TYPE },
        { key: "version", header: "Versión" },
        { key: "audience", header: "Audiencia", hideOn:"md" },
        { key: "effective_from", header: "Vigente desde", kind: "date", hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: DOC_STATUS },
      ]}
    />
  );
}
