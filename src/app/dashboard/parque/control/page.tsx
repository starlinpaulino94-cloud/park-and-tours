"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ATTRACTION_STATUS, ATTRACTION_TYPE, YES_NO } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="attraction"
      eyebrow="Parque"
      title="Centro de control"
      description="Estado operativo de cada atracción en vivo. El cambio de estado y el tablero en tiempo real llegan en la siguiente iteración."
      emptyIcon="MonitorDot"
      filters={[
        { name: "operational_status", label: "Estado", dict: ATTRACTION_STATUS },
      ]}
      createLabel="Nueva atracción"
      fields={[
        { name: "name", label: "Atracción", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "attraction_type", label: "Tipo", type: "select", options: optionsFrom(ATTRACTION_TYPE) },
        { name: "operational_status", label: "Estado operativo", type: "select",
          options: optionsFrom(ATTRACTION_STATUS) },
        { name: "zone", label: "Zona", type: "reference", resource: "zone", optionLabel: (z: any) => z.name },
        { name: "capacity_hour", label: "Capacidad por hora", type: "number", suffix: "pax/h" },
        { name: "capacity_simultaneous", label: "A la vez", type: "number", suffix: "pax" },
        { name: "duration_min", label: "Duración", type: "number", suffix: "min" },
        { name: "min_height_cm", label: "Altura mínima", type: "number", suffix: "cm" },
        { name: "max_height_cm", label: "Altura máxima", type: "number", suffix: "cm" },
        { name: "min_age", label: "Edad mínima", type: "number", suffix: "años" },
        { name: "max_weight_kg", label: "Peso máximo", type: "number", suffix: "kg" },
        { name: "requires_waiver", label: "Exige descargo", type: "select", options: optionsFrom(YES_NO) },
        { name: "weather_sensitive", label: "Cierra con mal tiempo", type: "select", options: optionsFrom(YES_NO) },
        { name: "health_restrictions", label: "Restricciones de salud", type: "textarea", span: 2 },
        { name: "location", label: "Ubicación" },
        { name: "status", label: "Alta/baja", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "name", header: "Atracción" },
        { key: "operational_status", header: "Estado", kind: "badge", dict: ATTRACTION_STATUS },
        { key: "zone", header: "Zona", kind: "ref" },
        { key: "queue_minutes", header: "Cola (min)", kind: "number", align:"right" },
        { key: "guests_today", header: "Visitantes hoy", kind: "number", align:"right" },
        { key: "downtime_minutes_today", header: "Downtime hoy (min)", kind: "number", align:"right",hideOn:"md" },
      ]}
    />
  );
}
