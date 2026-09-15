"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
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
import { optionsFrom } from "@/components/tf/options";
import { INVOICE_STATUS, INVOICE_TYPE, NCF_TYPE, EFAC_STATUS } from "@/lib/labels-modules";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { formatTaxId, paymentStatus, voidBlocker, VOID_BLOCK_MESSAGE } from "@/lib/invoicing";

interface Invoice {
  _id: string; number?: string; ncf?: string; ncf_type?: string; series?: string;
  invoice_type?: string; status?: string; issued_at?: string; due_date?: string;
  ncf_expires_at?: string; voided_at?: string; void_reason?: string;
  customer_name?: string; customer_tax_id?: string; customer_address?: string;
  subtotal?: number; discount?: number; tax?: number; tax_rate?: number;
  total?: number; paid_amount?: number; balance?: number; currency?: string;
  efac_status?: string; notes?: string;
  customer?: any; order?: any;
}

interface SequenceHealthRow {
  _id: string; ncf_type?: string; next_number?: number; max_number?: number;
  expires_at?: string; status?: string;
  health: { remaining: number | null; level: "ok" | "warning" | "danger"; message: string | null };
}

const PAGE_SIZE = 50;

/**
 * Facturación fiscal.
 *
 * Esta pantalla era un formulario donde el NCF, el subtotal, el impuesto y el
 * total se escribían a mano. Una empresa dominicana no puede operar así: dos
 * cajas facturando a la vez escriben el mismo NCF, un número saltado hay que
 * justificarlo ante la DGII meses después, y un impuesto tecleado no coincide
 * con el de la venta. Ahora la factura se EMITE desde su orden y el número lo
 * entrega la base.
 */
