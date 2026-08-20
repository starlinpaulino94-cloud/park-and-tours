import Link from "next/link";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { pendingFor } from "@/lib/approvals";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { StatusBadge } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Card } from "@/components/ui/card";
import { TASK_STATUS, PRIORITY, APPROVAL_ACTION } from "@/lib/labels-modules";
import { formatDateTime, formatMoney } from "@/lib/format";

/** Everything that needs this person today: their tasks and the decisions waiting on them. */
export default async function MyDayPage() {
  const ctx = await requireTenant();

  const [tasks, approvals] = await Promise.all([
    tenantQuery<any>(ctx.companyId, "task", {
      _filter: { assigned_to: ctx.userId, status: { in: ["todo", "in_progress", "blocked", "waiting"] } },
      _sort: { due_at: "asc" },
      _limit: 50,
    }),
    pendingFor(ctx),
  ]);

  const now = Date.now();
  const overdue = tasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
  const urgent = tasks.filter((t) => t.priority === "urgent" || t.priority === "high");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inicio"
        title={`Hola, ${ctx.name.split(" ")[0]}`}
        description="Tus pendientes de hoy y las decisiones que están esperando por ti."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Tareas abiertas" value={String(tasks.length)} icon="SquareCheck" tone="primary" />
        <KpiCard label="Vencidas" value={String(overdue.length)} icon="Clock" tone={overdue.length > 0 ? "coral" : "default"}
          hint={overdue.length > 0 ? "Requieren atención inmediata" : "Nada atrasado"} />
        <KpiCard label="Prioritarias" value={String(urgent.length)} icon="Flame" tone="amber" />
        <KpiCard label="Aprobaciones por decidir" value={String(approvals.length)} icon="UserCheck" tone="ink"
          hint="Nadie puede aprobar su propia solicitud" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Mis tareas</h2>
          <Link href="/dashboard/inicio/tareas" className="text-sm font-medium text-primary hover:underline">
            Ver todas
          </Link>
        </div>
        {tasks.length === 0 ? (
          <EmptyState icon="CheckCheck" title="Nada pendiente" description="No tienes tareas abiertas asignadas." />
        ) : (
          <div className="space-y-2">
            {tasks.slice(0, 12).map((t) => (
              <Card key={t._id} className="flex flex-wrap items-center gap-3 p-3.5">
                <Icon name="SquareCheck" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  {t.due_at && (
                    <p className="text-xs text-muted-foreground">
                      Vence {formatDateTime(t.due_at)}
                      {new Date(t.due_at).getTime() < now && <span className="ml-1 font-semibold text-destructive">· atrasada</span>}
                    </p>
                  )}
                </div>
                <StatusBadge value={t.priority} dict={PRIORITY} />
                <StatusBadge value={t.status} dict={TASK_STATUS} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Esperando tu decisión</h2>
          <Link href="/dashboard/administracion/aprobaciones" className="text-sm font-medium text-primary hover:underline">
            Ver aprobaciones
          </Link>
        </div>
        {approvals.length === 0 ? (
          <EmptyState icon="ShieldCheck" title="Sin solicitudes" description="No hay aprobaciones esperando por ti." />
        ) : (
          <div className="space-y-2">
            {approvals.slice(0, 8).map((a) => (
              <Card key={a._id} className="flex flex-wrap items-center gap-3 p-3.5">
                <Icon name="UserCheck" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.reason || a.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.code}
                    {a.amount ? ` · ${formatMoney(a.amount, a.currency || ctx.company?.base_currency || "usd")}` : ""}
                  </p>
                </div>
                <StatusBadge value={a.action_type} dict={APPROVAL_ACTION} dot={false} />
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
