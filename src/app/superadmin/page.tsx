"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { BarList, Donut, CHART_COLORS } from "@/components/tf/charts";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPANY_TYPE, GENERIC_STATUS } from "@/lib/labels";
import { formatCompactMoney, formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";

interface CompanyRow {
  _id: string; name?: string; company_type?: string;
  subscription_status?: string; status?: string; plan?: string;
  trial_ends_at?: string; next_billing_at?: string;
  storage_used_mb: number; users: number;
  bookings: number; revenue: number; pax: number;
}

interface Stats {
  stats: {
    companies_total: number; companies_active: number; companies_trial: number;
    companies_past_due: number; companies_suspended: number; users_total: number;
    bookings_month: number; pax_month: number; gmv_month: number;
    mrr: number; arr: number; invoiced_paid: number; invoiced_pending: number; storage_mb: number;
  };
  companies: CompanyRow[];
  plans: { _id: string; name?: string; code?: string; monthly_price: number; companies: number }[];
  invoices: any[];
  alerts: any[];
}

export default function SuperadminHomePage() {
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Stats>("/api/superadmin/stats");
    setLoading(false);
    if (!res.ok) {
      console.error("[superadmin] error cargando las métricas:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las métricas");
      setData(null);
      return;
    }
    setData(res.data || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-full max-w-lg rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Plataforma" title="Métricas globales" description="Estado agregado de todos los tenants." />
        <EmptyState icon="TriangleAlert" title="No se pudieron cargar las métricas"
          description="Vuelve a intentarlo en unos segundos."
          action={<Button variant="outline" onClick={load} className="gap-1.5"><Icon name="RefreshCw" className="size-4" /> Reintentar</Button>} />
      </div>
    );
  }

  const s = data.stats;
  const health = [
    { label: "Activas", value: s.companies_active, color: CHART_COLORS[0] },
    { label: "En prueba", value: s.companies_trial, color: CHART_COLORS[1] },
    { label: "Impagadas", value: s.companies_past_due, color: CHART_COLORS[2] },
    { label: "Suspendidas", value: s.companies_suspended, color: CHART_COLORS[3] },
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plataforma"
        title="Métricas globales"
        description="Ingresos recurrentes, adopción y salud de todas las empresas alojadas en TourFlow."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Link href="/superadmin/empresas">
              <Button className="gap-1.5"><Icon name="Building2" className="size-4" /> Gestionar empresas</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="primary" icon="Repeat" label="MRR" value={formatMoney(s.mrr, "usd")}
          hint={`ARR estimado ${formatCompactMoney(s.arr, "usd")}`} />
        <KpiCard tone="ink" icon="Building2" label="Empresas" value={formatNumber(s.companies_total)}
          hint={`${formatNumber(s.companies_active)} activas · ${formatNumber(s.companies_trial)} en prueba`} />
        <KpiCard icon="Users" label="Usuarios" value={formatNumber(s.users_total)}
          hint="Cuentas creadas en toda la plataforma" />
        <KpiCard tone="amber" icon="ShoppingBag" label="GMV del mes" value={formatCompactMoney(s.gmv_month, "usd")}
          hint={`${formatNumber(s.bookings_month)} reservas · ${formatNumber(s.pax_month)} pax`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="CircleCheck" label="Facturado cobrado" value={formatMoney(s.invoiced_paid, "usd")} />
        <KpiCard tone={s.invoiced_pending > 0 ? "coral" : "default"} icon="Hourglass"
          label="Facturado pendiente" value={formatMoney(s.invoiced_pending, "usd")} />
        <KpiCard icon="TriangleAlert" label="Empresas impagadas" value={formatNumber(s.companies_past_due)}
          hint={s.companies_suspended > 0 ? `${formatNumber(s.companies_suspended)} suspendidas` : "Sin suspensiones"} />
        <KpiCard icon="HardDrive" label="Almacenamiento" value={`${formatNumber(s.storage_mb, 1)} MB`}
          hint="Ficheros subidos por todos los tenants" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        <section className="tf-card p-5">
          <h2 className="mb-4 font-display text-base font-semibold">Salud de la cartera</h2>
          {health.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay empresas registradas.</p>
          ) : (
            <Donut slices={health} size={148} centerLabel="Empresas" centerValue={formatNumber(s.companies_total)} />
          )}
        </section>

        <section className="tf-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold">Adopción por plan</h2>
            <Link href="/superadmin/planes" className="text-xs font-semibold text-primary hover:underline">Gestionar</Link>
          </div>
          <BarList
            data={data.plans.map((p) => ({ label: `${p.name || p.code}`, value: p.companies }))}
            formatter={(v) => `${formatNumber(v)} empresas`}
          />
          {data.plans.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
              {data.plans.map((p) => (
                <li key={p._id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{p.name || p.code}</span>
                  <span className="tf-num shrink-0">{formatMoney(p.monthly_price, "usd")}/mes</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tf-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold">Alertas de auditoría</h2>
            <Link href="/superadmin/auditoria" className="text-xs font-semibold text-primary hover:underline">Ver todo</Link>
          </div>
          {data.alerts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin eventos críticos recientes.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.alerts.slice(0, 7).map((a: any) => (
                <li key={a._id} className="flex items-start gap-2.5 py-2.5">
                  <Icon
                    name={a.severity === "critical" ? "ShieldAlert" : "TriangleAlert"}
                    className={`mt-0.5 size-4 shrink-0 ${a.severity === "critical" ? "text-rose-700 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.description || a.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {typeof a.company === "object" && a.company ? `${a.company.name} · ` : ""}
                      {formatDateTime(a.occurred_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="tf-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">Empresas por facturación del mes</h2>
          <Link href="/superadmin/empresas" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>
        </div>
        {data.companies.length === 0 ? (
          <EmptyState icon="Building2" title="Todavía no hay empresas"
            description="Cada registro nuevo crea su propio tenant aislado." />
        ) : (
          <div className="tf-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 font-semibold">Empresa</th>
                  <th className="pb-2 font-semibold">Plan</th>
                  <th className="pb-2 text-right font-semibold">Usuarios</th>
                  <th className="pb-2 text-right font-semibold">Reservas</th>
                  <th className="pb-2 text-right font-semibold">GMV mes</th>
                  <th className="pb-2 font-semibold">Suscripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.companies.slice(0, 12).map((c) => (
                  <tr key={c._id}>
                    <td className="py-2.5">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {COMPANY_TYPE[c.company_type || ""]?.label || "Empresa"}
                      </p>
                    </td>
                    <td className="py-2.5">
                      {c.plan ? <Pill tone="violet">{c.plan}</Pill> : <span className="text-xs text-muted-foreground">Sin plan</span>}
                    </td>
                    <td className="tf-num py-2.5 text-right">{formatNumber(c.users)}</td>
                    <td className="tf-num py-2.5 text-right">{formatNumber(c.bookings)}</td>
                    <td className="tf-num py-2.5 text-right">{formatMoney(c.revenue, "usd")}</td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={c.subscription_status} dict={GENERIC_STATUS} />
                        {c.subscription_status === "trial" && c.trial_ends_at && (
                          <span className="text-[11px] text-muted-foreground">hasta {formatDate(c.trial_ends_at)}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
