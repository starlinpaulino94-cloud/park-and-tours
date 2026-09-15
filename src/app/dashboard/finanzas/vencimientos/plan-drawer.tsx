"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/tf/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { INSTALLMENT_KIND, INSTALLMENT_STATUS, COLLECTION_STATUS, DEPOSIT_TYPE, toOptions } from "@/lib/labels-modules";
import { formatDate, formatMoney } from "@/lib/format";
import { buildSchedule, dayOf } from "@/lib/collections";

/**
 * El plan de cobro de una venta.
 *
 * Se puede rehacer, y eso es lo delicado: un plan nuevo no puede perder un
 * cobro. Por eso el servidor recalcula la imputación desde `paid_total` de la
 * orden en vez de arrastrar lo que decían las cuotas viejas —la orden es la
 * única cifra que no depende del plan—, y aquí se enseña la previsualización
 * antes de guardar para que nadie descubra las fechas después de mandárselas al
 * cliente.
 */
interface Installment {
  _id: string;
  sequence?: number;
  kind?: string;
  due_date?: string;
  amount?: number;
  paid_amount?: number;
  balance?: number;
  currency?: string;
  status?: string;
}

interface PlanData {
  order: {
    _id: string; order_number?: string; currency?: string;
    total?: number; paid_total?: number; balance?: number;
    deposit_type?: string; deposit_percent?: number; deposit_amount?: number;
    deposit_due_date?: string; balance_due_date?: string; payment_terms?: string;
    collection_status?: string;
  };
  installments: Installment[];
  status: string;
}

