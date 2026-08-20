"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { PRIORITY, TASK_STATUS, TASK_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="task"
      eyebrow="Inicio"
      title="Tareas"
      description="Tareas y seguimientos del equipo, creados a mano o por escalamiento automático del sistema."
      emptyIcon="SquareCheck"
      filters={[
        { name: "status", label: "Estado", dict: TASK_STATUS },
        { name: "priority", label: "Prioridad", dict: PRIORITY },
        { name: "task_type", label: "Tipo", dict: TASK_TYPE },
      ]}
      columns={[
        { key: "title", header: "Tarea" },
        { key: "status", header: "Estado", kind: "badge", dict: TASK_STATUS },
        { key: "priority", header: "Prioridad", kind: "badge", dict: PRIORITY },
        { key: "task_type", header: "Tipo", kind: "badge", dict: TASK_TYPE, hideOn:"md" },
        { key: "assigned_to", header: "Responsable", kind: "ref" },
        { key: "due_at", header: "Vence", kind: "datetime" },
      ]}
    />
  );
}
