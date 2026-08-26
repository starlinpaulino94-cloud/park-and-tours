"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
interface DashboardPermissions {
  canCreateSale: boolean; canViewRevenue: boolean; canViewCollections: boolean; canViewMargin: boolean;
  canViewReceivables: boolean; canViewPayables: boolean; canViewCommissions: boolean; canViewCash: boolean;
  canViewGlobalRankings: boolean; forcedSellerId?: string;
}
interface DashboardData {
  period: { key: string; from: string; to: string; previousFrom: string; previousTo: string; label: string; timezone: string };
  currency: string;
  permissions: DashboardPermissions;
  lastUpdatedAt: string;
  rankBy: "sales" | "margin" | "bookings" | "pax";
  horizonDays: number;
  incompleteFinancialData: boolean;
  truncated: boolean;
  alerts: { type: "warning" | "danger"; title: string; href: string }[];
  kpis: Record<string, number | null>;
  series: Bucket[];
  top_products: Bucket[];
  top_sellers: Bucket[];
  top_partners: Bucket[];
  by_channel: Bucket[];
  upcoming_departures: {
    _id: string; product: string; departure_at: string; capacity: number; booked: number; pending: number;
    available: number; status: string; occupancy: number;
  }[];
}

const PERIODS = [
  { value: "today", label: "Hoy" },
  { value: "yesterday", label: "Ayer" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Año" },
  { value: "custom", label: "Personalizado" },
];
const RANKS = [
  { value: "sales", label: "Ventas" },
  { value: "margin", label: "Margen" },
  { value: "bookings", label: "Reservas" },
  { value: "pax", label: "Pasajeros" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("month");
  const [rankBy, setRankBy] = useState<DashboardData["rankBy"]>("sales");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ product: "", branch: "", seller: "", partner: "", channel: "", from: "", to: "" });
  const requestSeq = useRef(0);
  const hasLoaded = useRef(false);

  const activeFilters = Object.values(filters).filter(Boolean).length + (period === "custom" ? 1 : 0);
  const currency = data?.currency || "usd";
  const k = data?.kpis || {};
  const money = (value?: number | null) => typeof value === "number" ? formatMoney(value, currency) : "Restringido";
  const number = (value?: number | null) => typeof value === "number" ? formatNumber(value) : "Restringido";

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setError(null);
    if (!hasLoaded.current) setLoading(true);
    const params = new URLSearchParams({ period, rankBy });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const res = await api.get<DashboardData>(`/api/dashboard?${params.toString()}`);
    if (seq !== requestSeq.current) return;
    setLoading(false);
    if (!res.ok || !res.data) {
      setData(null);
      hasLoaded.current = true;
      const message = res.error?.message || "No se pudo cargar el panel";
      setError(message);
      toast.error(message);
      return;
    }
    hasLoaded.current = true;
    setData(res.data);
  }, [filters, period, rankBy]);

  useEffect(() => { void load(); }, [load]);

  const refresh = () => startRefresh(() => { void load(); });
  const clearFilters = () => setFilters({ product: "", branch: "", seller: "", partner: "", channel: "", from: "", to: "" });

  return (
    <div className="space-y-6 overflow-x-clip">
      <PageHeader
        title="Panel ejecutivo"
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="h-10 w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PERIODS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" className="gap-1.5" onClick={() => setFiltersOpen((v) => !v)}>
              <Icon name="SlidersHorizontal" className="size-4" /> Filtros{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Button>
            <Button variant="outline" size="icon" onClick={refresh} disabled={loading || refreshing} aria-label="Actualizar">
              <Icon name="RefreshCw" className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            {data?.permissions.canCreateSale !== false && (
              <Link href="/dashboard/pos"><Button className="gap-1.5"><Icon name="Plus" className="size-4" /> Nueva venta</Button></Link>
            )}
          </div>
        }
      />

      {filtersOpen && (
        <section className="tf-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtros del panel ejecutivo">
          {period === "custom" && (
            <>
              <InputFilter label="Desde" type="date" value={filters.from} onChange={(from) => setFilters((f) => ({ ...f, from }))} />
              <InputFilter label="Hasta" type="date" value={filters.to} onChange={(to) => setFilters((f) => ({ ...f, to }))} />
            </>
          )}
          <InputFilter label="Producto" value={filters.product} onChange={(product) => setFilters((f) => ({ ...f, product }))} />
          <InputFilter label="Sucursal" value={filters.branch} onChange={(branch) => setFilters((f) => ({ ...f, branch }))} />
          <InputFilter label="Vendedor" value={filters.seller} onChange={(seller) => setFilters((f) => ({ ...f, seller }))} />
          <InputFilter label="Tour center" value={filters.partner} onChange={(partner) => setFilters((f) => ({ ...f, partner }))} />
          <Select value={filters.channel || "__all"} onValueChange={(channel) => setFilters((f) => ({ ...f, channel: channel === "__all" ? "" : channel }))}>
            <SelectTrigger><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos los canales</SelectItem>
              {Object.keys(CHANNEL).map((channel) => <SelectItem key={channel} value={channel}>{labelOf(CHANNEL, channel).label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>
        </section>
      )}

      {loading ? <DashboardSkeleton /> : error ? <ErrorState message={error} onRetry={refresh} /> : data && (
        <>
          {(data.incompleteFinancialData || data.truncated) && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {data.incompleteFinancialData
                ? "Hay datos financieros sin conversión congelada; los totales afectados se excluyen para evitar cifras engañosas."
                : "Hay más registros de los que este resumen puede analizar en tiempo real; usa filtros o revisa el reporte detallado."}
            </p>
          )}

          {data.alerts.length > 0 && (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Alertas ejecutivas">
              {data.alerts.map((alert) => (
                <Link key={alert.title} href={alert.href} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {alert.title}
                </Link>
              ))}
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiLink href="/dashboard/reservas"><KpiCard tone="primary" icon="Banknote" label="Ventas netas" value={money(k.net_sales)} trend={k.net_sales_trend} hint="Reservas válidas menos reembolsos" definition="Ingreso neto de reservas válidas, convertido con el tipo de cambio congelado de cada operación." /></KpiLink>
            <KpiLink href="/dashboard/pagos"><KpiCard icon="WalletCards" label="Cobrado" value={money(k.collected)} trend={k.collected_trend} hint="Pagos completados netos" definition="Suma de pagos completados menos reembolsos y notas de crédito." /></KpiLink>
            {data.permissions.canViewMargin && <KpiLink href="/dashboard/rentabilidad"><KpiCard tone="ink" icon="TrendingUp" label="Margen de contribución" value={money(k.contribution_margin)} hint={typeof k.margin_pct === "number" ? `${k.margin_pct}% sobre ventas netas` : "Sin ventas"} definition="Ventas netas menos costos directos y comisiones variables no liquidadas." /></KpiLink>}
            <KpiLink href="/dashboard/reservas"><KpiCard icon="Ticket" label="Reservas y pasajeros" value={`${number(k.bookings)} / ${number(k.pax)}`} hint={`${number(k.cancellations)} cancelaciones · ${number(k.no_shows)} no-show`} definition="Cantidad de reservas válidas y pasajeros generados en el período seleccionado." /></KpiLink>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.permissions.canViewReceivables && <KpiLink href="/dashboard/deudas"><KpiCard icon="ArrowDownToLine" label="Por cobrar" value={money(k.receivables_balance)} hint={`${number(k.receivables_count)} documentos abiertos`} /></KpiLink>}
            {data.permissions.canViewPayables && <KpiLink href="/dashboard/finanzas/facturas"><KpiCard icon="ArrowUpFromLine" label="Por pagar" value={money(k.payables_balance)} hint={`${number(k.payables_count)} obligaciones abiertas`} /></KpiLink>}
            {data.permissions.canViewCommissions && <KpiLink href="/dashboard/comisiones"><KpiCard icon="Percent" label="Comisiones pendientes" value={money(k.commissions_pending)} hint={`${number(k.commissions_count)} comisiones sin liquidar`} /></KpiLink>}
            {data.permissions.canViewCash && <KpiLink href="/dashboard/caja"><KpiCard tone="amber" icon="Wallet" label="Efectivo en caja" value={money(k.cash_on_hand)} hint={`${number(k.open_cash_sessions)} sesiones abiertas`} /></KpiLink>}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="tf-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">Evolución de ventas netas</h2>
                <span className="text-xs text-muted-foreground">Última actualización: {formatDate(data.lastUpdatedAt)} · {formatTime(data.lastUpdatedAt)}</span>
              </div>
              <AreaChart data={data.series.map((point) => ({ label: point.key, value: point.sales }))} currencyFormatter={(v) => formatMoney(v, currency)} />
            </div>
            <div className="tf-card p-5">
              <h2 className="mb-4 font-display text-lg font-semibold">Ventas por canal</h2>
              <Donut
                slices={data.by_channel.map((channel, i) => ({ label: labelOf(CHANNEL, channel.key).label, value: channel.sales, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                centerValue={formatCompactMoney((k.net_sales as number) || 0, currency)}
                centerLabel="ventas netas"
              />
              <AccessibleBucketTable data={data.by_channel} currency={currency} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Rankings</h2>
              <Select value={rankBy} onValueChange={(v) => setRankBy(v as DashboardData["rankBy"])}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{RANKS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <RankCard title="Excursiones con mayores ventas" href="/dashboard/productos" data={data.top_products} currency={currency} rankBy={rankBy} />
              <RankCard title="Vendedores con mayores ventas" href="/dashboard/vendedores" data={data.top_sellers} currency={currency} rankBy={rankBy} tone="coral" />
              <RankCard title="Tour centers y agencias con mayores ventas" href="/dashboard/partners" data={data.top_partners} currency={currency} rankBy={rankBy} tone="amber" />
            </div>
          </section>

          <section className="tf-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Próximas salidas</h2>
              <span className="text-xs text-muted-foreground">Próximos {data.horizonDays} días</span>
            </div>
            {data.upcoming_departures.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No hay salidas programadas próximamente.</p> : (
              <ul className="divide-y divide-border">
                {data.upcoming_departures.map((departure) => (
                  <li key={departure._id} className="grid gap-3 py-3 md:grid-cols-[1fr_180px_110px_120px] md:items-center">
                    <div className="min-w-0">
                      <Link href="/dashboard/salidas" className="text-sm font-semibold hover:underline">{departure.product}</Link>
                      <p className="text-xs text-muted-foreground">{formatDate(departure.departure_at)} · {formatTime(departure.departure_at)}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{departure.booked} reservados · {departure.pending} pendientes · {departure.available} disponibles</p>
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{departure.capacity} pax</span><span className="tf-num">{departure.occupancy}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(departure.occupancy, 100)}%` }} /></div>
                    </div>
                    <StatusBadge value={departure.status} dict={DEPARTURE_STATUS} />
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

function InputFilter({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <input type={type} aria-label={label} placeholder={`${label} ID`} value={value} onChange={(e) => onChange(e.target.value.trim())} className="h-10 rounded-md border bg-background px-3 text-sm" />;
}

function KpiLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">{children}</Link>;
}

function DashboardSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="tf-card p-6 text-center"><p className="mb-4 text-sm text-muted-foreground">{message}</p><Button onClick={onRetry}>Reintentar</Button></div>;
}

function AccessibleBucketTable({ data, currency }: { data: Bucket[]; currency: string }) {
  if (data.length === 0) return null;
  const total = data.reduce((sum, item) => sum + item.sales, 0);
  return (
    <table className="mt-4 w-full text-left text-xs">
      <caption className="sr-only">Tabla accesible de ventas por canal</caption>
      <tbody>{data.map((item) => <tr key={item.key}><td className="py-1">{item.label}</td><td className="py-1 text-right tf-num">{total > 0 ? Math.round((item.sales / total) * 100) : 0}% · {formatMoney(item.sales, currency)}</td></tr>)}</tbody>
    </table>
  );
}

function RankCard({ title, data, currency, href, tone = "primary", rankBy }: { title: string; data: Bucket[]; currency: string; href: string; tone?: "primary" | "coral" | "amber"; rankBy: keyof Bucket }) {
  const formatter = (value: number) => rankBy === "sales" || rankBy === "margin" ? formatMoney(value, currency) : formatNumber(value);
  return (
    <div className="tf-card p-5">
      <div className="mb-4 flex items-center justify-between"><h3 className="font-display text-base font-semibold">{title}</h3><Link href={href} className="text-xs font-semibold text-primary hover:underline">Ver detalle</Link></div>
      <BarList tone={tone} data={data.map((item) => ({ label: item.label, value: Number(item[rankBy] ?? 0) }))} formatter={formatter} />
    </div>
  );
}
