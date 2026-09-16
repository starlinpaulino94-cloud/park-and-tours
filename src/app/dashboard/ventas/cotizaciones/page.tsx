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
import { ResourceForm } from "@/components/tf/resource-form";
import { QUOTE_STATUS, QUOTE_TYPE } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import {
  isOpen, isExpired, derivedStatus, WON_STATUSES, DECIDED_STATUSES, depositDue,
} from "@/lib/quotes";
import { QuoteDrawer, customerName, type Quote } from "./quote-drawer";
import { QUOTE_FIELDS } from "./quote-fields";

const DAY = 86_400_000;
const SOON_DAYS = 7;

const expiringSoon = (q: Quote) =>
  Boolean(q.valid_until) && !isExpired(q) &&
  new Date(q.valid_until!).getTime() - Date.now() <= SOON_DAYS * DAY;
/** Vigente de verdad: abierta y todavía dentro de plazo. */
const live = (q: Quote) => isOpen(q) && !isExpired(q);
/** Una revisión reemplazada sigue consultable, pero ya no es negocio vivo. */
const superseded = (q: Quote) => q.status === "superseded";

const VALIDITY_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "live", label: "Vigentes" },
  { value: "soon", label: "Por vencer" },
  { value: "expired", label: "Vencidas" },
  { value: "follow_up", label: "Con seguimiento vencido" },
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
  if (isExpired(q)) return <Pill tone="danger">Vencida</Pill>;
  if (expiringSoon(q)) return <Pill tone="warning">Por vencer</Pill>;
  return null;
}

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
  const [formRecord, setFormRecord] = useState<Quote | null | undefined>(undefined);

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

  // El listado es una proyección; el detalle trae el documento entero.
  const openDetail = useCallback(async (row: Quote) => {
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
  }, []);

  const refreshDetail = useCallback(async () => {
    if (detail) await openDetail(detail);
    void load();
  }, [detail, openDetail, load]);

  // La vigencia se deriva en el cliente, así que el filtro actúa sobre la página.
  const visibleRows = useMemo(() => {
    if (validity === "all") return rows;
    return rows.filter((row) => {
      if (validity === "live") return live(row);
      if (validity === "soon") return live(row) && expiringSoon(row);
      if (validity === "follow_up") {
        return isOpen(row) && Boolean(row.follow_up_at) && new Date(row.follow_up_at!).getTime() < Date.now();
      }
      return isOpen(row) && isExpired(row);
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
    const headers = [
      "Cotización", "Versión", "Título", "Cliente", "Contacto", "Tipo", "Estado", "Vigencia real",
      "Emitida", "Enviada", "Vigente hasta", "Evento", "Pax",
      "Subtotal", "Descuento", "Impuestos", "Total", "Anticipo", "Saldo", "Coste", "Margen %", "Moneda",
    ];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const realState = (row: Quote) =>
      !isOpen(row) ? (QUOTE_STATUS[row.status || ""]?.label || row.status || "")
        : isExpired(row) ? "Vencida" : expiringSoon(row) ? "Por vencer" : "Vigente";
    const lines = data.map((row) => {
      const money = depositDue(row, row.total ?? 0);
      return [
        row.code ?? "", row.version ?? 1, row.title ?? "", customerName(row),
        [row.contact_name, row.contact_email].filter(Boolean).join(" "),
        QUOTE_TYPE[row.quote_type || ""]?.label || row.quote_type || "",
        QUOTE_STATUS[row.status || ""]?.label || row.status || "",
        realState(row),
        row.issued_at ? formatDate(row.issued_at) : "",
        row.sent_at ? formatDate(row.sent_at) : "",
        row.valid_until ? formatDate(row.valid_until) : "",
        row.event_date ? formatDate(row.event_date) : "",
        row.pax ?? 0, row.subtotal ?? 0, row.discount ?? 0, row.tax ?? 0, row.total ?? 0,
        money.deposit, money.balance, row.cost_total ?? 0,
        row.margin_percent ?? "",
        (row.currency || "").toUpperCase(),
      ].map(cell).join(",");
    });
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
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
  // Una versión reemplazada ya se contó en su ronda: sumarla duplicaría el
  // negocio de la misma negociación en el embudo.
  const pipeline = rows.filter((r) => !superseded(r));
  const openValue = pipeline.filter(live).reduce((s, r) => s + (r.total ?? 0), 0);
  const wonValue = pipeline.filter((r) => WON_STATUSES.has(r.status || "")).reduce((s, r) => s + (r.total ?? 0), 0);
  const decided = pipeline.filter((r) => DECIDED_STATUSES.has(r.status || "")).length;
  const won = pipeline.filter((r) => WON_STATUSES.has(r.status || "")).length;
  const conversion = decided > 0 ? Math.round((won / decided) * 100) : 0;
  const soonCount = pipeline.filter((r) => live(r) && expiringSoon(r)).length;
  const staleExpired = pipeline.filter((r) => isOpen(r) && isExpired(r)).length;
  const dueFollowUp = pipeline.filter(
    (r) => isOpen(r) && r.follow_up_at && new Date(r.follow_up_at).getTime() < Date.now()
  ).length;
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
            <Button className="gap-1.5" onClick={() => setFormRecord(null)}>
              <Icon name="Plus" className="size-4" /> Nueva cotización
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="FileText" label="En juego" value={formatMoney(openValue, currency)}
          hint="Vigentes y sin decidir · en esta página"
          definition="Suma del total de las cotizaciones abiertas que siguen dentro de su plazo. Las versiones reemplazadas por una revisión no se cuentan." />
        <KpiCard tone="ink" icon="CircleCheck" label="Ganado" value={formatMoney(wonValue, currency)}
          hint={`${formatNumber(won)} aceptadas o convertidas`} />
        <KpiCard icon="TrendingUp" label="Tasa de conversión" value={`${conversion}%`}
          hint={`${formatNumber(won)} de ${formatNumber(decided)} decididas`}
          definition="Aceptadas o convertidas sobre el total de cotizaciones ya resueltas (incluye rechazadas y expiradas)." />
        <KpiCard tone="amber" icon="Clock" label="Requieren acción" value={formatNumber(soonCount + dueFollowUp)}
          hint={
            staleExpired > 0
              ? `${formatNumber(staleExpired)} ya vencidas sin cerrar`
              : `${formatNumber(soonCount)} por vencer · ${formatNumber(dueFollowUp)} con seguimiento pendiente`
          } />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9"
            placeholder="Buscar por código, título, empresa o contacto…" />
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
                <p className="tf-num font-semibold">
                  {row.code || "—"}
                  {(row.version ?? 1) > 1 && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">v{row.version}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{row.title || customerName(row)}</p>
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
              row.margin_percent === null || row.margin_percent === undefined
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
          {
            key: "status", header: "Estado",
            render: (row: Quote) => <StatusBadge value={derivedStatus(row)} dict={QUOTE_STATUS} />,
          },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} cotización{total === 1 ? "" : "es"} · página {page + 1} de {pages}
              {validity !== "all" && ` · ${visibleRows.length} en pantalla tras el filtro`}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      <QuoteDrawer
        quote={detail}
        loading={detailLoading}
        onClose={() => { setDetail(null); void load(); }}
        onChanged={refreshDetail}
        onEdit={(quote) => setFormRecord(quote)}
      />

      {/* El alta va a /api/quotes: el código del documento lo genera el servidor
          y no puede repetirse ni teclearse. La edición posterior sí es CRUD. */}
      <ResourceForm
        open={formRecord !== undefined}
        onOpenChange={(o) => { if (!o) setFormRecord(undefined); }}
        resource="quote"
        createPath="/api/quotes"
        fields={QUOTE_FIELDS}
        record={formRecord}
        title={formRecord ? "Editar cotización" : "Nueva cotización"}
        description={
          formRecord
            ? "Las condiciones, el anticipo y los plazos son el documento que lee el cliente."
            : "Nace como borrador y sin importe: el total sale de las líneas y alternativas que le añadas después."
        }
        onSaved={() => { setFormRecord(undefined); void refreshDetail(); }}
      />
    </div>
  );
}
