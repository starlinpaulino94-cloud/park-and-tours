import { describe, it, expect } from "vitest";
import {
  BUCKET_ORDER, HIGH_PRIORITIES, OPEN_TASK_STATUSES, canCompleteTask, candidateFilters,
  countFilters, listFilter, mergeUnique, openTasksFilter, parseFilter, sortTasks, taskBucket,
  type MyDayTask,
} from "@/lib/my-day";

const RD = "America/Santo_Domingo";
const NOW = new Date("2026-08-25T15:00:00Z"); // 11:00 en RD
const USER = "user-1";

const task = (over: Partial<MyDayTask> & { _id: string }): MyDayTask => ({
  title: "Tarea", status: "todo", priority: "medium", due_at: null, assigned_to_id: USER, ...over,
});

describe("my-day — filtro de la URL", () => {
  it("acepta los valores conocidos", () => {
    expect(parseFilter("vencidas")).toBe("vencidas");
    expect(parseFilter("en_curso")).toBe("en_curso");
  });

  it("un valor manipulado desde el navegador cae a 'todas'", () => {
    expect(parseFilter("'; drop table task;--")).toBe("todas");
    expect(parseFilter(undefined)).toBe("todas");
    expect(parseFilter(["hoy", "vencidas"])).toBe("hoy");
  });
});

describe("my-day — aislamiento por usuario", () => {
  it("todo filtro exige el responsable asignado", () => {
    const filters = [
      openTasksFilter(USER),
      ...Object.values(countFilters(USER, NOW, RD)),
      ...(["todas", "vencidas", "hoy", "urgentes", "en_curso"] as const).map((f) =>
        listFilter(f, USER, NOW, RD)
      ),
      ...candidateFilters(USER, NOW, RD).map((c) => c.filter),
    ];
    for (const filter of filters) {
      expect(filter.assigned_to).toBe(USER);
    }
  });

  it("solo considera estados abiertos", () => {
    expect(openTasksFilter(USER).status).toEqual({ in: [...OPEN_TASK_STATUSES] });
    expect(OPEN_TASK_STATUSES).not.toContain("done");
    expect(OPEN_TASK_STATUSES).not.toContain("cancelled");
  });
});

describe("my-day — contadores en la zona de la empresa", () => {
  it("vencidas corta en 'ahora', no a medianoche", () => {
    expect(countFilters(USER, NOW, RD).overdue.due_at).toEqual({ lt: NOW.toISOString() });
  });

  it("vencen hoy va de ahora al final del día dominicano", () => {
    expect(countFilters(USER, NOW, RD).dueToday.due_at).toEqual({
      gte: "2026-08-25T15:00:00.000Z",
      lte: "2026-08-26T03:59:59.999Z",
    });
  });

  it("los dos rangos no se solapan: ninguna tarea se cuenta dos veces", () => {
    const { overdue, dueToday } = countFilters(USER, NOW, RD);
    const before = (overdue.due_at as { lt: string }).lt;
    const from = (dueToday.due_at as { gte: string }).gte;
    expect(new Date(before).getTime()).toBeLessThanOrEqual(new Date(from).getTime());
  });

  it("el corte de fin de día usa la zona de la empresa, no la del servidor", () => {
    // A las 21:00 RD (01:00Z del día siguiente) el día sigue siendo el 25.
    const lateNight = new Date("2026-08-26T01:00:00Z");
    expect((countFilters(USER, lateNight, RD).dueToday.due_at as { lte: string }).lte)
      .toBe("2026-08-26T03:59:59.999Z");
  });

  it("prioridad alta agrupa alta y urgente", () => {
    expect(countFilters(USER, NOW, RD).highPriority.priority).toEqual({ in: [...HIGH_PRIORITIES] });
  });
});

