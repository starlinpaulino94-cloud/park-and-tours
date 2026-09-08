"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QUOTE_STATUS, QUOTE_TYPE } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

interface QuoteLine {
  _id: string; description?: string; quantity?: number; unit_price?: number;
  unit_cost?: number; discount_percent?: number; line_total?: number;
  service_date?: string; product?: any;
}
interface Quote {
  _id: string; code?: string; status?: string; quote_type?: string;
  issued_at?: string; valid_until?: string; event_date?: string; sent_at?: string; decided_at?: string;
  pax?: number; subtotal?: number; discount?: number; tax?: number; total?: number;
  currency?: string; margin_percent?: number | null;
  terms?: string; notes?: string; rejection_reason?: string;
  customer?: any; partner?: any; seller?: any; order?: any;
  quote_line?: QuoteLine[];
}

const DAY = 86_400_000;
const SOON_DAYS = 7;

/** Aún en juego: se puede ganar o perder. */
const OPEN_STATUSES = new Set(["draft", "sent", "negotiating"]);
/** Ganadas. */
const WON_STATUSES = new Set(["accepted", "converted"]);
/** Ya resueltas de una u otra forma. */
const DECIDED_STATUSES = new Set(["accepted", "converted", "rejected", "expired"]);

const isOpen = (q: Quote) => OPEN_STATUSES.has(q.status || "");
const expired = (q: Quote) => Boolean(q.valid_until && new Date(q.valid_until).getTime() < Date.now());
const expiringSoon = (q: Quote) =>
  Boolean(q.valid_until) && !expired(q) &&
  new Date(q.valid_until!).getTime() - Date.now() <= SOON_DAYS * DAY;
/** Vigente de verdad: abierta y todavía dentro de plazo. */
const live = (q: Quote) => isOpen(q) && !expired(q);

const VALIDITY_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "live", label: "Vigentes" },
  { value: "soon", label: "Por vencer" },
  { value: "expired", label: "Vencidas" },
] as const;
type ValidityFilter = (typeof VALIDITY_FILTERS)[number]["value"];

/**
 * Vigencia real de la cotización.
 *
 * `status` es un campo almacenado: una cotización pasada de `valid_until` sigue
 * diciendo "Enviada" hasta que alguien la marque expirada. Aquí manda la fecha.
 */
function ValidityPill({ q }: { q: Quote }) {
  if (!isOpen(q)) return null;
  if (expired(q)) return <Pill tone="danger">Vencida</Pill>;
  if (expiringSoon(q)) return <Pill tone="warning">Por vencer</Pill>;
  return null;
}

const customerName = (q?: Quote | null) => {
  const c = q && typeof q.customer === "object" ? q.customer : null;
  if (!c) return "Sin cliente";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.commercial_name || c.name || "Sin nombre";
};

const PAGE_SIZE = 50;

