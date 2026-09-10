"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ATTENDANCE_METHOD, ATTENDANCE_STATUS } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="attendance"
      eyebrow="Equipo"
      title="Asistencia"
      description="Marcajes de entrada y salida con horas trabajadas y extras, listos para nómina."
      emptyIcon="UserRoundCheck"
      filters={[
        { name: "status", label: "Estado", dict: ATTENDANCE_STATUS },
      ]}
      emptyTitle="Sin registros de asistencia"
      emptyDescription="El fichaje manual se registra aquí cuando no hay kiosco."
      createLabel="Registrar asistencia"
      fields={[
        { name: "staff", label: "Personal", type: "reference", resource: "staff", optionLabel: (s: any) => s.full_name || s.code },
        { name: "attendance_date", label: "Fecha", type: "date", required: true },
        { name: "clock_in", label: "Entrada", type: "datetime" },
        { name: "clock_out", label: "Salida", type: "datetime" },
        { name: "status", label: "Estado", type: "select", defaultValue: "present", options: optionsFrom(ATTENDANCE_STATUS) },
        { name: "method", label: "Método", type: "select", defaultValue: "manual", options: optionsFrom(ATTENDANCE_METHOD) },
        { name: "hours_worked", label: "Horas trabajadas", type: "number" },
        { name: "overtime_hours", label: "Horas extra", type: "number" },
        { name: "shift", label: "Turno", type: "reference", resource: "shift", optionLabel: (t: any) => t.role_label || t.shift_date },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "attendance_date", header: "Fecha", kind: "date" },
        { key: "staff", header: "Persona", kind: "ref" },
        { key: "clock_in", header: "Entrada", kind: "datetime" },
        { key: "clock_out", header: "Salida", kind: "datetime" },
        { key: "hours_worked", header: "Horas", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: ATTENDANCE_STATUS },
        { key: "method", header: "Método", kind: "badge", dict: ATTENDANCE_METHOD, hideOn:"lg" },
      ]}
    />
  );
}
