"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ATTENDANCE_METHOD, ATTENDANCE_STATUS } from "@/lib/labels-modules";

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
