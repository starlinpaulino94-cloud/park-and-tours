"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BOOKING_STATUS, CHANNEL, CHECKIN_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import type { Booking } from "@/lib/types";

const PAGE_SIZE = 50;

export default function PortalBookingsPage() {
  const { isStaff, partnerId } = usePortal();
  const [rows, setRows] = useState<Booking[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Booking | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    params.set("sort", "-travel_date");
    if (search) params.set("q", search);
    if (status) params.set("filter.status", status);
    // Portal users are filtered server-side; staff previewing must scope explicitly.
    if (isStaff && partnerId) params.set("filter.partner", partnerId);
    if (from || to) {
      params.set("dateField", "travel_date");
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    return `/api/erp/booking?${params.toString()}`;
  }, [search, status, from, to, page, isStaff, partnerId]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Booking[]>(url);
    setLoading(false);
    if (!res.ok) {
      console.error("[portal/reservas] error cargando las reservas:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las reservas");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const live = rows.filter((b) => !["cancelled", "refunded", "draft"].includes(b.status || ""));
  const currency = rows[0]?.currency || "usd";
  const money = (n?: number | null) => formatMoney(n ?? 0, currency);
  const sales = live.reduce((s, b) => s + (b.total_amount ?? 0), 0);
  const pax = live.reduce((s, b) => s + (b.pax_total ?? 0), 0);
  const pending = live.reduce((s, b) => s + (b.balance_amount ?? 0), 0);

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portal B2B"
        title="Mis reservas"
        description="Todas las reservas generadas por tu red comercial, con su estado operativo y su saldo."
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="primary" icon="CalendarCheck" label="Reservas activas" value={formatNumber(live.length)}
          hint={`${formatNumber(rows.length - live.length)} canceladas en la vista`} />
        <KpiCard icon="Users" label="Pasajeros" value={formatNumber(pax)} />
        <KpiCard icon="ShoppingBag" label="Importe" value={money(sales)} />
        <KpiCard tone={pending > 0 ? "coral" : "default"} icon="Wallet" label="Saldo pendiente" value={money(pending)}
          hint={pending > 0 ? "Reservas con importe por cobrar" : "Todo cobrado"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por localizador o voucher…" className="pl-9" />
        </div>
        <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(BOOKING_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-[150px]" aria-label="Viaje desde" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-[150px]" aria-label="Viaje hasta" />
        {(from || to || status || q) && (
          <Button variant="ghost" className="gap-1.5" onClick={() => { setFrom(""); setTo(""); setStatus(""); setQ(""); setPage(0); }}>
            <Icon name="X" className="size-4" /> Limpiar
          </Button>
        )}
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={(b) => setDetail(b)}
        emptyIcon="CalendarCheck"
        emptyTitle="Todavía no hay reservas"
        emptyDescription="Cuando el operador confirme una venta tuya, aparecerá aquí automáticamente."
        columns={[
          { key: "code", header: "Localizador", render: (b: any) => (
            <div>
              <p className="font-mono text-xs font-semibold">{b.booking_number || "—"}</p>
              <p className="text-xs text-muted-foreground">{formatDate(b.booking_date)}</p>
            </div>
          ) },
          { key: "product", header: "Excursión", render: (b: any) => (
            <div>
              <p className="font-medium">{typeof b.product === "object" && b.product ? b.product.name : "—"}</p>
              <p className="text-xs text-muted-foreground">
                {typeof b.customer === "object" && b.customer
                  ? [b.customer.first_name, b.customer.last_name].filter(Boolean).join(" ")
                  : "Sin cliente"}
              </p>
            </div>
          ) },
          { key: "travel", header: "Viaje", hideOn: "md", render: (b: any) => formatDate(b.travel_date) },
          { key: "pax", header: "Pax", align: "right", hideOn: "sm", render: (b: any) => formatNumber(b.pax_total ?? 0) },
          { key: "total", header: "Importe", align: "right",
            render: (b: any) => <span className="font-semibold">{formatMoney(b.total_amount ?? 0, b.currency)}</span> },
          { key: "balance", header: "Saldo", align: "right", hideOn: "lg", render: (b: any) =>
            (b.balance_amount ?? 0) > 0.009
              ? <span className="font-semibold text-rose-600 dark:text-rose-400">{formatMoney(b.balance_amount, b.currency)}</span>
              : <span className="text-muted-foreground">—</span> },
          { key: "checkin", header: "Check-in", hideOn: "lg",
            render: (b: any) => <StatusBadge value={b.checkin_status} dict={CHECKIN_STATUS} dot={false} /> },
          { key: "status", header: "Estado", render: (b: any) => <StatusBadge value={b.status} dict={BOOKING_STATUS} /> },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {total} reserva{total === 1 ? "" : "s"} · página {page + 1} de {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">
                  {typeof detail.product === "object" && detail.product ? detail.product.name : "Reserva"}
                </SheetTitle>
                <SheetDescription className="font-mono">{detail.booking_number}</SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={detail.status} dict={BOOKING_STATUS} />
                  <StatusBadge value={detail.checkin_status} dict={CHECKIN_STATUS} />
                  <Pill tone="neutral">{CHANNEL[detail.channel || ""]?.label || "Canal directo"}</Pill>
                </div>

                <section className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="Fecha del viaje" value={formatDate(detail.travel_date)} />
                  <Info label="Salida" value={
                    typeof detail.departure === "object" && detail.departure
                      ? formatDateTime((detail.departure as any).departure_at) : "—"} />
                  <Info label="Cliente" value={
                    typeof detail.customer === "object" && detail.customer
                      ? [(detail.customer as any).first_name, (detail.customer as any).last_name].filter(Boolean).join(" ")
                      : "—"} />
                  <Info label="Hotel / recogida" value={
                    typeof detail.pickup_hotel === "object" && detail.pickup_hotel
                      ? `${(detail.pickup_hotel as any).name}${detail.room_number ? ` · hab. ${detail.room_number}` : ""}`
                      : detail.pickup_location || "—"} />
                  <Info label="Hora de recogida" value={detail.pickup_time || "Por confirmar"} />
                  <Info label="Voucher" value={detail.voucher_code || "—"} mono />
                </section>

                <section className="tf-card p-4">
                  <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Composición</h4>
                  <ul className="space-y-1.5 text-sm">
                    <Row label="Adultos" value={formatNumber(detail.adults ?? 0)} />
                    <Row label="Niños" value={formatNumber(detail.children ?? 0)} />
                    <Row label="Infantes" value={formatNumber(detail.infants ?? 0)} />
                    <Row label="Total pax" value={formatNumber(detail.pax_total ?? 0)} strong />
                  </ul>
                </section>

                <section className="tf-card p-4">
                  <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Económico</h4>
                  <ul className="space-y-1.5 text-sm">
                    <Row label="Precio unitario" value={formatMoney(detail.unit_price, detail.currency)} />
                    <Row label="Bruto" value={formatMoney(detail.gross_amount, detail.currency)} />
                    <Row label="Descuento" value={`− ${formatMoney(detail.discount_amount, detail.currency)}`} />
                    <Row label="Impuestos" value={formatMoney(detail.tax_amount, detail.currency)} />
                    <Row label="Total" value={formatMoney(detail.total_amount, detail.currency)} strong />
                    <Row label="Pagado" value={formatMoney(detail.paid_amount, detail.currency)} />
                    <Row label="Saldo" value={formatMoney(detail.balance_amount, detail.currency)} strong />
                  </ul>
                </section>

                {detail.notes && (
                  <section>
                    <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Notas</h4>
                    <p className="text-sm text-muted-foreground">{detail.notes}</p>
                  </section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <li className={`flex items-center justify-between gap-3 ${strong ? "border-t border-border pt-1.5 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </li>
  );
}
