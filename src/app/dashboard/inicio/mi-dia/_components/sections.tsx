import Link from "next/link";
import { tenantCount, tenantQuery, atLeast, type TenantContext } from "@/lib/tenant";
import {
  pendingFor, countDecidableFor, decidableActionsFor, isTwoSignature, type ApprovalRow,
} from "@/lib/approvals";
import { OWNERSHIP_OVERRIDE_ROLE } from "@/lib/resources";
import { resolveUserNames, UNKNOWN_REQUESTER } from "@/lib/user-directory";
import {
  BUCKET_LABEL, MY_DAY_FILTERS, canCompleteTask, candidateFilters, countFilters,
  listFilter, mergeUnique, sortTasks, taskBucket,
  type MyDayFilter, type MyDayTask,
} from "@/lib/my-day";
import {
  companyTimeZone, dueLabel, formatDateTimeInZone, humanizeElapsed, isOverdue,
} from "@/lib/time";
import { formatMoney } from "@/lib/format";
import { Icon } from "@/components/tf/icon";
import { cn } from "@/lib/utils";
import { StatTile } from "./stat-tile";
import { TaskRow, type TaskRowData } from "./task-row";
import { ApprovalRow as ApprovalRowView, type ApprovalRowData } from "./approval-row";

export const BASE_PATH = "/dashboard/inicio/mi-dia";
export const TASK_LIMIT = 15;
export const APPROVAL_LIMIT = 8;

export type Ctx = TenantContext & { companyId: string };

/* -------------------------------------------------------------------------- */
/* Nivel 1 — resumen operativo                                                 */
/* -------------------------------------------------------------------------- */

/** Un contador que falla vale null, no cero: cero es una afirmación falsa. */
async function safeCount(label: string, run: () => Promise<number>): Promise<number | null> {
  try {
    return await run();
  } catch (err) {
    console.error(`[mi-dia] no se pudo contar ${label}:`, err);
    return null;
  }
}

export async function Counters({ ctx, filter }: { ctx: Ctx; filter: MyDayFilter }) {
  const tz = companyTimeZone(ctx.company);
  const now = new Date();
  const filters = countFilters(ctx.userId, now, tz);
  const canDecide = decidableActionsFor(ctx.role).length > 0;

  // Conteos exactos en base de datos. Antes se derivaban de una página de 50
  // filas, así que a partir de la tarea 51 los números simplemente mentían.
  const [overdue, dueToday, high, approvals] = await Promise.all([
    safeCount("vencidas", () => tenantCount(ctx.companyId, "task", filters.overdue)),
    safeCount("vencen hoy", () => tenantCount(ctx.companyId, "task", filters.dueToday)),
    safeCount("prioridad alta", () => tenantCount(ctx.companyId, "task", filters.highPriority)),
    canDecide ? safeCount("aprobaciones", () => countDecidableFor(ctx)) : Promise.resolve(0),
  ]);

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {/* "Vencidas" y "Vencen hoy" se excluyen entre sí: el corte es "ahora",
          no la medianoche, así que ninguna tarea entra en ambas. */}
      <StatTile
        label="Vencidas" value={overdue} icon="TriangleAlert" href={`${BASE_PATH}?f=vencidas`}
        active={filter === "vencidas"} tone={overdue && overdue > 0 ? "danger" : "default"}
      />
      <StatTile
        label="Vencen hoy" value={dueToday} icon="Clock" href={`${BASE_PATH}?f=hoy`}
        active={filter === "hoy"} tone={dueToday && dueToday > 0 ? "warning" : "default"}
      />
      <StatTile
        label="Prioridad alta" value={high} icon="Flame" href={`${BASE_PATH}?f=urgentes`}
        active={filter === "urgentes"}
        description="Eje transversal: puede incluir tareas ya contadas como vencidas o de hoy."
      />
      <StatTile
        label="Aprobaciones pendientes" value={approvals} icon="UserCheck" href={`${BASE_PATH}#aprobaciones`}
        description="Solo solicitudes que puedes decidir."
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nivel 2 — tareas prioritarias                                               */
/* -------------------------------------------------------------------------- */

/**
 * Trae los candidatos con tres consultas acotadas en vez de una página grande
 * filtrada en memoria: cada fila devuelta ya cumple un predicado resuelto en el
 * servidor. Después solo queda ordenarlas por grupo de prioridad.
 */
async function loadPrioritizedTasks(ctx: Ctx, now: Date, tz: string): Promise<MyDayTask[]> {
  const groups = await Promise.all(
    candidateFilters(ctx.userId, now, tz).map(({ filter, sort }) =>
      tenantQuery<MyDayTask>(ctx.companyId, "task", { _filter: filter, _sort: sort, _limit: TASK_LIMIT })
    )
  );
  return sortTasks(mergeUnique(groups), now, tz).slice(0, TASK_LIMIT);
}

export async function TasksSection({ ctx, filter }: { ctx: Ctx; filter: MyDayFilter }) {
  const tz = companyTimeZone(ctx.company);
  const now = new Date();
  const isManager = atLeast(ctx.role, OWNERSHIP_OVERRIDE_ROLE);

  let tasks: MyDayTask[];
  try {
    tasks = filter === "todas"
      ? await loadPrioritizedTasks(ctx, now, tz)
      : sortTasks(
          await tenantQuery<MyDayTask>(ctx.companyId, "task", {
            _filter: listFilter(filter, ctx.userId, now, tz),
            _sort: { due_at: "asc" },
            _limit: TASK_LIMIT,
          }),
          now, tz
        );
  } catch (err) {
    console.error("[mi-dia] error cargando tareas:", err);
    return (
      <Section title="Tareas prioritarias">
        <SectionError message="No se pudieron cargar tus tareas." />
      </Section>
    );
  }

  const rows: TaskRowData[] = tasks.map((task) => ({
    id: task._id,
    title: task.title || "Tarea sin título",
    description: task.description ?? null,
    status: task.status ?? null,
    priority: task.priority ?? null,
    dueLabel: dueLabel(task.due_at, now, tz),
    dueIso: task.due_at ?? null,
    dueExact: task.due_at ? formatDateTimeInZone(task.due_at, tz) : "Sin fecha de vencimiento",
    bucketLabel: BUCKET_LABEL[taskBucket(task, now, tz)],
    overdue: isOverdue(task.due_at, now),
    canComplete: canCompleteTask(task, ctx.userId, isManager),
    timeZone: tz,
  }));

  return (
    <Section
      title="Tareas prioritarias"
      action={<SectionLink href="/dashboard/inicio/tareas">Ver todas</SectionLink>}
    >
      <FilterChips active={filter} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No tienes tareas pendientes.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((task) => <TaskRow key={task.id} task={task} />)}
        </ul>
      )}
    </Section>
  );
}

