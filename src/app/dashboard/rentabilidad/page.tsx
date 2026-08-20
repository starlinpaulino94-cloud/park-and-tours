"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { BarList } from "@/components/tf/charts";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

interface Bucket {
  key: string; label: string;
  bookings: number; pax: number;
  gross: number; discounts: number; taxes: number; net: number;
  commissions: number; costs: number; margin: number; margin_pct: number;
}

interface ProfitabilityData {
  period: { from: string; to: string; label: string };
  group_by: string;
  rows: Bucket[];
  totals: Bucket;
  truncated: boolean;
}

const PERIODS = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Año" },
];

const GROUPS = [
  { value: "product", label: "Por excursión" },
  { value: "seller", label: "Por vendedor" },
  { value: "partner", label: "Por partner" },
  { value: "channel", label: "Por canal" },
  { value: "departure", label: "Por salida" },
];

export default function ProfitabilityPage() {
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [groupBy, setGroupBy] = useState("product");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<ProfitabilityData>(`/api/reports/profitability?period=${period}&group_by=${groupBy}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[rentabilidad] error cargando el informe:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el informe de rentabilidad");
      return;
    }
    setData(res.data || null);
  }, [period, groupBy]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const currency = "usd";
  const money = (v?: number) => formatMoney(v ?? 0, currency);
  const groupLabel = GROUPS.find((g) => g.value === groupBy)?.label.replace("Por ", "") || "grupo";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dirección"
        title="Rentabilidad"
        description="Ingreso neto menos comisiones y costes operativos. Es el margen que queda de verdad, no la facturación."
        actions={
          <>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="primary" icon="Banknote" label={`Ingreso neto · ${data?.period.label ?? ""}`}
              value={money(t?.net)} hint={`${formatNumber(t?.bookings)} reservas · ${formatNumber(t?.pax)} pax`} />
            <KpiCard tone="coral" icon="Percent" label="Comisiones" value={money(t?.commissions)}
              hint={t?.net ? `${((t.commissions / t.net) * 100).toFixed(1)}% del ingreso` : "Sin ventas"} />
            <KpiCard tone="amber" icon="Receipt" label="Costes operativos" value={money(t?.costs)}
              hint={t?.net ? `${((t.costs / t.net) * 100).toFixed(1)}% del ingreso` : "Sin ventas"} />
            <KpiCard tone="ink" icon="TrendingUp" label="Margen de contribución" value={money(t?.margin)}
              hint={`${formatPercent(t?.margin_pct)} sobre el ingreso neto`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="tf-card p-5">
              <h2 className="mb-4 font-display text-lg font-semibold">Margen por {groupLabel}</h2>
              <BarList
                data={(data?.rows || []).slice(0, 8).map((r) => ({ label: r.label, value: Math.round(r.margin) }))}
                formatter={(v) => formatMoney(v, currency)}
              />
            </div>
            <div className="tf-card p-5">
              <h2 className="mb-4 font-display text-lg font-semibold">Ingreso por {groupLabel}</h2>
              <BarList
                tone="amber"
                data={(data?.rows || []).slice(0, 8).map((r) => ({ label: r.label, value: Math.round(r.net) }))}
                formatter={(v) => formatMoney(v, currency)}
              />
            </div>
          </section>

          <section className="tf-card p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Cascada del margen</h2>
            <ul className="space-y-2 text-sm">
              <Waterfall label="Ingreso bruto" value={money(t?.gross)} pct={100} tone="bg-primary" />
              <Waterfall label="Descuentos aplicados" value={`− ${money(t?.discounts)}`}
                pct={t?.gross ? ((t.discounts ?? 0) / t.gross) * 100 : 0} tone="bg-amber" />
              <Waterfall label="Ingreso neto" value={money(t?.net)}
                pct={t?.gross ? ((t.net ?? 0) / t.gross) * 100 : 0} tone="bg-primary" />
              <Waterfall label="Comisiones" value={`− ${money(t?.commissions)}`}
                pct={t?.gross ? ((t.commissions ?? 0) / t.gross) * 100 : 0} tone="bg-coral" />
              <Waterfall label="Costes operativos" value={`− ${money(t?.costs)}`}
                pct={t?.gross ? ((t.costs ?? 0) / t.gross) * 100 : 0} tone="bg-coral" />
              <Waterfall label="Margen de contribución" value={money(t?.margin)}
                pct={t?.gross ? ((t.margin ?? 0) / t.gross) * 100 : 0} tone="bg-emerald-500" strong />
            </ul>
          </section>

          <DataTable
            rows={(data?.rows || []).map((r) => ({ ...r, _id: r.key }))}
            emptyIcon="TrendingUp"
            emptyTitle="No hay ventas en el período"
            emptyDescription="Cambia el período o registra ventas para ver la rentabilidad real."
            columns={[
              { key: "label", header: groupLabel.charAt(0).toUpperCase() + groupLabel.slice(1),
                render: (r: any) => <span className="font-semibold">{r.label}</span> },
              { key: "bookings", header: "Reservas", align: "right", hideOn: "md", render: (r: any) => formatNumber(r.bookings) },
              { key: "pax", header: "Pax", align: "right", hideOn: "lg", render: (r: any) => formatNumber(r.pax) },
              { key: "gross", header: "Bruto", align: "right", hideOn: "lg", render: (r: any) => money(r.gross) },
              { key: "net", header: "Neto", align: "right", render: (r: any) => money(r.net) },
              { key: "commissions", header: "Comisiones", align: "right", hideOn: "md", render: (r: any) => money(r.commissions) },
              { key: "costs", header: "Costes", align: "right", hideOn: "md", render: (r: any) => money(r.costs) },
              {
                key: "margin", header: "Margen", align: "right",
                render: (r: any) => (
                  <div>
                    <p className={r.margin >= 0 ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-rose-700 dark:text-rose-400"}>
                      {money(r.margin)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatPercent(r.margin_pct)}</p>
                  </div>
                ),
              },
            ]}
            footer={
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{data?.rows.length ?? 0} filas · {data?.period.label}</span>
                <span className="font-semibold">
                  Margen total {money(t?.margin)} ({formatPercent(t?.margin_pct)})
                </span>
              </div>
            }
          />

          {data?.truncated && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              El período contiene más de 1.000 reservas: el informe usa las 1.000 más recientes. Acota el período para un cálculo exacto.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Waterfall({ label, value, pct, tone, strong }: {
  label: string; value: string; pct: number; tone: string; strong?: boolean;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className={strong ? "font-semibold" : ""}>{label}</span>
        <span className={`tf-num ${strong ? "text-base font-semibold" : ""}`}>{value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(Math.min(Math.abs(pct), 100), 1)}%` }} />
      </div>
    </li>
  );
}