export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [sequences, setSequences] = useState<SequenceHealthRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all");
  const [typeFilter, setTypeFilter] = useState("__all");
  const [page, setPage] = useState(0);

  const [detail, setDetail] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [orders, setOrders] = useState<{ _id: string; order_number?: string; total?: number; currency?: string }[]>([]);
  const [form, setForm] = useState({ order_id: "", ncf_type: "__auto", customer_name: "", customer_tax_id: "", notes: "" });
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "__all") params.set("status", statusFilter);
    if (typeFilter !== "__all") params.set("invoice_type", typeFilter);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    const res = await api.get<Invoice[]>(`/api/invoices?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[facturas] error cargando el listado:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las facturas");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
    setSequences((res as { sequences?: SequenceHealthRow[] }).sequences ?? []);
  }, [statusFilter, typeFilter, page]);

  useEffect(() => { load(); }, [load]);

  const openIssue = async () => {
    setIssuing(true);
    // Solo órdenes que se pueden facturar: una cancelada o un borrador no.
    const res = await api.get<any[]>("/api/orders?limit=100");
    if (res.ok) {
      setOrders((res.data || []).filter((o) => !["cancelled", "draft"].includes(o.status)));
    }
  };

  const issue = async () => {
    if (!form.order_id) { toast.error("Elige la orden que se va a facturar"); return; }
    setBusy(true);
    const res = await api.post<any>("/api/invoices", {
      order_id: form.order_id,
      ncf_type: form.ncf_type === "__auto" ? undefined : form.ncf_type,
      customer_name: form.customer_name || undefined,
      customer_tax_id: form.customer_tax_id || undefined,
      notes: form.notes || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo emitir la factura");
      return;
    }
    toast.success(`Factura ${res.data?.invoice?.ncf} emitida`);
    setIssuing(false);
    setForm({ order_id: "", ncf_type: "__auto", customer_name: "", customer_tax_id: "", notes: "" });
    void load();
  };

  const openDetail = async (row: Invoice) => {
    setDetail(row);
    setLines([]);
    const res = await api.get<any[]>(`/api/erp/invoice_line?filter.invoice=${row._id}&limit=200`);
    if (res.ok) setLines(res.data || []);
  };

  const doVoid = async () => {
    if (!voiding) return;
    if (!voidReason.trim()) { toast.error("Anular un comprobante fiscal necesita un motivo"); return; }
    setBusy(true);
    const res = await api.post<any>(`/api/invoices/${voiding._id}/void`, { reason: voidReason });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo anular");
      return;
    }
    toast.success(`Anulada con la nota de crédito ${res.data?.ncf}`);
    setVoiding(null);
    setVoidReason("");
    setDetail(null);
    void load();
  };

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const alerts = sequences.filter((s) => s.health.level !== "ok");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturación"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={openIssue}>
              <Icon name="Plus" className="size-4" /> Emitir factura
            </Button>
          </>
        }
      />

      {/* Quedarse sin NCF es dejar de facturar, y pedirle un rango nuevo a la
          DGII no es inmediato: el aviso va donde se mira todos los días. */}
      {alerts.map((s) => (
        <p key={s._id}
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            s.health.level === "danger"
              ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          }`}>
          <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" />
          <span><strong>{NCF_TYPE[s.ncf_type || ""]?.label || s.ncf_type}</strong> — {s.health.message}</span>
        </p>
      ))}

      <div className="flex flex-wrap items-end gap-2">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(INVOICE_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tipo: todos</SelectItem>
            {optionsFrom(INVOICE_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={openDetail}
        emptyIcon="Receipt"
        emptyTitle="Sin facturas emitidas"
        emptyDescription="Las facturas se emiten desde una orden: el NCF lo asigna el sistema desde la secuencia autorizada."
        columns={[
          {
            key: "ncf", header: "NCF",
            render: (row: Invoice) => (
              <div>
                <p className="tf-num font-semibold">{row.ncf || "—"}</p>
                <p className="text-xs text-muted-foreground">{row.customer_name}</p>
              </div>
            ),
          },
          { key: "invoice_type", header: "Tipo", hideOn: "sm",
            render: (row: Invoice) => <StatusBadge value={row.invoice_type} dict={INVOICE_TYPE} dot={false} /> },
          { key: "issued_at", header: "Emitida", hideOn: "md",
            render: (row: Invoice) => <span className="tf-num text-xs">{row.issued_at ? formatDate(row.issued_at) : "—"}</span> },
          { key: "total", header: "Total", align: "right",
            render: (row: Invoice) => <span className="font-semibold">{formatMoney(row.total ?? 0, row.currency)}</span> },
          { key: "balance", header: "Saldo", align: "right", hideOn: "lg",
            render: (row: Invoice) => <span className="tf-num">{formatMoney(row.balance ?? 0, row.currency)}</span> },
          {
            key: "status", header: "Estado",
            render: (row: Invoice) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge value={paymentStatus(row, new Date(), row.due_date)} dict={INVOICE_STATUS} />
                {row.efac_status && row.efac_status !== "not_applicable" && (
                  <StatusBadge value={row.efac_status} dict={EFAC_STATUS} dot={false} />
                )}
              </div>
            ),
          },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} comprobante{total === 1 ? "" : "s"} · página {page + 1} de {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      {/* ---- detalle ------------------------------------------------------ */}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="tf-num text-base">{detail?.ncf}</SheetTitle>
            <SheetDescription>{detail?.customer_name}</SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="space-y-4 px-4 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={paymentStatus(detail, new Date(), detail.due_date)} dict={INVOICE_STATUS} />
                <StatusBadge value={detail.invoice_type} dict={INVOICE_TYPE} dot={false} />
                <Pill tone="neutral">{NCF_TYPE[detail.ncf_type || ""]?.label || detail.ncf_type}</Pill>
              </div>

              {detail.voided_at && (
                <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  Anulada el {formatDate(detail.voided_at)}
                  {detail.void_reason ? ` — ${detail.void_reason}` : ""}
                </p>
              )}

              <section className="flex flex-wrap gap-2">
                <a href={`/api/invoices/${detail._id}/pdf`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Icon name="Download" className="size-4" /> Descargar PDF
                  </Button>
                </a>
                {!voidBlocker(detail) && (
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => { setVoiding(detail); setVoidReason(""); }}>
                    <Icon name="Ban" className="size-4" /> Anular con nota de crédito
                  </Button>
                )}
                {voidBlocker(detail) && (
                  <span className="text-xs text-muted-foreground">
                    {VOID_BLOCK_MESSAGE[voidBlocker(detail)!]}
                  </span>
                )}
              </section>

              <section className="tf-card divide-y divide-border">
                <Row label="Documento interno" value={detail.number || "—"} mono />
                <Row label="Emitida" value={detail.issued_at ? formatDate(detail.issued_at) : "—"} />
                {detail.ncf_expires_at && <Row label="NCF válido hasta" value={formatDate(detail.ncf_expires_at)} />}
                {detail.due_date && <Row label="Vence" value={formatDate(detail.due_date)} />}
                <Row label="RNC / Cédula" value={detail.customer_tax_id ? formatTaxId(detail.customer_tax_id) : "No aportado"} />
                {typeof detail.order === "object" && detail.order && (
                  <Row label="Orden" value={detail.order.order_number || "—"} mono />
                )}
              </section>

              <section className="tf-card divide-y divide-border">
                <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Desglose ({lines.length} línea{lines.length === 1 ? "" : "s"})
                </p>
                {lines.map((l) => (
                  <div key={l._id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{l.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(l.quantity ?? 0)} × {formatMoney(l.unit_price ?? 0, detail.currency)}
                        {l.is_exempt ? " · exento" : l.tax_rate ? ` · ITBIS ${formatPercent(l.tax_rate)}` : ""}
                      </p>
                    </div>
                    <span className="tf-num shrink-0 font-semibold">{formatMoney(l.total ?? 0, detail.currency)}</span>
                  </div>
                ))}
                <Row label="Subtotal" value={formatMoney(detail.subtotal ?? 0, detail.currency)} />
                {(detail.discount ?? 0) > 0 && <Row label="Descuento" value={`− ${formatMoney(detail.discount ?? 0, detail.currency)}`} />}
                <Row label="ITBIS" value={formatMoney(detail.tax ?? 0, detail.currency)} />
                <Row label="Total" value={formatMoney(detail.total ?? 0, detail.currency)} strong />
                <Row label="Pagado" value={formatMoney(detail.paid_amount ?? 0, detail.currency)} />
                <Row label="Saldo" value={formatMoney(detail.balance ?? 0, detail.currency)} />
              </section>

              {detail.notes && (
                <section className="tf-card p-4">
                  <p className="whitespace-pre-line text-sm">{detail.notes}</p>
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ---- emisión ------------------------------------------------------ */}
      <Dialog open={issuing} onOpenChange={(o) => !o && setIssuing(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Emitir factura</DialogTitle>
            <DialogDescription>
              El NCF y los importes los calcula el sistema desde la orden. Solo se completa
              lo fiscal del cliente, que es lo que no está en la venta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="i-order">Orden a facturar <span className="text-destructive">*</span></Label>
              <Select value={form.order_id} onValueChange={(v) => setForm({ ...form, order_id: v })}>
                <SelectTrigger id="i-order"><SelectValue placeholder="Elige la orden" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.order_number} · {formatMoney(o.total ?? 0, o.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-taxid">RNC / Cédula del cliente</Label>
              <Input id="i-taxid" value={form.customer_tax_id}
                onChange={(e) => setForm({ ...form, customer_tax_id: e.target.value })}
                placeholder="1-31-23456-7" />
              <p className="text-[11px] text-muted-foreground">
                Con RNC se emite crédito fiscal (B01/E31); sin él, consumidor final (B02/E32).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-name">Razón social</Label>
              <Input id="i-name" value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                placeholder="Si se deja vacío, el nombre del cliente de la orden" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-type">Tipo de comprobante</Label>
              <Select value={form.ncf_type} onValueChange={(v) => setForm({ ...form, ncf_type: v })}>
                <SelectTrigger id="i-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Automático según el cliente</SelectItem>
                  {optionsFrom(NCF_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-notes">Notas</Label>
              <Textarea id="i-notes" rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIssuing(false)}>Cancelar</Button>
            <Button onClick={issue} disabled={busy}>{busy ? "Emitiendo…" : "Emitir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- anulación ---------------------------------------------------- */}
      <Dialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Anular {voiding?.ncf}</DialogTitle>
            <DialogDescription>
              Un comprobante emitido no se borra: se anula emitiendo una nota de crédito que lo
              referencia. Consume otro número de la secuencia y queda en la declaración.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="v-reason">Motivo <span className="text-destructive">*</span></Label>
            <Textarea id="v-reason" rows={2} value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Error en el RNC del cliente · servicio no prestado · devolución" />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoiding(null)}>Cancelar</Button>
            <Button onClick={doVoid} disabled={busy}>{busy ? "Anulando…" : "Anular"}</Button>
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
      <span className={`tf-num text-right text-sm ${strong ? "text-base font-semibold" : ""} ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}