export function PlanDrawer({
  orderId, open, onOpenChange, onSaved,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const [depositType, setDepositType] = useState("none");
  const [depositValue, setDepositValue] = useState("");
  const [depositDue, setDepositDue] = useState("");
  const [balanceDue, setBalanceDue] = useState("");
  const [parts, setParts] = useState("1");

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    const res = await api.get<PlanData>(`/api/orders/${orderId}/schedule`);
    setLoading(false);
    if (!res.ok) {
      console.error("[plan] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el plan de cobro");
      return;
    }
    setData(res.data || null);
    const order = res.data?.order;
    setDepositType(order?.deposit_type || "none");
    setDepositValue(
      order?.deposit_type === "percent"
        ? String(order?.deposit_percent ?? "")
        : String(order?.deposit_amount ?? "")
    );
    setDepositDue(dayOf(order?.deposit_due_date) || "");
    setBalanceDue(dayOf(order?.balance_due_date) || "");
    setParts("1");
    setEditing(false);
  }, [orderId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const total = data?.order.total ?? 0;
  const currency = data?.order.currency;

  // La previsualización usa el MISMO dominio que el servidor, así que lo que se
  // ve aquí es exactamente lo que se va a guardar.
  const preview = editing
    ? buildSchedule({
        total,
        policy: {
          deposit_type: depositType,
          deposit_percent: depositType === "percent" ? Number(depositValue) || 0 : null,
          deposit_amount: depositType === "amount" ? Number(depositValue) || 0 : null,
        },
        depositDueDate: depositDue || null,
        balanceDueDate: balanceDue || null,
        installments: Number(parts) || 1,
      })
    : [];

  const save = async () => {
    if (!orderId) return;
    setBusy(true);
    const res = await api.post(`/api/orders/${orderId}/schedule`, {
      deposit_type: depositType,
      deposit_percent: depositType === "percent" ? Number(depositValue) || 0 : undefined,
      deposit_amount: depositType === "amount" ? Number(depositValue) || 0 : undefined,
      deposit_due_date: depositDue || undefined,
      balance_due_date: balanceDue || undefined,
      installments_count: Number(parts) || 1,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[plan] no se pudo guardar:", res.error);
      toast.error(res.error?.message || "No se pudo guardar el plan");
      return;
    }
    toast.success("Plan de cobro actualizado");
    await load();
    onSaved();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="tf-num text-base">
            Plan de cobro {data?.order.order_number ? `· ${data.order.order_number}` : ""}
          </SheetTitle>
          <SheetDescription>
            El anticipo bloquea la plaza; el saldo se cobra antes de la salida.
          </SheetDescription>
        </SheetHeader>

        {loading || !data ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <section className="grid grid-cols-3 gap-3 rounded-xl bg-muted/50 px-4 py-3">
              <Figure label="Total" value={formatMoney(total, currency)} />
              <Figure label="Cobrado" value={formatMoney(data.order.paid_total ?? 0, currency)} />
              <Figure label="Saldo" value={formatMoney(data.order.balance ?? 0, currency)} strong />
            </section>

            <div className="flex items-center gap-2">
              <StatusBadge value={data.order.collection_status || "none"} dict={COLLECTION_STATUS} />
              {data.order.payment_terms ? (
                <span className="text-xs text-muted-foreground">{data.order.payment_terms}</span>
              ) : null}
            </div>

            <section className="space-y-2">
              <h3 className="font-display text-base font-semibold">Cuotas</h3>
              {data.installments.filter((i) => i.status !== "cancelled").length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Esta venta no tiene calendario todavía.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {data.installments
                    .filter((installment) => installment.status !== "cancelled")
                    .map((installment) => (
                      <li key={installment._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <StatusBadge value={installment.kind || "installment"} dict={INSTALLMENT_KIND} />
                            <span className="text-sm font-semibold">{formatDate(installment.due_date)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatMoney(installment.amount ?? 0, installment.currency || currency)}
                            {(installment.paid_amount ?? 0) > 0
                              ? ` · cobrado ${formatMoney(installment.paid_amount ?? 0, installment.currency || currency)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="tf-num font-semibold">
                            {formatMoney(installment.balance ?? 0, installment.currency || currency)}
                          </span>
                          <StatusBadge value={installment.status || "pending"} dict={INSTALLMENT_STATUS} />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            {editing ? (
              <section className="space-y-4 rounded-xl border p-4">
                <h3 className="font-display text-base font-semibold">Rehacer el plan</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-deposit-type">Anticipo</Label>
                    <Select value={depositType} onValueChange={setDepositType}>
                      <SelectTrigger id="plan-deposit-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {toOptions(DEPOSIT_TYPE).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {depositType !== "none" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="plan-deposit-value">
                        {depositType === "percent" ? "Porcentaje" : "Importe"}
                      </Label>
                      <Input id="plan-deposit-value" type="number" step="0.01" value={depositValue}
                        onChange={(e) => setDepositValue(e.target.value)} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-deposit-due">Anticipo vence</Label>
                    <Input id="plan-deposit-due" type="date" value={depositDue}
                      onChange={(e) => setDepositDue(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-balance-due">Saldo vence</Label>
                    <Input id="plan-balance-due" type="date" value={balanceDue}
                      onChange={(e) => setBalanceDue(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-parts">Cuotas del saldo</Label>
                    <Input id="plan-parts" type="number" min="1" max="24" value={parts}
                      onChange={(e) => setParts(e.target.value)} />
                  </div>
                </div>

                {preview.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Así quedaría
                    </p>
                    <ul className="space-y-1">
                      {preview.map((installment) => (
                        <li key={installment.sequence} className="flex items-center justify-between gap-3 text-sm">
                          <span>
                            <StatusBadge value={installment.kind} dict={INSTALLMENT_KIND} />
                            <span className="ml-2">{formatDate(installment.due_date)}</span>
                          </span>
                          <span className="tf-num">{formatMoney(installment.amount, currency)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Suman {formatMoney(preview.reduce((s, i) => s + i.amount, 0), currency)} de{" "}
                      {formatMoney(total, currency)}.
                    </p>
                  </div>
                )}

                {(data.order.paid_total ?? 0) > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Esta venta ya tiene {formatMoney(data.order.paid_total ?? 0, currency)} cobrados. Se
                    reimputan solos sobre el plan nuevo, de la cuota más antigua a la más nueva.
                  </p>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
                  <Button onClick={save} disabled={busy || preview.length === 0}>
                    {busy ? "Guardando…" : "Guardar plan"}
                  </Button>
                </div>
              </section>
            ) : (
              <Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}>
                <Icon name="Pencil" className="size-4" /> Rehacer el plan
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? "tf-num text-lg font-semibold" : "tf-num"}>{value}</p>
    </div>
  );
}