function FilterChips({ active }: { active: MyDayFilter }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos de tareas">
      {MY_DAY_FILTERS.map((chip) => (
        <Link
          key={chip.value}
          href={chip.value === "todas" ? BASE_PATH : `${BASE_PATH}?f=${chip.value}`}
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

/* -------------------------------------------------------------------------- */
/* Nivel 3 — aprobaciones pendientes                                           */
/* -------------------------------------------------------------------------- */

const refOf = (value: unknown): string | null => {
  if (value && typeof value === "object") return (value as { _id?: string })._id ?? null;
  return (value as string | null) ?? null;
};

export async function ApprovalsSection({ ctx }: { ctx: Ctx }) {
  // Permiso insuficiente: la sección no existe, en vez de mostrar un error.
  if (decidableActionsFor(ctx.role).length === 0) return null;

  const tz = companyTimeZone(ctx.company);
  const now = new Date();

  let rows: ApprovalRow[];
  try {
    rows = await pendingFor(ctx, { limit: APPROVAL_LIMIT });
  } catch (err) {
    console.error("[mi-dia] error cargando aprobaciones:", err);
    return (
      <Section title="Aprobaciones pendientes" id="aprobaciones">
        <SectionError message="No se pudieron cargar las aprobaciones." />
      </Section>
    );
  }

  // El nombre del solicitante vive en auth.users; si la resolución falla se
  // muestra la etiqueta neutra, nunca su correo.
  let names = new Map<string, string>();
  try {
    names = await resolveUserNames(rows.map((row) => refOf(row.requested_by)));
  } catch (err) {
    console.error("[mi-dia] no se pudieron resolver los solicitantes:", err);
  }

  const items: ApprovalRowData[] = rows.map((row) => {
    const requesterId = refOf(row.requested_by);
    return {
      id: row._id,
      code: row.code || row._id.slice(0, 8),
      actionType: row.action_type ?? null,
      reason: row.reason || "Sin justificación registrada",
      amountLabel: typeof row.amount === "number"
        ? formatMoney(row.amount, row.currency || ctx.company?.base_currency || "usd")
        : null,
      requesterName: (requesterId && names.get(requesterId)) || UNKNOWN_REQUESTER,
      requestedAtLabel: formatDateTimeInZone(row.requested_at, tz),
      requestedAtIso: row.requested_at ?? null,
      pendingForLabel: humanizeElapsed(row.requested_at, now).replace(/^hace /, ""),
      expiresLabel: row.expires_at ? formatDateTimeInZone(row.expires_at, tz) : null,
      requiresTwo: isTwoSignature(row),
      hasFirstSignature: Boolean(refOf(row.approved_by)),
      timeZone: tz,
    };
  });

  return (
    <Section
      title="Aprobaciones pendientes"
      id="aprobaciones"
      action={<SectionLink href="/dashboard/administracion/aprobaciones">Ver todas</SectionLink>}
    >
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          No hay solicitudes esperando tu decisión.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((approval) => <ApprovalRowView key={approval.id} approval={approval} />)}
        </ul>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Envoltorios compartidos                                                     */
/* -------------------------------------------------------------------------- */

function Section({
  title, id, action, children,
}: {
  title: string;
  id?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-2.5" aria-labelledby={`${id || title}-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id || title}-heading`} className="font-display text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-3 text-sm"
    >
      <Icon name="TriangleAlert" className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      <SectionLink href={BASE_PATH}>Reintentar</SectionLink>
    </div>
  );
}

export function TilesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-busy="true" aria-label="Cargando contadores">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[76px] animate-pulse rounded-xl border border-border bg-muted/40" />
      ))}
    </div>
  );
}

export function ListSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <section className="space-y-2.5" aria-busy="true">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <div className="space-y-1.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted/40" />
        ))}
      </div>
    </section>
  );
}
