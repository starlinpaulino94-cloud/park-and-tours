"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BOOKING_STATUS, CHANNEL, CHECKIN_STATUS, PAYMENT_METHOD, VOUCHER_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatTime, parseJson } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

interface Booking {
  _id: string; booking_number?: string; voucher_code?: string;
  status?: string; checkin_status?: string; channel?: string;
  booking_date?: string; travel_date?: string;
  adults?: number; children?: number; infants?: number; pax_total?: number; checked_in_pax?: number;
  unit_price?: number; gross_amount?: number; discount_amount?: number; tax_amount?: number;
  total_amount?: number; cost_amount?: number; margin_amount?: number;
  paid_amount?: number; balance_amount?: number; refund_amount?: number;
  currency?: string; price_snapshot?: any;
  pickup_time?: string; pickup_location?: string; room_number?: string;
  notes?: string; internal_notes?: string; cancel_reason?: string;
  customer?: any; product?: any; departure?: any; modality?: any;
  seller?: any; partner?: any; pickup_hotel?: any; order?: any;
  participant?: any[]; voucher?: any[]; commission?: any[]; payment?: any[];
}

export default function BookingsPage() {
  const searchParams = useSearchParams();
  const departureFilter = searchParams.get("departure");

  const [rows, setRows] = useState<Booking[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [channelFilter, setChannelFilter] = useState("__all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const [detail, setDetail] = useState<Booking | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [refundOverride, setRefundOverride] = useState("");

  const [paying, setPaying] = useState<Booking | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (search) params.set("q", search);
    if (statusFilter !== "__all") params.set("filter.status", statusFilter);
    if (channelFilter !== "__all") params.set("filter.channel", channelFilter);
    if (departureFilter) params.set("filter.departure", departureFilter);
    if (from || to) {
      params.set("dateField", "travel_date");
      if (from) params.set("from", from);
      if (to) params.set("to", `${to}T23:59:59`);
    }

    const res = await api.get<Booking[]>(`/api/erp/booking?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[reservas] error cargando el listado:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las reservas");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
  }, [search, statusFilter, channelFilter, from, to, page, departureFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  // The list is a projection; the drawer needs the fully expanded record.
  const openDetail = async (b: Booking) => {
    setDetail(b);
    setDetailLoading(true);
    const res = await api.get<Booking>(`/api/erp/booking/${b._id}`);
    setDetailLoading(false);
    if (!res.ok) {
      console.error("[reservas] error cargando el detalle:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la reserva");
      return;
    }
    setDetail(res.data || b);
  };

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    const res = await api.post<{ refund: number; refund_pct: number; policy: string; commissions_voided: number }>(
      `/api/bookings/${cancelling._id}/cancel`,
      {
        reason: cancelReason || undefined,
        refund_override: refundOverride !== "" ? Number(refundOverride) : undefined,
      }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[reservas] error cancelando la reserva:", res.error);
      toast.error(res.error?.message || "No se pudo cancelar la reserva");
      return;
    }
    toast.success(
      `Reserva cancelada · reembolso ${formatMoney(res.data?.refund ?? 0, cancelling.currency)} (${res.data?.refund_pct}% — ${res.data?.policy})`
    );
    setCancelling(null);
    setCancelReason("");
    setRefundOverride("");
    setDetail(null);
    load();
  };

  const registerPayment = async () => {
    if (!paying) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("El importe debe ser mayor que cero"); return; }
    setBusy(true);
    const res = await api.post("/api/payments", {
      booking_id: paying._id,
      amount,
      method: payMethod,
      payment_type: "payment",
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[reservas] error registrando el cobro:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el cobro");
      return;
    }
    toast.success("Cobro registrado");
    setPaying(null);
    setPayAmount("");
    setDetail(null);
    load();
  };

  const currency = rows[0]?.currency || "usd";
  const live = rows.filter((b) => !["cancelled", "refunded", "draft"].includes(b.status || ""));
  const sales = live.reduce((s, b) => s + (b.total_amount ?? 0), 0);
  const pendingBalance = live.reduce((s, b) => s + (b.balance_amount ?? 0), 0);
  const pax = live.reduce((s, b) => s + (b.pax_total ?? 0), 0);
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const snapshot = detail ? parseJson<any>(detail.price_snapshot, null) : null;
  const customerName = (b?: Booking | null) =>
    b && typeof b.customer === "object" && b.customer
      ? [b.customer.first_name, b.customer.last_name].filter(Boolean).join(" ") || "Sin nombre"
      : "Sin cliente";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comercial"
        title="Reservas"
        description="Cada reserva conserva el snapshot del precio con el que se vendió: cambiar la tarifa hoy no altera lo ya facturado."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Link href="/dashboard/pos">
              <Button className="gap-1.5"><Icon name="Plus" className="size-4" /> Nueva venta</Button>
            </Link>
          </>
        }
      />

      {departureFilter && (
        <div className="tf-card flex items-center gap-2 border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
          <Icon name="Filter" className="size-4 text-primary" />
          Mostrando solo las reservas de una salida concreta.
          <Link href="/dashboard/reservas" className="ml-auto text-xs font-semibold text-primary hover:underline">
            Quitar el filtro
          </Link>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="CalendarCheck" label="Reservas en pantalla" value={formatNumber(rows.length)}
          hint={`${formatNumber(total)} en total con estos filtros`} />
        <KpiCard tone="ink" icon="Banknote" label="Facturado" value={formatMoney(sales, currency)}
          hint={`${formatNumber(pax)} pasajeros`} />
        <KpiCard tone="amber" icon="Clock" label="Saldo pendiente" value={formatMoney(pendingBalance, currency)}
          hint="Reservas sin cobrar por completo" />
        <KpiCard icon="Ticket" label="Ticket medio"
          value={formatMoney(live.length ? sales / live.length : 0, currency)}
          hint={`${formatNumber(rows.filter((b) => ["cancelled", "refunded"].includes(b.status || "")).length)} canceladas`} />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9"
            placeholder="Buscar por número de reserva, voucher o habitación…" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(BOOKING_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Canal: todos</SelectItem>
            {optionsFrom(CHANNEL).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <Label className="text-xs">Viaje desde</Label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-[145px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-[145px]" />
        </div>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={openDetail}
        emptyIcon="CalendarCheck"
        emptyTitle="Todavía no hay reservas"
        emptyDescription="Registra la primera venta desde el punto de venta para verla aquí."
        columns={[
          {
            key: "booking", header: "Reserva",
            render: (b: Booking) => (
              <div>
                <p className="font-mono text-[12px] font-semibold">{b.booking_number}</p>
                <p className="text-sm font-semibold">{customerName(b)}</p>
              </div>
            ),
          },
          {
            key: "product", header: "Excursión",
            render: (b: Booking) => (
              <div>
                <p className="font-medium">{typeof b.product === "object" && b.product ? b.product.name : "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {typeof b.modality === "object" && b.modality ? b.modality.name : ""}
                </p>
              </div>
            ),
          },
          {
            key: "travel", header: "Viaje", hideOn: "md",
            render: (b: Booking) => (
              <div className="text-xs">
                <p className="font-medium">{formatDate(b.travel_date)}</p>
                <p className="text-muted-foreground">
                  {typeof b.departure === "object" && b.departure ? formatTime(b.departure.departure_at) : ""}
                </p>
              </div>
            ),
          },
          { key: "pax", header: "Pax", align: "right", hideOn: "sm", render: (b: Booking) => formatNumber(b.pax_total ?? 0) },
          { key: "channel", header: "Canal", hideOn: "lg",
            render: (b: Booking) => <StatusBadge value={b.channel} dict={CHANNEL} dot={false} /> },
          { key: "total", header: "Total", align: "right",
            render: (b: Booking) => <span className="font-semibold">{formatMoney(b.total_amount ?? 0, b.currency)}</span> },
          {
            key: "balance", header: "Saldo", align: "right", hideOn: "sm",
            render: (b: Booking) => {
              const bal = b.balance_amount ?? 0;
              if (bal <= 0.009) return <Pill tone="success">Pagada</Pill>;
              return <span className="font-semibold text-amber-700 dark:text-amber-400">{formatMoney(bal, b.currency)}</span>;
            },
          },
          { key: "status", header: "Estado", render: (b: Booking) => <StatusBadge value={b.status} dict={BOOKING_STATUS} /> },
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

      {/* ---- detail drawer ---------------------------------------------- */}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">{detail?.booking_number}</SheetTitle>
            <SheetDescription>
              {customerName(detail)} · {typeof detail?.product === "object" && detail?.product ? detail.product.name : ""}
            </SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="space-y-5 px-4 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={detail.status} dict={BOOKING_STATUS} />
                <StatusBadge value={detail.checkin_status} dict={CHECKIN_STATUS} />
                <StatusBadge value={detail.channel} dict={CHANNEL} dot={false} />
                {detailLoading && <Icon name="LoaderCircle" className="size-4 animate-spin text-muted-foreground" />}
              </div>

              <section className="tf-card divide-y divide-border">
                <Row label="Fecha de viaje" value={`${formatDate(detail.travel_date)}${
                  typeof detail.departure === "object" && detail.departure ? ` · ${formatTime(detail.departure.departure_at)}` : ""}`} />
                <Row label="Vendida el" value={formatDateTime(detail.booking_date)} />
                <Row label="Pasajeros" value={`${formatNumber(detail.pax_total ?? 0)} (${detail.adults ?? 0} ad · ${detail.children ?? 0} ni · ${detail.infants ?? 0} inf)`} />
                <Row label="Modalidad" value={typeof detail.modality === "object" && detail.modality ? detail.modality.name : "—"} />
                <Row label="Vendedor" value={typeof detail.seller === "object" && detail.seller
                  ? [detail.seller.first_name, detail.seller.last_name].filter(Boolean).join(" ") : "Venta directa"} />
                <Row label="Partner" value={typeof detail.partner === "object" && detail.partner
                  ? detail.partner.commercial_name || detail.partner.name : "Venta propia"} />
                <Row label="Hotel / recogida" value={`${typeof detail.pickup_hotel === "object" && detail.pickup_hotel ? detail.pickup_hotel.name : "—"}${
                  detail.room_number ? ` · hab. ${detail.room_number}` : ""}${detail.pickup_time ? ` · ${detail.pickup_time}` : ""}`} />
                <Row label="Voucher" value={detail.voucher_code || "—"} mono />
              </section>

              <section className="tf-card divide-y divide-border">
                <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Desglose económico
                </p>
                <Row label="Precio unitario" value={formatMoney(detail.unit_price ?? 0, detail.currency)} />
                <Row label="Importe bruto" value={formatMoney(detail.gross_amount ?? 0, detail.currency)} />
                <Row label="Descuento" value={`− ${formatMoney(detail.discount_amount ?? 0, detail.currency)}`} />
                <Row label="Impuestos" value={formatMoney(detail.tax_amount ?? 0, detail.currency)} />
                <Row label="Total" value={formatMoney(detail.total_amount ?? 0, detail.currency)} strong />
                <Row label="Coste" value={formatMoney(detail.cost_amount ?? 0, detail.currency)} />
                <Row label="Margen" value={`${formatMoney(detail.margin_amount ?? 0, detail.currency)} (${
                  (detail.total_amount ?? 0) > 0 ? formatPercent(((detail.margin_amount ?? 0) / (detail.total_amount ?? 1)) * 100) : "0%"})`} />
                <Row label="Cobrado" value={formatMoney(detail.paid_amount ?? 0, detail.currency)} />
                <Row label="Saldo pendiente" value={formatMoney(detail.balance_amount ?? 0, detail.currency)} strong />
                {(detail.refund_amount ?? 0) > 0 && (
                  <Row label="Reembolsado" value={formatMoney(detail.refund_amount ?? 0, detail.currency)} />
                )}
              </section>

              {snapshot && (
                <section className="tf-card p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Snapshot del precio aplicado
                  </p>
                  <p className="mt-1 text-sm">
                    {snapshot.applied_rule_name || "Precio base del producto"}
                    {snapshot.rule_type ? ` · ${snapshot.rule_type}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Este cálculo queda congelado: aunque cambies la tarifa, esta reserva mantiene su importe.
                  </p>
                </section>
              )}

              {(detail.participant || []).length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-display text-sm font-semibold">Participantes ({detail.participant?.length})</h3>
                  <ul className="tf-card divide-y divide-border">
                    {detail.participant?.map((p: any) => (
                      <li key={p._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{p.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[p.category, p.age ? `${p.age} años` : null, p.document_id].filter(Boolean).join(" · ") || "Sin datos"}
                          </p>
                        </div>
                        <StatusBadge value={p.checkin_status} dict={CHECKIN_STATUS} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(detail.payment || []).length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-display text-sm font-semibold">Pagos ({detail.payment?.length})</h3>
                  <ul className="tf-card divide-y divide-border">
                    {detail.payment?.map((p: any) => (
                      <li key={p._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="font-mono text-[12px]">{p.reference}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(p.paid_at)} · {PAYMENT_METHOD[p.method || ""]?.label || p.method}
                          </p>
                        </div>
                        <span className={p.payment_type === "refund"
                          ? "font-semibold text-rose-600 dark:text-rose-400"
                          : "font-semibold text-emerald-600 dark:text-emerald-400"}>
                          {p.payment_type === "refund" ? "−" : "+"}{formatMoney(p.amount ?? 0, p.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(detail.commission || []).length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-display text-sm font-semibold">Comisiones generadas</h3>
                  <ul className="tf-card divide-y divide-border">
                    {detail.commission?.map((c: any) => (
                      <li key={c._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.beneficiary_name || "Beneficiario"}</p>
                          <p className="text-xs text-muted-foreground">{formatPercent(c.percentage ?? 0)} sobre {formatMoney(c.base_amount ?? 0, c.currency)}</p>
                        </div>
                        <span className="font-semibold">{formatMoney(c.amount ?? 0, c.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(detail.voucher || []).length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-display text-sm font-semibold">Vouchers</h3>
                  <ul className="tf-card divide-y divide-border">
                    {detail.voucher?.map((v: any) => (
                      <li key={v._id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <p className="font-mono text-[12px] font-semibold">{v.code}</p>
                        <StatusBadge value={v.status} dict={VOUCHER_STATUS} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(detail.notes || detail.internal_notes || detail.cancel_reason) && (
                <section className="tf-card space-y-2 p-4">
                  {detail.notes && <p className="text-sm"><span className="text-muted-foreground">Notas: </span>{detail.notes}</p>}
                  {detail.internal_notes && <p className="text-sm"><span className="text-muted-foreground">Internas: </span>{detail.internal_notes}</p>}
                  {detail.cancel_reason && <p className="text-sm text-rose-700 dark:text-rose-400">
                    <span className="text-muted-foreground">Motivo de cancelación: </span>{detail.cancel_reason}</p>}
                </section>
              )}

              <div className="flex flex-wrap gap-2">
                {(detail.balance_amount ?? 0) > 0.009 && (
                  <Button className="gap-1.5" onClick={() => { setPaying(detail); setPayAmount(String(detail.balance_amount ?? "")); }}>
                    <Icon name="CreditCard" className="size-4" /> Cobrar saldo
                  </Button>
                )}
                <Link href={`/dashboard/checkin?code=${detail.voucher_code || detail.booking_number || ""}`}>
                  <Button variant="outline" className="gap-1.5"><Icon name="ScanLine" className="size-4" /> Check-in</Button>
                </Link>
                {!["cancelled", "refunded"].includes(detail.status || "") && (
                  <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => setCancelling(detail)}>
                    <Icon name="Ban" className="size-4" /> Cancelar reserva
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ---- cancel ------------------------------------------------------ */}
      <Dialog open={!!cancelling} onOpenChange={(v) => !v && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar {cancelling?.booking_number}</DialogTitle>
            <DialogDescription>
              El reembolso se calcula con la política de cancelación del producto según las horas que faltan
              para la salida. Se liberará la plaza y se anularán las comisiones asociadas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
              <p className="flex justify-between"><span className="text-muted-foreground">Total</span>
                <span className="font-semibold">{formatMoney(cancelling?.total_amount ?? 0, cancelling?.currency)}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">Cobrado</span>
                <span className="font-semibold">{formatMoney(cancelling?.paid_amount ?? 0, cancelling?.currency)}</span></p>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Cliente enfermo, mal tiempo, cambio de planes…" />
            </div>
            <div className="space-y-1.5">
              <Label>Reembolso manual (opcional)</Label>
              <Input type="number" step="0.01" value={refundOverride} onChange={(e) => setRefundOverride(e.target.value)}
                placeholder="Dejar vacío para aplicar la política" />
              <p className="text-xs text-muted-foreground">
                Forzar un importe distinto al de la política requiere permisos de gerencia y queda auditado.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>Volver</Button>
            <Button onClick={cancel} disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? "Cancelando…" : "Cancelar reserva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- collect balance -------------------------------------------- */}
      <Dialog open={!!paying} onOpenChange={(v) => !v && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobrar {paying?.booking_number}</DialogTitle>
            <DialogDescription>
              Saldo pendiente de {formatMoney(paying?.balance_amount ?? 0, paying?.currency)}.
              Para cobrar en efectivo necesitas una caja abierta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Importe</Label>
              <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Método</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(PAYMENT_METHOD).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>Cancelar</Button>
            <Button onClick={registerPayment} disabled={busy}>{busy ? "Cobrando…" : "Registrar cobro"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm ${strong ? "font-display text-base font-semibold" : "font-medium"} ${mono ? "font-mono text-[12px]" : ""} tabular-nums`}>
        {value}
      </span>
    </div>
  );
}
