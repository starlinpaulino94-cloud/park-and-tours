"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { ATTRACTION_STATUS, ATTRACTION_TYPE, YES_NO } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatNumber } from "@/lib/format";

export default function AtraccionesPage() {
  return (
    <ResourcePage
      resource="attraction"
      eyebrow="Parque"
      title="Atracciones"
      description="Ficha de cada atracción con capacidad por hora, restricciones de acceso y estado operativo en vivo. El estado determina qué se puede vender."
      createLabel="Nueva atracción"
      emptyIcon="FerrisWheel"
      emptyTitle="Sin atracciones registradas"
      emptyDescription="Registra tus atracciones para controlar aforo, restricciones y disponibilidad."
      filters={[
        { name: "operational_status", label: "Estado operativo", options: optionsFrom(ATTRACTION_STATUS) },
        { name: "attraction_type", label: "Tipo", options: optionsFrom(ATTRACTION_TYPE) },
      ]}
      columns={[
        {
          key: "name", header: "Atracción",
          render: (a: any) => (
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {a.code ? `${a.code} · ` : ""}{a.zone?.name || a.location || "Sin zona"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (a: any) => <StatusBadge value={a.attraction_type} dict={ATTRACTION_TYPE} dot={false} /> },
        { key: "op", header: "Operación", render: (a: any) => <StatusBadge value={a.operational_status} dict={ATTRACTION_STATUS} /> },
        {
          key: "cap", header: "Capacidad", align: "right", hideOn: "sm",
          render: (a: any) => (
            <span className="tf-num">{formatNumber(a.capacity_hour)}<span className="text-muted-foreground">/h</span></span>
          ),
        },
        {
          key: "queue", header: "Cola", align: "right", hideOn: "sm",
          render: (a: any) => <span className="tf-num">{formatNumber(a.queue_minutes)} min</span>,
        },
        {
          key: "guests", header: "Hoy", align: "right",
          render: (a: any) => <span className="tf-num">{formatNumber(a.guests_today)}</span>,
        },
        {
          key: "restr", header: "Requisitos", hideOn: "lg",
          render: (a: any) => (
            <span className="text-xs text-muted-foreground">
              {[a.min_height_cm ? `≥${a.min_height_cm} cm` : null, a.min_age ? `≥${a.min_age} años` : null,
                a.requires_waiver === "yes" ? "waiver" : null].filter(Boolean).join(" · ") || "Sin restricciones"}
            </span>
          ),
        },
        { key: "status", header: "Alta", render: (a: any) => <StatusBadge value={a.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "code", label: "Código" },
        { name: "attraction_type", label: "Tipo", type: "select", defaultValue: "ride", options: optionsFrom(ATTRACTION_TYPE) },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "operational_status", label: "Estado operativo", type: "select", defaultValue: "open", options: optionsFrom(ATTRACTION_STATUS) },
        { name: "location", label: "Ubicación" },
        { name: "capacity_hour", label: "Capacidad por hora", type: "number", suffix: "pax/h" },
        { name: "capacity_simultaneous", label: "Capacidad simultánea", type: "number", suffix: "pax" },
        { name: "duration_min", label: "Duración", type: "number", suffix: "min" },
        { name: "queue_minutes", label: "Cola estimada", type: "number", suffix: "min" },
        { name: "min_height_cm", label: "Altura mínima", type: "number", suffix: "cm" },
        { name: "max_height_cm", label: "Altura máxima", type: "number", suffix: "cm" },
        { name: "min_age", label: "Edad mínima", type: "number", suffix: "años" },
        { name: "max_weight_kg", label: "Peso máximo", type: "number", suffix: "kg" },
        { name: "requires_waiver", label: "Requiere waiver", type: "select", defaultValue: "no", options: optionsFrom(YES_NO),
          help: "Si es Sí, el acceso exige un waiver firmado y vigente." },
        { name: "weather_sensitive", label: "Sensible al clima", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "cover_image_url", label: "Imagen (URL)", type: "url", span: 2 },
        { name: "health_restrictions", label: "Restricciones de salud", type: "textarea", span: 2 },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Alta", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activa" }, { value: "inactive", label: "Inactiva" }] },
      ]}
    />
  );
}
