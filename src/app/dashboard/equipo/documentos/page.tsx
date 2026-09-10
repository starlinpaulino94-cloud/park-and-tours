"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { DOC_AUDIENCE, DOC_STATUS, DOC_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

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
      emptyTitle="Sin documentos"
      emptyDescription="Procedimientos, políticas y manuales que el equipo debe conocer."
      createLabel="Nuevo documento"
      fields={[
        { name: "title", label: "Título", required: true },
        { name: "doc_type", label: "Tipo", type: "select", defaultValue: "sop", options: optionsFrom(DOC_TYPE) },
        { name: "version", label: "Versión", placeholder: "1.0" },
        { name: "audience", label: "Dirigido a", type: "select", defaultValue: "all", options: optionsFrom(DOC_AUDIENCE) },
        { name: "status", label: "Estado", type: "select", defaultValue: "draft", options: optionsFrom(DOC_STATUS) },
        { name: "requires_ack", label: "Requiere acuse", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "effective_from", label: "Vigente desde", type: "date" },
        { name: "expires_at", label: "Vence", type: "date" },
        { name: "url", label: "Enlace", type: "url", span: 2 },
        { name: "body", label: "Contenido", type: "textarea", span: 2 },
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
