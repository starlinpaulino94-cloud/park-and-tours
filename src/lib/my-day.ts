/**
 * Dominio del módulo "Mi día".
 *
 * Módulo puro: construye los filtros que ejecuta Supabase y ordena el resultado
 * según la prioridad operativa. No toca base de datos ni React, para que la
 * clasificación —la parte que puede equivocarse— sea verificable con pruebas.
 */

import { dayBounds, isOverdue, toValidDate } from "@/lib/time";

/** Estados en los que una tarea sigue siendo trabajo pendiente. */
export const OPEN_TASK_STATUSES = ["todo", "in_progress", "blocked", "waiting"] as const;
/** Prioridades que cuentan como "prioridad alta". */
export const HIGH_PRIORITIES = ["high", "urgent"] as const;

export interface MyDayTask {
  _id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  due_at?: string | null;
  task_type?: string | null;
  assigned_to_id?: string | null;
}

/** Filtros rápidos de la lista; el valor viaja en la URL (`?f=`). */
export type MyDayFilter = "todas" | "vencidas" | "hoy" | "urgentes" | "en_curso";

export const MY_DAY_FILTERS: ReadonlyArray<{ value: MyDayFilter; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "vencidas", label: "Vencidas" },
  { value: "hoy", label: "Hoy" },
  { value: "urgentes", label: "Urgentes" },
  { value: "en_curso", label: "En curso" },
];

const FILTER_VALUES = new Set<string>(MY_DAY_FILTERS.map((f) => f.value));

/** Un valor de URL desconocido cae a "todas" en vez de romper la pantalla. */
export function parseFilter(value: string | string[] | undefined): MyDayFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && FILTER_VALUES.has(raw) ? (raw as MyDayFilter) : "todas";
}

/** Filtro base: solo tareas abiertas del usuario autenticado. */
export function openTasksFilter(userId: string): Record<string, unknown> {
  return { assigned_to: userId, status: { in: [...OPEN_TASK_STATUSES] } };
}

export interface CountFilters {
  overdue: Record<string, unknown>;
  dueToday: Record<string, unknown>;
  highPriority: Record<string, unknown>;
}

/**
 * Filtros de los tres contadores de tareas, en la zona horaria de la empresa.
 *
 * "Vencidas" y "Vencen hoy" son mutuamente excluyentes por construcción: el
 * corte es `ahora`, no la medianoche, así que ninguna tarea cae en ambos. La
 * prioridad alta es un eje distinto (transversal), declarado como tal.
 */
export function countFilters(userId: string, now: Date, timeZone: string): CountFilters {
  const base = openTasksFilter(userId);
  const { end } = dayBounds(now, timeZone);
  const nowIso = now.toISOString();

  return {
    overdue: { ...base, due_at: { lt: nowIso } },
    dueToday: { ...base, due_at: { gte: nowIso, lte: end.toISOString() } },
    highPriority: { ...base, priority: { in: [...HIGH_PRIORITIES] } },
  };
}

/** Filtro de la lista según el chip activo. */
export function listFilter(
  filter: MyDayFilter,
  userId: string,
  now: Date,
  timeZone: string
): Record<string, unknown> {
  const counts = countFilters(userId, now, timeZone);
  switch (filter) {
    case "vencidas": return counts.overdue;
    case "hoy": return counts.dueToday;
    case "urgentes": return counts.highPriority;
    case "en_curso": return { assigned_to: userId, status: "in_progress" };
    case "todas":
    default: return openTasksFilter(userId);
  }
}

/**
 * Los tres cortes que alimentan la vista "Todas".
 *
 * En lugar de traer una página grande y filtrarla en memoria, se piden tres
 * conjuntos acotados, cada uno con su predicado resuelto en el servidor:
 * lo que vence hasta el final de hoy, lo prioritario (con o sin fecha) y el
 * siguiente tramo por fecha. Cada consulta devuelve como mucho `limit` filas y
 * todas usan el índice (organization_id, assigned_to_id, status, due_at).
 */
export function candidateFilters(
  userId: string,
  now: Date,
  timeZone: string
): Array<{ filter: Record<string, unknown>; sort: Record<string, "asc" | "desc"> }> {
  const base = openTasksFilter(userId);
  const { end } = dayBounds(now, timeZone);

  return [
    // Vencidas + las que vencen hoy, lo más urgente primero.
    { filter: { ...base, due_at: { lte: end.toISOString() } }, sort: { due_at: "asc" } },
    // Prioritarias, incluidas las que no tienen fecha o vencen más adelante.
    { filter: { ...base, priority: { in: [...HIGH_PRIORITIES] } }, sort: { due_at: "asc" } },
    // Siguiente tramo por fecha, para rellenar cuando lo anterior no alcanza.
    { filter: base, sort: { due_at: "asc" } },
  ];
}

/** Grupos de prioridad, en el orden exacto en que deben mostrarse. */
export type TaskBucket = "overdue" | "urgent" | "high" | "today" | "upcoming" | "undated";

export const BUCKET_ORDER: Record<TaskBucket, number> = {
  overdue: 0,
  urgent: 1,
  high: 2,
  today: 3,
  upcoming: 4,
  undated: 5,
};

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: "Vencida",
  urgent: "Urgente",
  high: "Prioridad alta",
  today: "Vence hoy",
  upcoming: "Próxima",
  undated: "Sin vencimiento",
};

/**
 * Grupo al que pertenece una tarea. El primer criterio que se cumple manda, y
 * ese orden es literalmente el que pide la especificación: vencidas, urgentes,
 * prioridad alta, vencen hoy, próximas.
 */
export function taskBucket(task: MyDayTask, now: Date, timeZone: string): TaskBucket {
  if (isOverdue(task.due_at, now)) return "overdue";
  if (task.priority === "urgent") return "urgent";
  if (task.priority === "high") return "high";

  const due = toValidDate(task.due_at);
  if (!due) return "undated";

  const { end } = dayBounds(now, timeZone);
  if (due.getTime() <= end.getTime()) return "today";
  return "upcoming";
}

/**
 * Ordena por grupo y, dentro del grupo, por vencimiento más cercano. Las tareas
 * sin fecha van al final de su grupo en vez de encabezarlo, que es lo que hace
 * un `ORDER BY due_at` ingenuo cuando el motor pone los NULL primero.
 */
export function sortTasks(tasks: MyDayTask[], now: Date, timeZone: string): MyDayTask[] {
  return [...tasks].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[taskBucket(a, now, timeZone)] - BUCKET_ORDER[taskBucket(b, now, timeZone)];
    if (bucketDiff !== 0) return bucketDiff;

    const da = toValidDate(a.due_at);
    const db = toValidDate(b.due_at);
    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;
    return (a.title || "").localeCompare(b.title || "", "es");
  });
}

/** Une los resultados de las consultas candidatas sin repetir tareas. */
export function mergeUnique(groups: MyDayTask[][]): MyDayTask[] {
  const seen = new Set<string>();
  const out: MyDayTask[] = [];
  for (const group of groups) {
    for (const task of group) {
      if (!task?._id || seen.has(task._id)) continue;
      seen.add(task._id);
      out.push(task);
    }
  }
  return out;
}

/** Solo el responsable asignado o alguien con rango de gestión puede cerrarla. */
export function canCompleteTask(task: MyDayTask, userId: string, isManagerOrAbove: boolean): boolean {
  if (isManagerOrAbove) return true;
  return Boolean(task.assigned_to_id) && task.assigned_to_id === userId;
}
