"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { SHIFT_STATUS } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="shift"
      eyebrow="Equipo"
      title="Turnos"
      description="Planificación de turnos por persona, zona y atracción, con horas previstas y costo estimado."
      emptyIcon="BriefcaseBusiness"
      filters={[
        { name: "status", label: "Estado", dict: SHIFT_STATUS },
      ]}
      emptyTitle="Sin turnos planificados"
      emptyDescription="Planifica quién cubre cada día antes de que llegue la operación."
      createLabel="Nuevo turno"
      fields={[
        { name: "staff", label: "Personal", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name || s.code },
        { name: "shift_date", label: "Fecha", type: "date", required: true },
        { name: "starts_at", label: "Entrada", type: "datetime" },
        { name: "ends_at", label: "Salida", type: "datetime" },
        { name: "role_label", label: "Rol", placeholder: "Guía, cajero, conductor…" },
        { name: "status", label: "Estado", type: "select", defaultValue: "planned", options: optionsFrom(SHIFT_STATUS) },
        { name: "break_min", label: "Descanso", type: "number", suffix: "min" },
        { name: "hours_planned", label: "Horas planificadas", type: "number" },
        { name: "hourly_rate", label: "Tarifa por hora", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "shift_date", header: "Fecha", kind: "date" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "role_label", header: "Puesto" },
        { key: "starts_at", header: "Entrada", kind: "datetime" },
        { key: "ends_at", header: "Salida", kind: "datetime" },
        { key: "hours_planned", header: "Horas", kind: "number", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: SHIFT_STATUS },
      ]}
    />
  );
}
