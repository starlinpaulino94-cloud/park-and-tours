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
import { TICKET_STATUS, TICKET_TYPE } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import { expiresWithin, isExhausted, isExpired, isNotYetValid, isUsable } from "@/lib/tickets";

interface Ticket {
  _id: string; code?: string; wristband_code?: string; holder_name?: string;
  ticket_type?: string; status?: string;
  valid_from?: string; valid_to?: string;
  entries_allowed?: number | null; entries_used?: number;
  price?: number; currency?: string;
  customer?: any; product?: any; booking?: any;
}

const SOON_DAYS = 7;

// La vigencia real de un pase se decide en `src/lib/tickets.ts`, que es lo mismo
// que aplica la puerta al validar: si el listado dijera "vigente" y el torniquete
// dijera otra cosa, el cajero no sabría a cuál creerle.
const expired = (t: Ticket) => isExpired(t);
const notYetValid = (t: Ticket) => isNotYetValid(t);
const exhausted = (t: Ticket) => isExhausted(t);
const expiringSoon = (t: Ticket) => expiresWithin(t, SOON_DAYS);
const usable = (t: Ticket) => isUsable(t);

const VALIDITY_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "usable", label: "Vigentes" },
  { value: "soon", label: "Por vencer" },
  { value: "expired", label: "Vencidos" },
] as const;
type ValidityFilter = (typeof VALIDITY_FILTERS)[number]["value"];

/**
 * Vigencia real del ticket.
 *
 * `status` es un campo almacenado que puede quedarse obsoleto: un pase con
 * `valid_to` en el pasado sigue diciendo "Emitido" hasta que algo lo actualice.
 * Aquí la fecha manda, igual que las cuentas por cobrar vencidas del panel.
 */
function ValidityPill({ t }: { t: Ticket }) {
  if (expired(t)) return <Pill tone="danger">Vencido</Pill>;
  if (notYetValid(t)) return <Pill tone="neutral">Aún no vigente</Pill>;
  if (exhausted(t)) return <Pill tone="warning">Agotado</Pill>;
  if (expiringSoon(t)) return <Pill tone="warning">Por vencer</Pill>;
  return null;
}

