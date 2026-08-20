"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, LANGUAGE } from "@/lib/labels";
import { YES_NO } from "@/lib/labels-modules";
import { optionsFrom, LANGUAGE_OPTIONS } from "@/components/tf/options";
import { formatDate } from "@/lib/format";

export default function WaiverTemplatesPage() {
  return (
    <ResourcePage
      resource="waiver_template"
      eyebrow="Seguridad"
      title="Plantillas de waiver"
      description="Textos legales versionados por producto, idioma y jurisdicción. Publicar una versión nueva no altera los waivers ya firmados."
      createLabel="Nueva plantilla"
      emptyIcon="FileSignature"
      emptyTitle="Sin plantillas de waiver"
      emptyDescription="Crea la plantilla de exoneración antes de exigir waiver en una atracción o excursión."
      filters={[{ name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "draft", "archived"]) }]}
      columns={[
        {
          key: "name", header: "Plantilla",
          render: (t: any) => (
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {[t.version ? `v${t.version}` : null, t.jurisdiction].filter(Boolean).join(" · ") || "Sin versión"}
              </p>
            </div>
          ),
        },
        { key: "lang", header: "Idioma", render: (t: any) => <StatusBadge value={t.language} dict={LANGUAGE} dot={false} /> },
        { key: "guardian", header: "Tutor menores", hideOn: "md", render: (t: any) => <StatusBadge value={t.requires_guardian} dict={YES_NO} dot={false} /> },
        { key: "age", header: "Edad mín. firma", align: "right", hideOn: "sm", render: (t: any) => <span className="tf-num">{t.min_age_self_sign ?? "—"}</span> },
        {
          key: "valid", header: "Vigencia", hideOn: "lg",
          render: (t: any) => (
            <span className="tf-num text-xs">
              {t.valid_from ? formatDate(t.valid_from) : "—"} → {t.valid_to ? formatDate(t.valid_to) : "sin fin"}
            </span>
          ),
        },
        { key: "status", header: "Estado", render: (t: any) => <StatusBadge value={t.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "version", label: "Versión", required: true, placeholder: "1.0" },
        { name: "language", label: "Idioma", type: "select", defaultValue: "es", options: LANGUAGE_OPTIONS },
        { name: "jurisdiction", label: "Jurisdicción", placeholder: "República Dominicana" },
        { name: "requires_guardian", label: "Requiere tutor para menores", type: "select", defaultValue: "yes", options: optionsFrom(YES_NO) },
        { name: "min_age_self_sign", label: "Edad mínima para firmar", type: "number", suffix: "años" },
        { name: "valid_from", label: "Vigente desde", type: "date" },
        { name: "valid_to", label: "Vigente hasta", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "draft",
          options: [{ value: "draft", label: "Borrador" }, { value: "active", label: "Activa" }, { value: "archived", label: "Archivada" }] },
        { name: "body", label: "Texto legal", type: "textarea", span: 2, required: true },
      ]}
    />
  );
}