export default function QuotesPage() {
  const [rows, setRows] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [typeFilter, setTypeFilter] = useState("__all");
  const [validity, setValidity] = useState<ValidityFilter>("all");
  const [page, setPage] = useState(0);

  const [detail, setDetail] = useState<Quote | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (statusFilter !== "__all") p.set("filter.status", statusFilter);
    if (typeFilter !== "__all") p.set("filter.quote_type", typeFilter);
    return p;
  }, [search, statusFilter, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = filterParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    const res = await api.get<Quote[]>(`/api/erp/quote?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[cotizaciones] error cargando el listado:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las cotizaciones");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
  }, [filterParams, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  // El listado es una proyección; el detalle trae las líneas expandidas.
  const openDetail = async (row: Quote) => {
    setDetail(row);
    setDetailLoading(true);
    const res = await api.get<Quote>(`/api/erp/quote/${row._id}`);
    setDetailLoading(false);
    if (!res.ok) {
      console.error("[cotizaciones] error cargando el detalle:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la cotización");
      return;
    }
    setDetail(res.data || row);
  };

  // La vigencia se deriva en el cliente, así que el filtro actúa sobre la página.
  const visibleRows = useMemo(() => {
    if (validity === "all") return rows;
    return rows.filter((row) => {
      if (validity === "live") return live(row);
      if (validity === "soon") return live(row) && expiringSoon(row);
      return isOpen(row) && expired(row);
    });
  }, [rows, validity]);

  const exportCsv = async () => {
    setExporting(true);
    const params = filterParams();
    params.set("bulk", "true");
    params.set("limit", "500");
    params.set("includeTotal", "false");
    const res = await api.get<Quote[]>(`/api/erp/quote?${params}`);
    setExporting(false);
    if (!res.ok || !res.data) {
      toast.error(res.error?.message || "No se pudo exportar");
      return;
    }
    const data = res.data;
    if (data.length === 0) { toast.error("No hay cotizaciones que exportar con estos filtros"); return; }
    const headers = ["Cotización", "Cliente", "Tipo", "Estado", "Vigencia real", "Emitida", "Vigente hasta", "Evento", "Pax", "Subtotal", "Descuento", "Impuestos", "Total", "Margen %", "Moneda"];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const realState = (row: Quote) =>
      !isOpen(row) ? (QUOTE_STATUS[row.status || ""]?.label || row.status || "")
        : expired(row) ? "Vencida" : expiringSoon(row) ? "Por vencer" : "Vigente";
    const lines = data.map((row) => [
      row.code ?? "", customerName(row),
      QUOTE_TYPE[row.quote_type || ""]?.label || row.quote_type || "",
      QUOTE_STATUS[row.status || ""]?.label || row.status || "",
      realState(row),
      row.issued_at ? formatDate(row.issued_at) : "",
      row.valid_until ? formatDate(row.valid_until) : "",
      row.event_date ? formatDate(row.event_date) : "",
      row.pax ?? 0, row.subtotal ?? 0, row.discount ?? 0, row.tax ?? 0, row.total ?? 0,
      row.margin_percent ?? "",
      (row.currency || "").toUpperCase(),
    ].map(cell).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cotizaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${data.length} cotización${data.length === 1 ? "" : "es"} exportada${data.length === 1 ? "" : "s"}`);
  };

  const currency = rows.find((r) => r.currency)?.currency || "usd";
  const openValue = rows.filter(live).reduce((s, r) => s + (r.total ?? 0), 0);
  const wonValue = rows.filter((r) => WON_STATUSES.has(r.status || "")).reduce((s, r) => s + (r.total ?? 0), 0);
  const decided = rows.filter((r) => DECIDED_STATUSES.has(r.status || "")).length;
  const won = rows.filter((r) => WON_STATUSES.has(r.status || "")).length;
  const conversion = decided > 0 ? Math.round((won / decided) * 100) : 0;
  const soonCount = rows.filter((r) => live(r) && expiringSoon(r)).length;
  const staleExpired = rows.filter((r) => isOpen(r) && expired(r)).length;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotizaciones"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={exportCsv} disabled={exporting || loading}>
              <Icon name="Download" className="size-4" /> {exporting ? "Exportando…" : "Exportar"}
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="FileText" label="En juego" value={formatMoney(openValue, currency)}
          hint="Vigentes y sin decidir · en esta página"
          definition="Suma del total de las cotizaciones abiertas que siguen dentro de su plazo." />
        <KpiCard tone="ink" icon="CircleCheck" label="Ganado" value={formatMoney(wonValue, currency)}
          hint={`${formatNumber(won)} aceptadas o convertidas`} />
        <KpiCard icon="TrendingUp" label="Tasa de conversión" value={`${conversion}%`}
          hint={`${formatNumber(won)} de ${formatNumber(decided)} decididas`}
          definition="Aceptadas o convertidas sobre el total de cotizaciones ya resueltas (incluye rechazadas y expiradas)." />
        <KpiCard tone="amber" icon="Clock" label="Por vencer" value={formatNumber(soonCount)}
          hint={staleExpired > 0 ? `${formatNumber(staleExpired)} ya vencidas sin cerrar` : `Vencen en ${SOON_DAYS} días o menos`} />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9"
            placeholder="Buscar por código o notas…" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(QUOTE_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tipo: todos</SelectItem>
            {optionsFrom(QUOTE_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtro por vigencia">
          {VALIDITY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setValidity(f.value)}
              aria-pressed={validity === f.value}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                validity === f.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        rows={visibleRows}
        loading={loading}
        onRowClick={openDetail}
        emptyIcon="FileText"
        emptyTitle="No hay cotizaciones con estos filtros"
        emptyDescription="Las propuestas para grupos, corporativos y eventos aparecen aquí antes de convertirse en venta."
        columns={[
          {
            key: "code", header: "Cotización",
            render: (row: Quote) => (
              <div>
                <p className="tf-num font-semibold">{row.code || "—"}</p>
                <p className="text-xs text-muted-foreground">{customerName(row)}</p>
              </div>
            ),
          },
          { key: "type", header: "Tipo", hideOn: "md",
            render: (row: Quote) => <StatusBadge value={row.quote_type} dict={QUOTE_TYPE} dot={false} /> },
          { key: "pax", header: "Pax", align: "right", hideOn: "sm",
            render: (row: Quote) => formatNumber(row.pax ?? 0) },
          { key: "total", header: "Total", align: "right",
            render: (row: Quote) => <span className="font-semibold">{formatMoney(row.total ?? 0, row.currency || currency)}</span> },
          {
            key: "margin", header: "Margen", align: "right", hideOn: "lg",
            render: (row: Quote) =>
              row.margin_percent == null
                ? <span className="text-muted-foreground">—</span>
                : <span className="tf-num">{formatPercent(row.margin_percent)}</span>,
          },
          {
            key: "valid", header: "Vigencia", hideOn: "sm",
            render: (row: Quote) => (
              <div className="text-xs">
                <p className="tf-num">{row.valid_until ? formatDate(row.valid_until) : "Sin plazo"}</p>
                <ValidityPill q={row} />
              </div>
            ),
          },
          { key: "status", header: "Estado", render: (row: Quote) => <StatusBadge value={row.status} dict={QUOTE_STATUS} /> },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} cotización{total === 1 ? "" : "es"} · página {page + 1} de {pages}
              {validity !== "all" && ` · ${visibleRows.length} en pantalla tras el filtro de vigencia`}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      {/* ---- detalle con el desglose de líneas -------------------------- */}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="tf-num text-base">{detail?.code}</SheetTitle>
            <SheetDescription>{customerName(detail)}</SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="space-y-5 px-4 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={detail.status} dict={QUOTE_STATUS} />
                <StatusBadge value={detail.quote_type} dict={QUOTE_TYPE} dot={false} />
                <ValidityPill q={detail} />
                {detailLoading && <Icon name="LoaderCircle" className="size-4 animate-spin text-muted-foreground" />}
              </div>

              <section className="tf-card divide-y divide-border">
                <Row label="Emitida" value={detail.issued_at ? formatDate(detail.issued_at) : "—"} />
                <Row label="Enviada" value={detail.sent_at ? formatDate(detail.sent_at) : "—"} />
                <Row label="Vigente hasta" value={detail.valid_until ? formatDate(detail.valid_until) : "Sin plazo"} />
                <Row label="Fecha del evento" value={detail.event_date ? formatDate(detail.event_date) : "—"} />
                <Row label="Pasajeros" value={formatNumber(detail.pax ?? 0)} />
                <Row label="Vendedor" value={typeof detail.seller === "object" && detail.seller
                  ? [detail.seller.first_name, detail.seller.last_name].filter(Boolean).join(" ") : "—"} />
                {typeof detail.order === "object" && detail.order && (
                  <Row label="Orden generada" value={detail.order.order_number || "—"} mono />
                )}
              </section>

              <section className="tf-card divide-y divide-border">
                <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Desglose económico
                </p>
                <Row label="Subtotal" value={formatMoney(detail.subtotal ?? 0, detail.currency)} />
                <Row label="Descuento" value={`− ${formatMoney(detail.discount ?? 0, detail.currency)}`} />
                <Row label="Impuestos" value={formatMoney(detail.tax ?? 0, detail.currency)} />
                <Row label="Total" value={formatMoney(detail.total ?? 0, detail.currency)} strong />
                <Row label="Margen" value={detail.margin_percent == null ? "Sin calcular" : formatPercent(detail.margin_percent)} />
              </section>

              {(detail.quote_line || []).length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-display text-sm font-semibold">Líneas ({detail.quote_line?.length})</h3>
                  <ul className="tf-card divide-y divide-border">
                    {detail.quote_line?.map((l) => (
                      <li key={l._id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {l.description || (typeof l.product === "object" && l.product ? l.product.name : "Línea")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(l.quantity ?? 0)} × {formatMoney(l.unit_price ?? 0, detail.currency)}
                            {l.discount_percent ? ` · −${formatPercent(l.discount_percent)}` : ""}
                            {l.service_date ? ` · ${formatDate(l.service_date)}` : ""}
                          </p>
                        </div>
                        <span className="tf-num shrink-0 font-semibold">
                          {formatMoney(l.line_total ?? 0, detail.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(detail.terms || detail.notes || detail.rejection_reason) && (
                <section className="tf-card space-y-2 p-4">
                  {detail.terms && <p className="text-sm"><span className="text-muted-foreground">Condiciones: </span>{detail.terms}</p>}
                  {detail.notes && <p className="text-sm"><span className="text-muted-foreground">Notas: </span>{detail.notes}</p>}
                  {detail.rejection_reason && (
                    <p className="text-sm text-rose-700 dark:text-rose-400">
                      <span className="text-muted-foreground">Motivo del rechazo: </span>{detail.rejection_reason}
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={`tf-num text-right text-sm ${strong ? "text-base font-semibold" : ""} ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}