/** Consumo del pase: usadas sobre permitidas (∞ cuando no tiene tope). */
function UsageBar({ t }: { t: Ticket }) {
  const used = t.entries_used ?? 0;
  const allowed = t.entries_allowed ?? null;
  if (allowed == null) {
    return <span className="tf-num text-xs">{formatNumber(used)}<span className="text-muted-foreground">/∞</span></span>;
  }
  const pct = allowed > 0 ? Math.min(Math.round((used / allowed) * 100), 100) : 0;
  const tone = pct >= 100 ? "bg-coral" : pct >= 75 ? "bg-amber" : "bg-primary";
  return (
    <div className="w-28">
      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
        <span className="tf-num">{formatNumber(used)}/{formatNumber(allowed)}</span>
        <span className="tf-num">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const PAGE_SIZE = 50;

export default function TicketsPage() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [typeFilter, setTypeFilter] = useState("__all");
  const [validity, setValidity] = useState<ValidityFilter>("all");
  const [page, setPage] = useState(0);

  const filterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (statusFilter !== "__all") p.set("filter.status", statusFilter);
    if (typeFilter !== "__all") p.set("filter.ticket_type", typeFilter);
    return p;
  }, [search, statusFilter, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = filterParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    const res = await api.get<Ticket[]>(`/api/erp/access_ticket?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[tickets] error cargando los tickets:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar los tickets");
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

  // La vigencia se deriva en el cliente, así que el filtro se aplica sobre la
  // página cargada (el servidor no conoce "vencido de verdad").
  const visibleRows = useMemo(() => {
    if (validity === "all") return rows;
    return rows.filter((t) => {
      if (validity === "usable") return usable(t);
      if (validity === "soon") return expiringSoon(t) && usable(t);
      return expired(t);
    });
  }, [rows, validity]);

  const exportCsv = async () => {
    setExporting(true);
    const params = filterParams();
    params.set("bulk", "true");
    params.set("limit", "500");
    params.set("includeTotal", "false");
    const res = await api.get<Ticket[]>(`/api/erp/access_ticket?${params}`);
    setExporting(false);
    if (!res.ok || !res.data) {
      toast.error(res.error?.message || "No se pudo exportar");
      return;
    }
    const data = res.data;
    if (data.length === 0) { toast.error("No hay tickets que exportar con estos filtros"); return; }
    const headers = ["Ticket", "Pulsera", "Titular", "Tipo", "Estado", "Vigencia real", "Desde", "Hasta", "Usadas", "Permitidas", "Precio", "Moneda"];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const realState = (t: Ticket) =>
      expired(t) ? "Vencido" : notYetValid(t) ? "Aún no vigente" : exhausted(t) ? "Agotado" : usable(t) ? "Vigente" : "No utilizable";
    const lines = data.map((t) => [
      t.code ?? "", t.wristband_code ?? "", t.holder_name ?? "",
      TICKET_TYPE[t.ticket_type || ""]?.label || t.ticket_type || "",
      TICKET_STATUS[t.status || ""]?.label || t.status || "",
      realState(t),
      t.valid_from ? formatDate(t.valid_from) : "",
      t.valid_to ? formatDate(t.valid_to) : "",
      t.entries_used ?? 0,
      t.entries_allowed ?? "",
      t.price ?? "",
      (t.currency || "").toUpperCase(),
    ].map(cell).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${data.length} ticket${data.length === 1 ? "" : "s"} exportado${data.length === 1 ? "" : "s"}`);
  };

  const currency = rows.find((t) => t.currency)?.currency || "usd";
  const usableCount = rows.filter(usable).length;
  const soonCount = rows.filter((t) => usable(t) && expiringSoon(t)).length;
  const expiredCount = rows.filter(expired).length;
  const issuedValue = rows.reduce((s, t) => s + (t.price ?? 0), 0);
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets de acceso"
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
        <KpiCard tone="primary" icon="Ticket" label="Vigentes" value={formatNumber(usableCount)}
          hint="Utilizables hoy · en esta página"
          definition="Pases dentro de su vigencia, con entradas disponibles y en un estado que admite uso." />
        <KpiCard tone="amber" icon="Clock" label="Por vencer" value={formatNumber(soonCount)}
          hint={`Vencen en ${SOON_DAYS} días o menos`} />
        <KpiCard tone="coral" icon="CircleSlash" label="Vencidos" value={formatNumber(expiredCount)}
          hint="Según la fecha, no el estado guardado" />
        <KpiCard tone="ink" icon="Banknote" label="Valor emitido" value={formatMoney(issuedValue, currency)}
          hint="Suma de precios · en esta página" />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9"
            placeholder="Buscar por código, titular o pulsera…" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(TICKET_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tipo: todos</SelectItem>
            {optionsFrom(TICKET_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
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
        emptyIcon="Ticket"
        emptyTitle="No hay tickets con estos filtros"
        emptyDescription="Los pases se emiten desde el punto de venta o desde Parque · Accesos y pulseras."
        columns={[
          {
            key: "code", header: "Ticket",
            render: (t: Ticket) => (
              <div>
                <p className="tf-num font-semibold">{t.code || t.wristband_code || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {t.holder_name
                    || [t.customer?.first_name, t.customer?.last_name].filter(Boolean).join(" ")
                    || "Sin titular"}
                </p>
              </div>
            ),
          },
          { key: "type", header: "Tipo", render: (t: Ticket) => <StatusBadge value={t.ticket_type} dict={TICKET_TYPE} dot={false} /> },
          { key: "product", header: "Producto", hideOn: "md",
            render: (t: Ticket) => <span className="text-xs">{t.product?.name || "—"}</span> },
          { key: "uses", header: "Entradas", render: (t: Ticket) => <UsageBar t={t} /> },
          {
            key: "valid", header: "Vigencia", hideOn: "sm",
            render: (t: Ticket) => (
              <div className="text-xs">
                <p className="tf-num">{t.valid_to ? formatDate(t.valid_to) : "Sin caducidad"}</p>
                <ValidityPill t={t} />
              </div>
            ),
          },
          { key: "price", header: "Precio", align: "right", hideOn: "lg",
            render: (t: Ticket) => formatMoney(t.price ?? 0, t.currency || currency) },
          { key: "status", header: "Estado", render: (t: Ticket) => <StatusBadge value={t.status} dict={TICKET_STATUS} /> },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} ticket{total === 1 ? "" : "s"} · página {page + 1} de {pages}
              {validity !== "all" && ` · ${visibleRows.length} en pantalla tras el filtro de vigencia`}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />
    </div>
  );
}
