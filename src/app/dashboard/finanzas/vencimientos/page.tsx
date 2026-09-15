"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INSTALLMENT_KIND, INSTALLMENT_STATUS } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { PlanDrawer } from "./plan-drawer";

interface Installment {
  _id: string;
  sequence?: number;
  kind?: string;
  due_date?: string;
  amount?: number;
  paid_amount?: number;
  balance: number;
  currency?: string;
  status?: string;
  days_overdue: number;
  days_to_due: number;
  order?: { _id?: string; order_number?: string; customer?: unknown; status?: string } | string;
  booking?: { _id?: string; booking_number?: string; travel_date?: string } | string;
}

interface CollectionsData {
  window: string;
  installments: Installment[];
  totals: { currency: string; overdue: number; due_soon: number; later: number; total: number }[];
  truncated: boolean;
}

const WINDOWS = [
  { value: "overdue", label: "Vencidos" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "all", label: "Todo" },
];

type CurrencyTotals = CollectionsData["totals"][number];

/** Varias monedas se apilan con su símbolo; convertirlas sería inventar una tasa. */
const money = (rows: CurrencyTotals[], pick: (row: CurrencyTotals) => number): string => {
  const parts = rows
    .map((row) => ({ currency: row.currency, amount: pick(row) }))
    .filter((row) => Math.abs(row.amount) > 0.009);
  if (parts.length === 0) return formatMoney(0);
  return parts.map((row) => formatMoney(row.amount, row.currency)).join("  ·  ");
};

const refOf = (value: unknown): { _id?: string; [key: string]: unknown } | null =>
  value && typeof value === "object" ? (value as { _id?: string }) : null;

const customerName = (value: unknown): string => {
  const customer = refOf(value);
  if (!customer) return "—";
  const full = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return full || (customer.company_name as string) || (customer.email as string) || "—";
};

export default function DueDatesPage() {
  const [data, setData] = useState<CollectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState("month");
  const [planFor, setPlanFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<CollectionsData>(`/api/reports/collections?window=${window}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[vencimientos] no se pudieron cargar:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar los vencimientos");
      return;
    }
    setData(res.data || null);
  }, [window]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals || [];
  const overdueCount = (data?.installments || []).filter((i) => i.days_overdue > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Vencimientos de cobro"
        description="El anticipo que bloquea la plaza y el saldo que hay que cobrar antes de la salida, ordenados por fecha y con lo ya vencido primero."
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone={overdueCount > 0 ? "coral" : "default"} icon="TriangleAlert" label="Vencido"
              value={money(totals, (row) => row.overdue)}
              hint={`${formatNumber(overdueCount)} cuota${overdueCount === 1 ? "" : "s"} pasada${overdueCount === 1 ? "" : "s"} de fecha`} />
            <KpiCard tone="amber" icon="CalendarClock" label="Vence esta semana"
              value={money(totals, (row) => row.due_soon)} hint="Los próximos 7 días" />
            <KpiCard icon="CalendarDays" label="Más adelante"
              value={money(totals, (row) => row.later)} hint="Fuera de los próximos 7 días" />
            <KpiCard tone="primary" icon="Wallet" label="Pendiente total"
              value={money(totals, (row) => row.total)}
              hint={`${formatNumber(data?.installments.length || 0)} cuotas en la ventana`} />
          </section>

          <Tabs value={window} onValueChange={setWindow}>
            <TabsList>
              {WINDOWS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {data?.truncated && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              La lista está recortada: hay más vencimientos de los que caben en una consulta. Acota la ventana.
            </p>
          )}

          <DataTable
            rows={data?.installments || []}
            emptyIcon="CalendarCheck"
            emptyTitle="No hay nada que cobrar en esta ventana"
            emptyDescription="Cuando una venta tenga anticipo o saldo con fecha, aparecerá aquí."
            columns={[
              {
                key: "due", header: "Vence",
                render: (row: Installment) => (
                  <div>
                    <p className="font-semibold">{formatDate(row.due_date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.days_overdue > 0
                        ? `hace ${formatNumber(row.days_overdue)} día${row.days_overdue === 1 ? "" : "s"}`
                        : row.days_to_due === 0
                          ? "hoy"
                          : `en ${formatNumber(row.days_to_due)} día${row.days_to_due === 1 ? "" : "s"}`}
                    </p>
                  </div>
                ),
              },
              {
                key: "sale", header: "Venta",
                render: (row: Installment) => {
                  const order = refOf(row.order);
                  const booking = refOf(row.booking);
                  return (
                    <div>
                      <p className="font-semibold">{(order?.order_number as string) || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {customerName(order?.customer)}
                        {booking?.booking_number ? ` · ${booking.booking_number}` : ""}
                      </p>
                    </div>
                  );
                },
              },
              {
                key: "kind", header: "Concepto", hideOn: "md",
                render: (row: Installment) => (
                  <div className="space-y-1">
                    <StatusBadge value={row.kind || "installment"} dict={INSTALLMENT_KIND} />
                    {row.sequence ? (
                      <p className="text-xs text-muted-foreground">Cuota {formatNumber(row.sequence)}</p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "travel", header: "Salida", hideOn: "lg",
                render: (row: Installment) => {
                  const booking = refOf(row.booking);
                  return (
                    <span className="text-xs">
                      {booking?.travel_date ? formatDate(booking.travel_date as string) : "—"}
                    </span>
                  );
                },
              },
              {
                key: "amount", header: "Importe", align: "right", hideOn: "lg",
                render: (row: Installment) => formatMoney(row.amount ?? 0, row.currency),
              },
              {
                key: "balance", header: "Por cobrar", align: "right",
                render: (row: Installment) => (
                  <span className="tf-num font-semibold">{formatMoney(row.balance, row.currency)}</span>
                ),
              },
              {
                key: "status", header: "Estado",
                render: (row: Installment) =>
                  row.days_overdue > 0
                    ? <Pill tone="danger">Vencida</Pill>
                    : <StatusBadge value={row.status || "pending"} dict={INSTALLMENT_STATUS} />,
              },
              {
                key: "plan", header: "", align: "right",
                render: (row: Installment) => {
                  const orderId = refOf(row.order)?._id;
                  if (!orderId) return null;
                  return (
                    <Button variant="ghost" size="sm" className="gap-1.5"
                      onClick={() => setPlanFor(orderId)}>
                      <Icon name="ListChecks" className="size-4" /> Plan
                    </Button>
                  );
                },
              },
            ]}
          />
        </>
      )}

      <PlanDrawer
        orderId={planFor}
        open={!!planFor}
        onOpenChange={(value) => !value && setPlanFor(null)}
        onSaved={load}
      />
    </div>
  );
}
