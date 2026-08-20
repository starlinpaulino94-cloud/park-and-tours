"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { usePortal } from "./portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { BarList } from "@/components/tf/charts";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BOOKING_STATUS, GENERIC_STATUS, PARTNER_TYPE, SETTLEMENT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

interface Summary {
  period: { from: string; to: string; label: string };
  partner: {
    _id: string; name?: string; commercial_name?: string; partner_type?: string;
    currency?: string; credit_limit?: number; credit_days?: number;
    default_commission_pct?: number; status?: string;
  };
  kpis: {
    bookings: number; cancellations: number; pax: number; sales: number;
    commission_earned: number; commission_pending: number; balance: number;
    credit_available: number; average_ticket: number;
  };
  top_products: { label: string; bookings: number; pax: number; sales: number }[];
  recent_bookings: any[];
  settlements: any[];
  receivables: any[];
}

const PERIODS = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "quarter", label: "Este trimestre" },
  { value: "year", label: "Este año" },
];

export default function PortalHomePage() {
  const { query, partnerId } = usePortal();
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Summary>(`/api/portal/summary${query({ period })}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[portal] error cargando el resumen:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el resumen");
      setData(null);
      return;
    }
    setData(res.data || null);
  }, [query, period]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.partner.currency || "usd";
  const money = (n?: number) => formatMoney(n ?? 0, currency);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portal B2B"
        title={data?.partner.commercial_name || data?.partner.name || "Resumen"}
        description="Tu actividad comercial, comisiones generadas y estado de cuenta con el operador."
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Link href="/portal/catalogo">
              <Button className="gap-1.5"><Icon name="Ticket" className="size-4" /> Ver catálogo</Button>
            </Link>
          </>
        }
      />

      {data && (
        <div className="tf-card flex flex-wrap items-center gap-2.5 p-4">
          <StatusBadge value={data.partner.status} dict={GENERIC_STATUS} />
          <Pill tone="accent">{PARTNER_TYPE[data.partner.partner_type || ""]?.label || "Partner"}</Pill>
          <Pill tone="info" className="tf-num">Comisión base {formatNumber(data.partner.default_commission_pct ?? 0, 1)}%</Pill>
          <Pill tone="neutral" className="tf-num">Crédito {money(data.partner.credit_limit)} · {data.partner.credit_days ?? 0} días</Pill>
          <span className="ml-auto text-xs text-muted-foreground">{data.period.label}</span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </div>
      ) : !data ? (
        <EmptyState
          icon="TriangleAlert"
          title="No se pudo cargar tu portal"
          description={partnerId ? "Vuelve a intentarlo en unos segundos." : "Tu usuario todavía no está asociado a ningún partner. Contacta con el operador."}
          action={<Button variant="outline" onClick={load} className="gap-1.5"><Icon name="RefreshCw" className="size-4" /> Reintentar</Button>}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard tone="primary" icon="ShoppingBag" label="Ventas del período" value={money(data.kpis.sales)}
              hint={`${formatNumber(data.kpis.bookings)} reservas · ticket medio ${money(data.kpis.average_ticket)}`} />
            <KpiCard icon="Users" label="Pasajeros" value={formatNumber(data.kpis.pax)}
              hint={`${formatNumber(data.kpis.cancellations)} cancelaciones`} />
            <KpiCard tone="amber" icon="Percent" label="Comisión generada" value={money(data.kpis.commission_earned)}
              hint={`${money(data.kpis.commission_pending)} aún por liquidar`} />
            <KpiCard icon="Wallet" label="Saldo pendiente" value={money(data.kpis.balance)}
              hint={`Crédito disponible ${money(data.kpis.credit_available)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <section className="tf-card p-5">
              <h2 className="mb-4 font-display text-base font-semibold">Tus excursiones más vendidas</h2>
              <BarList
                data={data.top_products.map((p) => ({ label: p.label, value: p.sales }))}
                formatter={(v) => money(v)}
              />
              {data.top_products.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                  {data.top_products.slice(0, 5).map((p) => (
                    <li key={p.label} className="flex items-center justify-between gap-3">
                      <span className="truncate">{p.label}</span>
                      <span className="tf-num shrink-0">
                        {formatNumber(p.bookings)} reservas · {formatNumber(p.pax)} pax
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="tf-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold">Estado de cuenta</h2>
                <Link href="/portal/liquidaciones" className="text-xs font-semibold text-primary hover:underline">
                  Ver liquidaciones
                </Link>
              </div>
              {data.receivables.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No tienes documentos pendientes de pago.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.receivables.slice(0, 6).map((r: any) => (
                    <li key={r._id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.document_number || "Documento"}</p>
                        <p className="text-xs text-muted-foreground">Vence {formatDate(r.due_date)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tf-num text-sm">{money(r.balance)}</p>
                        <StatusBadge value={r.status} dict={GENERIC_STATUS} dot={false} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="tf-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold">Últimas reservas</h2>
              <Link href="/portal/reservas" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>
            </div>
            {data.recent_bookings.length === 0 ? (
              <EmptyState icon="CalendarCheck" title="Todavía no has vendido nada en este período"
                description="Consulta el catálogo para ver disponibilidad y precios netos." />
            ) : (
              <div className="tf-scroll overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 font-semibold">Localizador</th>
                      <th className="pb-2 font-semibold">Excursión</th>
                      <th className="pb-2 font-semibold">Cliente</th>
                      <th className="pb-2 font-semibold">Fecha</th>
                      <th className="pb-2 text-right font-semibold">Pax</th>
                      <th className="pb-2 text-right font-semibold">Importe</th>
                      <th className="pb-2 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.recent_bookings.slice(0, 12).map((b: any) => (
                      <tr key={b._id}>
                        <td className="py-2.5 font-mono text-xs">{b.booking_number || "—"}</td>
                        <td className="py-2.5">{typeof b.product === "object" && b.product ? b.product.name : "—"}</td>
                        <td className="py-2.5 text-muted-foreground">
                          {typeof b.customer === "object" && b.customer
                            ? [b.customer.first_name, b.customer.last_name].filter(Boolean).join(" ")
                            : "—"}
                        </td>
                        <td className="py-2.5">{formatDate(b.travel_date)}</td>
                        <td className="tf-num py-2.5 text-right">{b.pax_total ?? 0}</td>
                        <td className="tf-num py-2.5 text-right">{money(b.total_amount)}</td>
                        <td className="py-2.5"><StatusBadge value={b.status} dict={BOOKING_STATUS} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.settlements.length > 0 && (
            <section className="tf-card p-5">
              <h2 className="mb-4 font-display text-base font-semibold">Liquidaciones recientes</h2>
              <ul className="divide-y divide-border">
                {data.settlements.slice(0, 5).map((s: any) => (
                  <li key={s._id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.code || "Liquidación"}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(s.period_from)} – {formatDate(s.period_to)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tf-num text-sm">{money(s.commission_total)}</span>
                      <StatusBadge value={s.status} dict={SETTLEMENT_STATUS} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