describe("my-day — clasificación por prioridad", () => {
  it("el orden de los grupos es el operativo", () => {
    expect(BUCKET_ORDER.overdue).toBeLessThan(BUCKET_ORDER.urgent);
    expect(BUCKET_ORDER.urgent).toBeLessThan(BUCKET_ORDER.high);
    expect(BUCKET_ORDER.high).toBeLessThan(BUCKET_ORDER.today);
    expect(BUCKET_ORDER.today).toBeLessThan(BUCKET_ORDER.upcoming);
    expect(BUCKET_ORDER.upcoming).toBeLessThan(BUCKET_ORDER.undated);
  });

  it("vencida gana sobre cualquier prioridad", () => {
    expect(taskBucket(task({ _id: "a", priority: "low", due_at: "2026-08-25T10:00:00Z" }), NOW, RD)).toBe("overdue");
  });

  it("clasifica urgentes, altas, hoy, próximas y sin fecha", () => {
    expect(taskBucket(task({ _id: "b", priority: "urgent" }), NOW, RD)).toBe("urgent");
    expect(taskBucket(task({ _id: "c", priority: "high" }), NOW, RD)).toBe("high");
    expect(taskBucket(task({ _id: "d", due_at: "2026-08-25T22:00:00Z" }), NOW, RD)).toBe("today");
    expect(taskBucket(task({ _id: "e", due_at: "2026-08-28T12:00:00Z" }), NOW, RD)).toBe("upcoming");
    expect(taskBucket(task({ _id: "f" }), NOW, RD)).toBe("undated");
  });

  it("una tarea a las 23:00 RD todavía vence hoy, no mañana", () => {
    expect(taskBucket(task({ _id: "g", due_at: "2026-08-26T03:00:00Z" }), NOW, RD)).toBe("today");
    expect(taskBucket(task({ _id: "h", due_at: "2026-08-26T05:00:00Z" }), NOW, RD)).toBe("upcoming");
  });

  it("ordena por grupo y, dentro del grupo, por vencimiento más cercano", () => {
    const rows = [
      task({ _id: "sin-fecha" }),
      task({ _id: "proxima", due_at: "2026-08-29T12:00:00Z" }),
      task({ _id: "vencida-vieja", due_at: "2026-08-20T12:00:00Z" }),
      task({ _id: "hoy", due_at: "2026-08-25T20:00:00Z" }),
      task({ _id: "urgente", priority: "urgent" }),
      task({ _id: "vencida-reciente", due_at: "2026-08-25T14:00:00Z" }),
      task({ _id: "alta", priority: "high" }),
    ];
    expect(sortTasks(rows, NOW, RD).map((t) => t._id)).toEqual([
      "vencida-vieja", "vencida-reciente", "urgente", "alta", "hoy", "proxima", "sin-fecha",
    ]);
  });

  it("las tareas sin fecha van al final de su grupo, no al principio", () => {
    const rows = [
      task({ _id: "urgente-sin-fecha", priority: "urgent" }),
      task({ _id: "urgente-con-fecha", priority: "urgent", due_at: "2026-08-27T12:00:00Z" }),
    ];
    expect(sortTasks(rows, NOW, RD).map((t) => t._id)).toEqual([
      "urgente-con-fecha", "urgente-sin-fecha",
    ]);
  });
});

describe("my-day — unión de consultas candidatas", () => {
  it("no repite una tarea que aparece en varias consultas", () => {
    const shared = task({ _id: "x", priority: "urgent", due_at: "2026-08-25T10:00:00Z" });
    const merged = mergeUnique([[shared], [shared], [task({ _id: "y" })]]);
    expect(merged.map((t) => t._id)).toEqual(["x", "y"]);
  });

  it("ignora filas sin identificador en vez de romper", () => {
    expect(mergeUnique([[{ _id: "" } as MyDayTask, task({ _id: "z" })]]).map((t) => t._id)).toEqual(["z"]);
  });
});

describe("my-day — permiso para completar", () => {
  it("el responsable asignado puede", () => {
    expect(canCompleteTask(task({ _id: "a" }), USER, false)).toBe(true);
  });

  it("otra persona sin rango de gestión no puede", () => {
    expect(canCompleteTask(task({ _id: "a", assigned_to_id: "otro" }), USER, false)).toBe(false);
  });

  it("con rango de gestión sí puede", () => {
    expect(canCompleteTask(task({ _id: "a", assigned_to_id: "otro" }), USER, true)).toBe(true);
  });

  it("una tarea sin responsable no la cierra cualquiera", () => {
    expect(canCompleteTask(task({ _id: "a", assigned_to_id: null }), USER, false)).toBe(false);
  });
});
