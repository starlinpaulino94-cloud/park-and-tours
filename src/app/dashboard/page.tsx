"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { AreaChart, BarList, Donut, CHART_COLORS } from "@/components/tf/charts";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/tf/status-badge";
import { DEPARTURE_STATUS, labelOf, CHANNEL } from "@/lib/labels";
import { formatCompactMoney, formatMoney, formatNumber, formatDate, formatTime } from "@/lib/format";

interface Bucket { key: string; label: string; sales: number; pax: number; bookings: number; margin: number }
interface DashboardData {
  period: { from: string; to: string; label: string };
  currency: string;
  kpis: Record<string, number>;
  series: Bucket[];
  top_products: Bucket[];
  top_sellers: Bucket[];
  top_partners: Bucket[];
  by_channel: Bucket[];
  upcoming_departures: {
    _id: string; product: string; departure_at: string; capacity: number;
    booked: number; available: number; status: string; occupancy: number;
  }[];
  truncated: boolean;
}

const PERIODS = [
  { value: "today", label: "Hoy" },
  { value: "yesterday", label: "Ayer" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Año" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<DashboardData>(`/api/dashboard?period=${period}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[dashboard] error cargando indicadores:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el panel");
      return;
    }
    setData(res.data || null);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.currency || "usd";
  const k = data?.kpis || {};
  const money = (v?: number) => formatMoney(v ?? 0, currency);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dirección"
        title="Panel ejecutivo"
        description="Todo lo que está pasando en la operación, con el detalle financiero real de cada venta."
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar"><Icon name="RefreshCw" className="size-4" /></Button>
            <Link href="/dashboard/pos"><Button className="gap-1.5"><Icon name="Plus" className="size-4" /> Nueva venta</Button></Link>
          </>
        }
      />

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          {data?.truncated && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              El período contiene más de 5.000 reservas: los rankings muestran las 5.000 más antiguas del rango. Acota el período para un cálculo exacto.
            </p>
          )}

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="primary" icon="Banknote" label={`Ventas · ${data?.period.label ?? ""}`}
              value={money(k.sales_period)} hint={`${formatNumber(k.bookings_period)} reservas · ${formatNumber(k.pax_period)} pax`} />
            <KpiCard tone="ink" icon="TrendingUp" label="Margen de contribución"
              value={money(k.margin_period)}
              hint={k.sales_period ? `${((k.margin_period / k.sales_period) * 100).toFixed(1)}% sobre ventas` : "Sin ventas"} />
            <KpiCard icon="Sun" label="Ventas de hoy" value={money(k.sales_today)}
              hint={`${formatNumber(k.bookings_today)} reservas · ${formatNumber(k.pax_today)} pax`} />
            <KpiCard icon="Ticket" label="Ticket medio" value={money(k.avg_ticket)}
              hint={`${formatNumber(k.cancellations)} cancelaciones (${(k.cancellation_rate ?? 0).toFixed(1)}%)`} />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon="Percent" label="Comisiones por pagar" value={money(k.commissions_pending)}
              hint={`${formatNumber(k.commissions_count)} comisiones pendientes`} />
            <KpiCard icon="ArrowDownToLine" label="Por cobrar (partners)" value={money(k.receivables_balance)}
              hint={`${formatNumber(k.receivables_count)} documentos abiertos`} />
            <KpiCard icon="ArrowUpFromLine" label="Por pagar" value={money(k.payables_balance)}
              hint={`${formatNumber(k.payables_count)} facturas pendientes`} />
            <KpiCard tone="amber" icon="Wallet" label="Efectivo en caja" value={money(k.cash_on_hand)}
              hint={`${formatNumber(k.open_cash_sessions)} sesiones abiertas`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="tf-card p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold">Evolución de ventas</h2>
                <span className="text-xs text-muted-foreground">{data?.period.label}</span>
              </div>
              <AreaChart
                data={(data?.series || []).map((s) => ({ label: formatDate(s.key).slice(0, 5), value: s.sales }))}
                currencyFormatter={(v) => formatMoney(v, currency)}
              />
            </div>
            <div className="tf-card p-5">
              <h2 className="mb-4 font-display text-lg font-semibold">Ventas por canal</h2>
              <Donut
                slices={(data?.by_channel || []).slice(0, 6).map((c, i) => ({
                  label: labelOf(CHANNEL, c.key).label,
                  value: Math.round(c.sales),
                  color: CHART_COLORS[i % CHART_COLORS.length],
                }))}
                centerValue={formatCompactMoney(k.sales_period, currency)}
                centerLabel="del período"
              />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <RankCard title="Excursiones más vendidas" href="/dashboard/productos" data={data?.top_products} currency={currency} />
            <RankCard title="Mejores vendedores" href="/dashboard/vendedores" data={data?.top_sellers} currency={currency} tone="coral" />
            <RankCard title="Tour centers y agencias" href="/dashboard/partners" data={data?.top_partners} currency={currency} tone="amber" />
          </section>

          <section className="tf-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Próximas salidas y ocupación</h2>
                <p className="text-xs text-muted-foreground">Ordenadas por menor ocupación: aquí es donde hay que empujar ventas.</p>
              </div>
              <Link href="/dashboard/salidas"><Button variant="outline" size="sm">Ver calendario</Button></Link>
            </div>
            {(data?.upcoming_departures || []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No hay salidas programadas próximamente.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data?.upcoming_departures.map((d) => (
                  <li key={d._id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-[190px] flex-1">
                      <p className="text-sm font-semibold">{d.product}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(d.departure_at)} · {formatTime(d.departure_at)}
                      </p>
                    </div>
                    <div className="w-40">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>{d.booked}/{d.capacity} pax</span>
                        <span className="tf-num">{d.occupancy}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${d.occupancy >= 85 ? "bg-coral" : d.occupancy >= 40 ? "bg-primary" : "bg-amber"}`}
                          style={{ width: `${Math.min(d.occupancy, 100)}%` }}
                        />
                      </div>
                    </div>
                    <StatusBadge value={d.status} dict={DEPARTURE_STATUS} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function RankCard({
  title, data, currency, href, tone = "primary",
}: {
  title: string;
  data?: Bucket[];
  currency: string;
  href: string;
  tone?: "primary" | "coral" | "amber";
}) {
  return (
    <div className="tf-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-primary hover:underline">Ver todo</Link>
      </div>
      <BarList
        tone={tone}
        data={(data || []).map((d) => ({ label: d.label, value: Math.round(d.sales) }))}
        formatter={(v) => formatMoney(v, currency)}
      />
    </div>
  );
}
