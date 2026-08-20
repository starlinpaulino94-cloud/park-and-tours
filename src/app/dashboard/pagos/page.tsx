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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

interface Payment {
  _id: string; reference?: string; payment_type?: string; method?: string; status?: string;
  amount?: number; currency?: string; paid_at?: string; notes?: string;
  order?: any; booking?: any; customer?: any; partner?: any; user?: any;
}

const TYPE_LABEL: Record<string, { label: string; tone: "success" | "danger" | "info" | "accent" }> = {
  payment: { label: "Cobro", tone: "success" },
  deposit: { label: "Anticipo", tone: "info" },
  refund: { label: "Reembolso", tone: "danger" },
  credit_note: { label: "Nota de crédito", tone: "accent" },
};

export default function PaymentsPage() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState("__all");
  const [methodFilter, setMethodFilter] = useState("__all");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    order_id: "", amount: "", method: "cash", payment_type: "payment", reference: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (typeFilter !== "__all") params.set("filter.payment_type", typeFilter);
    if (methodFilter !== "__all") params.set("filter.method", methodFilter);

    const res = await api.get<Payment[]>(`/api/erp/payment?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[pagos] error cargando los pagos:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar los pagos");
      setRows([]);
      return;
    }
    setRows(res.data || []);
  }, [typeFilter, methodFilter]);

  useEffect(() => { load(); }, [load]);

  // Orders with an open balance are the only sensible target for a new payment.
  const loadOrders = useCallback(async () => {
    const res = await api.get<any[]>("/api/orders?limit=100");
    if (!res.ok) {
      console.error("[pagos] error cargando las órdenes:", res.error);
      return;
    }
    setOrders((res.data || []).filter((o: any) => (o.balance_amount ?? 0) > 0.009));
  }, []);

  useEffect(() => { if (open) loadOrders(); }, [open, loadOrders]);

  const submit = async () => {
    const amount = Number(form.amount);
    if (!form.order_id) { toast.error("Selecciona la orden a la que aplica el pago"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("El importe debe ser mayor que cero"); return; }

    setBusy(true);
    const res = await api.post("/api/payments", {
      order_id: form.order_id,
      amount,
      method: form.method,
      payment_type: form.payment_type,
      reference: form.reference || undefined,
      notes: form.notes || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[pagos] error registrando el pago:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el pago");
      return;
    }
    toast.success(form.payment_type === "refund" ? "Reembolso registrado" : "Cobro registrado");
    setOpen(false);
    setForm({ order_id: "", amount: "", method: "cash", payment_type: "payment", reference: "", notes: "" });
    load();
  };

  const currency = rows[0]?.currency || "usd";
  const collected = rows.filter((p) => p.payment_type !== "refund").reduce((s, p) => s + (p.amount ?? 0), 0);
  const refunded = rows.filter((p) => p.payment_type === "refund").reduce((s, p) => s + (p.amount ?? 0), 0);
  const byMethod = new Map<string, number>();
  for (const p of rows) {
    if (p.payment_type === "refund") continue;
    byMethod.set(p.method || "other", (byMethod.get(p.method || "other") || 0) + (p.amount ?? 0));
  }
  const topMethod = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0];

  const selectedOrder = orders.find((o) => o._id === form.order_id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Pagos y reembolsos"
        description="Cada movimiento actualiza el saldo de la reserva, alimenta la caja y liquida la deuda del partner en la misma operación."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setOpen(true)}>
              <Icon name="Plus" className="size-4" /> Registrar cobro
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="Banknote" label="Cobrado" value={formatMoney(collected, currency)}
          hint={`${formatNumber(rows.filter((p) => p.payment_type !== "refund").length)} movimientos`} />
        <KpiCard tone="coral" icon="Undo2" label="Reembolsado" value={formatMoney(refunded, currency)}
          hint={`${formatNumber(rows.filter((p) => p.payment_type === "refund").length)} reembolsos`} />
        <KpiCard tone="ink" icon="Scale" label="Neto" value={formatMoney(collected - refunded, currency)}
          hint="Cobros menos reembolsos en pantalla" />
        <KpiCard icon="CreditCard" label="Método principal"
          value={topMethod ? PAYMENT_METHOD[topMethod[0]]?.label || topMethod[0] : "—"}
          hint={topMethod ? formatMoney(topMethod[1], currency) : "Sin cobros todavía"} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tipo: todos</SelectItem>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Método: todos</SelectItem>
            {optionsFrom(PAYMENT_METHOD).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyIcon="CreditCard"
        emptyTitle="Todavía no hay pagos"
        emptyDescription="Los cobros del punto de venta y del portal B2B aparecerán aquí en cuanto se registren."
        columns={[
          {
            key: "reference", header: "Referencia",
            render: (p: Payment) => {
              const t = TYPE_LABEL[p.payment_type || "payment"] || TYPE_LABEL.payment;
              return (
                <div>
                  <p className="font-mono text-[12px] font-semibold">{p.reference || "—"}</p>
                  <Pill tone={t.tone} className="mt-1">{t.label}</Pill>
                </div>
              );
            },
          },
          {
            key: "order", header: "Orden / cliente",
            render: (p: Payment) => {
              const o = p.order;
              const c = p.customer;
              return (
                <div>
                  <p className="font-semibold">{o && typeof o === "object" ? o.order_number : "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {c && typeof c === "object"
                      ? [c.first_name, c.last_name].filter(Boolean).join(" ")
                      : p.partner && typeof p.partner === "object" ? p.partner.commercial_name || p.partner.name : "Sin cliente"}
                  </p>
                </div>
              );
            },
          },
          { key: "method", header: "Método", hideOn: "md",
            render: (p: Payment) => <StatusBadge value={p.method} dict={PAYMENT_METHOD} dot={false} /> },
          { key: "user", header: "Cobrado por", hideOn: "lg",
            render: (p: Payment) => <span className="text-xs">{typeof p.user === "object" && p.user ? p.user.name || p.user.email : "—"}</span> },
          { key: "date", header: "Fecha", hideOn: "sm",
            render: (p: Payment) => <span className="text-xs">{formatDateTime(p.paid_at || (p as any).createdAt)}</span> },
          {
            key: "amount", header: "Importe", align: "right",
            render: (p: Payment) => (
              <span className={p.payment_type === "refund"
                ? "font-semibold text-rose-700 dark:text-rose-400"
                : "font-semibold text-emerald-700 dark:text-emerald-400"}>
                {p.payment_type === "refund" ? "−" : "+"}{formatMoney(p.amount ?? 0, p.currency)}
              </span>
            ),
          },
          { key: "status", header: "Estado", render: (p: Payment) => <StatusBadge value={p.status} dict={PAYMENT_STATUS} /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar cobro o reembolso</DialogTitle>
            <DialogDescription>
              Solo se listan las órdenes con saldo pendiente. Para cobrar en efectivo necesitas una caja abierta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Select value={form.order_id} onValueChange={(v) => {
                const order = orders.find((o) => o._id === v);
                setForm((f) => ({ ...f, order_id: v, amount: order ? String(order.balance_amount ?? "") : f.amount }));
              }}>
                <SelectTrigger><SelectValue placeholder="Selecciona la orden" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o._id} value={o._id}>
                      {o.order_number} · pendiente {formatMoney(o.balance_amount ?? 0, o.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {orders.length === 0 && (
                <p className="text-xs text-muted-foreground">No hay órdenes con saldo pendiente.</p>
              )}
              {selectedOrder && (
                <p className="text-xs text-muted-foreground">
                  Total {formatMoney(selectedOrder.total_amount ?? 0, selectedOrder.currency)} ·
                  pagado {formatMoney(selectedOrder.paid_amount ?? 0, selectedOrder.currency)}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={form.payment_type} onValueChange={(v) => setForm((f) => ({ ...f, payment_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Método</Label>
                <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {optionsFrom(PAYMENT_METHOD).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Importe</Label>
                <Input type="number" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Referencia</Label>
                <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Se genera automáticamente" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Guardando…" : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
