import Link from "next/link";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { MY_DAY_FILTERS, listFilter, parseFilter, sortTasks, type MyDayFilter, type MyDayTask } from "@/lib/my-day";
import { companyTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { TaskRow } from "../mi-dia/_components/task-row";
import { toTaskRowData } from "../mi-dia/_components/sections";

const PAGE_LIMIT = 50;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireTenant();
  const filter = parseFilter((await searchParams).f);
  const now = new Date();
  const tz = companyTimeZone(ctx.company);

  const tasks = sortTasks(
    await tenantQuery<MyDayTask>(ctx.companyId, "task", {
      _filter: listFilter(filter, ctx.userId, now, tz),
      _sort: { due_at: "asc" },
      _limit: PAGE_LIMIT,
    }),
    now,
    tz
  );
  const rows = tasks.map((task) => toTaskRowData(task, ctx, now, tz));

  return (
    <div className="space-y-5">
      <PageHeader title="Tareas" />
      <TaskFilters active={filter} />

      {rows.length === 0 ? (
        <EmptyState
          icon="SquareCheck"
          title="No tienes tareas pendientes"
          description="Esta vista muestra tus tareas abiertas; las tareas de otros usuarios no aparecen aquí."
        />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}
    </div>
  );
}

function TaskFilters({ active }: { active: MyDayFilter }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros de tareas">
      {MY_DAY_FILTERS.map((chip) => (
        <Link
          key={chip.value}
          href={chip.value === "todas" ? "/dashboard/inicio/tareas" : `/dashboard/inicio/tareas?f=${chip.value}`}
          aria-current={chip.value === active ? "true" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            chip.value === active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted"
          )}
        >
          {chip.label}
        </Link>
      ))}
    </div>
  );
}
