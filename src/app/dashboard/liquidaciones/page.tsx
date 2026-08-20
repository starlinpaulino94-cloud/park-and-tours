"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { BENEFICIARY_TYPE, SETTLEMENT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import { toDateInput } from "@/lib/format";

interface Settlement {
  _id: string; code?: string; beneficiary_type?: string; status?: string; currency?: string;
  period_from?: string; period_to?: string; issued_at?: string;
  sales_total?: number; cancellations_total?: number; base_total?: number;
  commission_total?: number; paid_total?: number; pending_total?: number;
  notes?: string; partner?: any; seller?: any;
}

const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export default function SettlementsPage() {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all");
  const [detail, setDetail] = useState<Settlement | null>(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    beneficiary_type: "partner",
    beneficiary_id: "",
    period_from: toDateInput(firstOfMonth()),
    period_to: toDateInput(new Date()),
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (statusFilter !== "__all") params.set("filter.status", statusFilter);
    const res = await api.get<Settlement[]>(`/api/erp/settlement?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[liquidaciones] error cargando el listado:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las liquidaciones");
      setRows([]);
      return;
    }
    setRows(res.data || []);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      api.get<any[]>("/api/erp/partner?limit=300"),
      api.get<any[]>("/api/erp/seller?limit=300"),
    ]).then(([p, s]) => {
      if (!p.ok) console.error("[liquidaciones] error cargando partners:", p.error);
      if (!s.ok) console.error("[liquidaciones] error cargando vendedores:", s.error);
      setPartners(p.data || []);
      setSellers(s.data || []);
    });
  }, [open]);

  const generate = async () => {
    if (!form.beneficiary_id) { toast.error("Selecciona el beneficiario a liquidar"); return; }
    setBusy(true);
    const res = await api.post<{ settlement: Settlement; commissions: number }>("/api/settlements/generate", {
      beneficiary_type: form.beneficiary_type,
      partner_id: form.beneficiary_type === "partner" ? form.beneficiary_id : undefined,
      seller_id: form.beneficiary_type !== "partner" ? form.beneficiary_id : undefined,
      period_from: form.period_from,
      period_to: form.period_to,
      notes: form.notes || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[liquidaciones] error generando la liquidación:", res.error);
      toast.error(res.error?.message || "No se pudo generar la liquidación");
      return;
    }
    toast.success(`Liquidación ${res.data?.settlement?.code} generada con ${res.data?.commissions} comisiones`);
    setOpen(false);
    setForm((f) => ({ ...f, beneficiary_id: "", notes: "" }));
    load();
  };

  const markPaid = async (s: Settlement) => {
    const res = await api.put(`/api/erp/settlement/${s._id}`, {
      status: "paid", paid_total: s.commission_total ?? 0, pending_total: 0,
    });
    if (!res.ok) {
      console.error("[liquidaciones] error marcando como pagada:", res.error);
      toast.error(res.error?.message || "No se pudo actualizar la liquidación");
      return;
    }
    toast.success("Liquidación marcada como pagada");
    setDetail(null);
    load();
  };

  const currency = rows[0]?.currency || "usd";
  const pending = rows.filter((s) => ["pending", "approved"].includes(s.status || ""));
  const paid = rows.filter((s) => s.status === "paid");
  const sum = (list: Settlement[], key: keyof Settlement) =>
    list.reduce((acc, s) => acc + ((s[key] as number) ?? 0), 0);

  const beneficiaries = form.beneficiary_type === "partner" ? partners : sellers;
  const nameOf = (s: Settlement) => {
    const p = s.partner;
    const v = s.seller;
    if (p && typeof p === "object") return p.commercial_name || p.name;
    if (v && typeof v === "object") return [v.first_name, v.last_name].filter(Boolean).join(" ");
    return "Sin beneficiario";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Red de ventas"
        title="Liquidaciones"
        description="Agrupan las comisiones pendientes de un beneficiario en un documento cerrado y generan automáticamente la cuenta por pagar."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setOpen(true)}>
              <Icon name="Plus" className="size-4" /> Generar liquidación
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="FileSpreadsheet" label="Liquidaciones" value={formatNumber(rows.length)}
          hint={`${formatNumber(pending.length)} pendientes de pago`} />
        <KpiCard tone="amber" icon="Clock" label="Importe pendiente" value={formatMoney(sum(pending, "pending_total"), currency)}
          hint="Comisiones liquidadas y no pagadas" />
        <KpiCard tone="ink" icon="CheckCheck" label="Pagado" value={formatMoney(sum(paid, "paid_total"), currency)}
          hint={`${formatNumber(paid.length)} liquidaciones cerradas`} />
        <KpiCard icon="Banknote" label="Ventas liquidadas" value={formatMoney(sum(rows, "sales_total"), currency)}
          hint="Base comercial de los documentos emitidos" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(SETTLEMENT_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={setDetail}
        emptyIcon="FileSpreadsheet"
        emptyTitle="Todavía no hay liquidaciones"
        emptyDescription="Genera la primera liquidación para cerrar las comisiones pendientes de un partner o vendedor."
        columns={[
          {
            key: "code", header: "Documento",
            render: (s: Settlement) => (
              <div>
                <p className="font-mono text-[12px] font-semibold">{s.code}</p>
                <p className="text-xs text-muted-foreground">{formatDate(s.issued_at)}</p>
              </div>
            ),
          },
          {
            key: "beneficiary", header: "Beneficiario",
            render: (s: Settlement) => (
              <div>
                <p className="font-semibold">{nameOf(s)}</p>
                <p className="text-xs text-muted-foreground">
                  {BENEFICIARY_TYPE[s.beneficiary_type || ""]?.label || s.beneficiary_type}
                </p>
              </div>
            ),
          },
          {
            key: "period", header: "Período", hideOn: "md",
            render: (s: Settlement) => (
              <span className="text-xs">{formatDate(s.period_from)} – {formatDate(s.period_to)}</span>
            ),
          },
          { key: "sales", header: "Ventas", align: "right", hideOn: "lg", render: (s: Settlement) => formatMoney(s.sales_total ?? 0, s.currency) },
          { key: "base", header: "Base", align: "right", hideOn: "lg", render: (s: Settlement) => formatMoney(s.base_total ?? 0, s.currency) },
          { key: "commission", header: "Comisión", align: "right",
            render: (s: Settlement) => <span className="font-semibold">{formatMoney(s.commission_total ?? 0, s.currency)}</span> },
          { key: "pending", header: "Pendiente", align: "right", hideOn: "sm",
            render: (s: Settlement) => (
              <span className={(s.pending_total ?? 0) > 0 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
                {formatMoney(s.pending_total ?? 0, s.currency)}
              </span>
            ) },
          { key: "status", header: "Estado", render: (s: Settlement) => <StatusBadge value={s.status} dict={SETTLEMENT_STATUS} /> },
        ]}
      />

      {/* ---- generate ---------------------------------------------------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar liquidación</DialogTitle>
            <DialogDescription>
              Se agruparán todas las comisiones pendientes o aprobadas del beneficiario en el período indicado.
              Las comisiones pasarán a estado «liquidada» y se creará la cuenta por pagar correspondiente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo de beneficiario</Label>
              <Select value={form.beneficiary_type}
                onValueChange={(v) => setForm((f) => ({ ...f, beneficiary_type: v, beneficiary_id: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(BENEFICIARY_TYPE, ["partner", "seller", "supervisor", "guide"]).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Beneficiario</Label>
              <Select value={form.beneficiary_id} onValueChange={(v) => setForm((f) => ({ ...f, beneficiary_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>
                  {beneficiaries.map((b) => (
                    <SelectItem key={b._id} value={b._id}>
                      {b.commercial_name || b.name || [b.first_name, b.last_name].filter(Boolean).join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Desde</Label>
                <Input type="date" value={form.period_from} onChange={(e) => setForm((f) => ({ ...f, period_from: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Hasta</Label>
                <Input type="date" value={form.period_to} onChange={(e) => setForm((f) => ({ ...f, period_to: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={generate} disabled={busy}>{busy ? "Generando…" : "Generar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- detail ------------------------------------------------------ */}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">{detail?.code}</SheetTitle>
            <SheetDescription>{detail ? nameOf(detail) : ""}</SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="space-y-5 px-4 pb-6">
              <div className="flex items-center gap-2">
                <StatusBadge value={detail.status} dict={SETTLEMENT_STATUS} />
                <span className="text-xs text-muted-foreground">
                  {formatDate(detail.period_from)} – {formatDate(detail.period_to)}
                </span>
              </div>

              <dl className="tf-card divide-y divide-border">
                <Row label="Ventas del período" value={formatMoney(detail.sales_total ?? 0, detail.currency)} />
                <Row label="Cancelaciones" value={formatMoney(detail.cancellations_total ?? 0, detail.currency)} />
                <Row label="Base comisionable" value={formatMoney(detail.base_total ?? 0, detail.currency)} />
                <Row label="Comisión total" value={formatMoney(detail.commission_total ?? 0, detail.currency)} strong />
                <Row label="Pagado" value={formatMoney(detail.paid_total ?? 0, detail.currency)} />
                <Row label="Pendiente" value={formatMoney(detail.pending_total ?? 0, detail.currency)} strong />
              </dl>

              {detail.notes && (
                <div className="tf-card p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notas</p>
                  <p className="mt-1 text-sm">{detail.notes}</p>
                </div>
              )}

              {detail.status !== "paid" && (
                <Button className="w-full gap-1.5" onClick={() => markPaid(detail)}>
                  <Icon name="CheckCheck" className="size-4" /> Marcar como pagada
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={strong ? "tf-num text-base font-semibold" : "tf-num text-sm"}>{value}</dd>
    </div>
  );
}
