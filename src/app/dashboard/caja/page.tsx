"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";

interface Session {
  _id: string; code?: string; status?: string; currency?: string;
  opened_at?: string; closed_at?: string;
  opening_amount?: number; expected_cash?: number; counted_cash?: number; difference?: number;
  sales_total?: number; card_total?: number; transfer_total?: number;
  expenses_total?: number; withdrawals_total?: number;
  cash_register?: any; branch?: any; user?: any;
}

const MOVEMENT_TYPES = [
  { value: "deposit", label: "Entrada de efectivo" },
  { value: "withdrawal", label: "Retiro de efectivo" },
  { value: "expense", label: "Gasto pagado en caja" },
  { value: "adjustment", label: "Ajuste" },
];

export default function CashPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [registers, setRegisters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [openDialog, setOpenDialog] = useState(false);
  const [registerId, setRegisterId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("0");

  const [closing, setClosing] = useState<Session | null>(null);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [movementFor, setMovementFor] = useState<Session | null>(null);
  const [movementType, setMovementType] = useState("withdrawal");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementConcept, setMovementConcept] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [sessionsRes, registersRes] = await Promise.all([
      api.get<Session[]>("/api/cash/sessions"),
      api.get<any[]>("/api/erp/cash_register?limit=100"),
    ]);
    setLoading(false);

    if (!sessionsRes.ok) {
      console.error("[caja] error cargando las sesiones:", sessionsRes.error);
      toast.error(sessionsRes.error?.message || "No se pudieron cargar las cajas");
    } else {
      setSessions(sessionsRes.data || []);
    }
    if (!registersRes.ok) {
      console.error("[caja] error cargando las cajas registradoras:", registersRes.error);
    } else {
      setRegisters(registersRes.data || []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openSession = async () => {
    if (!registerId) { toast.error("Selecciona la caja que quieres abrir"); return; }
    setBusy(true);
    const res = await api.post("/api/cash/sessions", {
      cash_register_id: registerId,
      opening_amount: Number(openingAmount) || 0,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[caja] error abriendo la sesión:", res.error);
      toast.error(res.error?.message || "No se pudo abrir la caja");
      return;
    }
    toast.success("Caja abierta");
    setOpenDialog(false);
    setRegisterId("");
    setOpeningAmount("0");
    load();
  };

  const closeSession = async () => {
    if (!closing) return;
    setBusy(true);
    const res = await api.post<{ expected_cash: number; counted_cash: number; difference: number }>(
      `/api/cash/sessions/${closing._id}/close`,
      { counted_cash: Number(countedCash) || 0, notes: closeNotes }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[caja] error cerrando la sesión:", res.error);
      toast.error(res.error?.message || "No se pudo cerrar la caja");
      return;
    }
    const diff = res.data?.difference ?? 0;
    toast.success(
      Math.abs(diff) < 0.01
        ? "Caja cerrada y cuadrada"
        : `Caja cerrada con una diferencia de ${formatMoney(diff, closing.currency)}`
    );
    setClosing(null);
    setCountedCash("");
    setCloseNotes("");
    load();
  };

  const addMovement = async () => {
    if (!movementFor) return;
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount === 0) { toast.error("Indica un importe distinto de cero"); return; }
    setBusy(true);
    const res = await api.post("/api/cash/movements", {
      cash_session_id: movementFor._id,
      movement_type: movementType,
      amount,
      concept: movementConcept || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[caja] error registrando el movimiento:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el movimiento");
      return;
    }
    toast.success("Movimiento registrado");
    setMovementFor(null);
    setMovementAmount("");
    setMovementConcept("");
    load();
  };

  const open = sessions.filter((s) => s.status === "open");
  const closed = sessions.filter((s) => s.status !== "open");
  const currency = sessions[0]?.currency || "usd";
  const cashOnHand = open.reduce((s, x) => s + (x.expected_cash ?? 0), 0);
  const salesToday = open.reduce((s, x) => s + (x.sales_total ?? 0), 0);
  const diffs = closed.filter((s) => Math.abs(s.difference ?? 0) > 0.009);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Caja y punto de venta"
        description="Cada cobro en efectivo entra en una sesión de caja. El arqueo compara lo esperado con lo contado y deja constancia de la diferencia."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setOpenDialog(true)}>
              <Icon name="Plus" className="size-4" /> Abrir caja
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="amber" icon="Wallet" label="Efectivo esperado" value={formatMoney(cashOnHand, currency)}
              hint={`${formatNumber(open.length)} caja${open.length === 1 ? "" : "s"} abierta${open.length === 1 ? "" : "s"}`} />
            <KpiCard tone="primary" icon="Banknote" label="Ventas en cajas abiertas" value={formatMoney(salesToday, currency)}
              hint="Suma de los cobros de las sesiones activas" />
            <KpiCard icon="CreditCard" label="Cobros con tarjeta"
              value={formatMoney(open.reduce((s, x) => s + (x.card_total ?? 0), 0), currency)}
              hint="No afecta al arqueo de efectivo" />
            <KpiCard tone={diffs.length > 0 ? "coral" : "default"} icon="Scale" label="Cierres con diferencia"
              value={formatNumber(diffs.length)} hint={`${formatNumber(closed.length)} sesiones cerradas`} />
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Cajas abiertas</h2>
            {open.length === 0 ? (
              <div className="tf-card p-2">
                <EmptyState icon="Wallet" title="No hay ninguna caja abierta"
                  description="Abre una sesión de caja para poder cobrar en efectivo desde el punto de venta."
                  action={<Button className="mt-1 gap-1.5" onClick={() => setOpenDialog(true)}>
                    <Icon name="Plus" className="size-4" /> Abrir caja
                  </Button>} />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {open.map((s) => (
                  <article key={s._id} className="tf-card space-y-4 p-5">
                    <header className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg font-semibold">
                          {typeof s.cash_register === "object" && s.cash_register ? s.cash_register.name : "Caja"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.code} · abierta {formatDateTime(s.opened_at)}
                          {typeof s.user === "object" && s.user ? ` · ${s.user.name || s.user.email}` : ""}
                        </p>
                      </div>
                      <StatusBadge value="open" dict={GENERIC_STATUS} />
                    </header>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      <Metric label="Fondo inicial" value={formatMoney(s.opening_amount ?? 0, s.currency)} />
                      <Metric label="Ventas" value={formatMoney(s.sales_total ?? 0, s.currency)} />
                      <Metric label="Tarjeta" value={formatMoney(s.card_total ?? 0, s.currency)} />
                      <Metric label="Transferencia" value={formatMoney(s.transfer_total ?? 0, s.currency)} />
                      <Metric label="Gastos" value={formatMoney(s.expenses_total ?? 0, s.currency)} />
                      <Metric label="Retiros" value={formatMoney(s.withdrawals_total ?? 0, s.currency)} />
                    </dl>

                    <div className="rounded-lg bg-primary/10 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Efectivo esperado en caja</p>
                      <p className="font-display text-2xl font-semibold tabular-nums">{formatMoney(s.expected_cash ?? 0, s.currency)}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5"
                        onClick={() => { setMovementFor(s); setMovementType("withdrawal"); }}>
                        <Icon name="ArrowLeftRight" className="size-4" /> Movimiento
                      </Button>
                      <Button size="sm" className="gap-1.5"
                        onClick={() => { setClosing(s); setCountedCash(String(s.expected_cash ?? 0)); }}>
                        <Icon name="Calculator" className="size-4" /> Hacer arqueo y cerrar
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Historial de sesiones</h2>
            <DataTable
              rows={closed}
              emptyIcon="History"
              emptyTitle="Todavía no hay cierres"
              emptyDescription="Cuando cierres una caja, el arqueo aparecerá aquí con su diferencia."
              columns={[
                {
                  key: "code", header: "Sesión",
                  render: (s: Session) => (
                    <div>
                      <p className="font-semibold">{s.code}</p>
                      <p className="text-xs text-muted-foreground">
                        {typeof s.cash_register === "object" && s.cash_register ? s.cash_register.name : "Caja"}
                        {typeof s.user === "object" && s.user ? ` · ${s.user.name || s.user.email}` : ""}
                      </p>
                    </div>
                  ),
                },
                { key: "opened", header: "Apertura", hideOn: "md", render: (s: Session) => <span className="text-xs">{formatDateTime(s.opened_at)}</span> },
                { key: "closed", header: "Cierre", hideOn: "sm", render: (s: Session) => <span className="text-xs">{formatDateTime(s.closed_at)}</span> },
                { key: "sales", header: "Ventas", align: "right", hideOn: "lg", render: (s: Session) => formatMoney(s.sales_total ?? 0, s.currency) },
                { key: "expected", header: "Esperado", align: "right", render: (s: Session) => formatMoney(s.expected_cash ?? 0, s.currency) },
                { key: "counted", header: "Contado", align: "right", render: (s: Session) => formatMoney(s.counted_cash ?? 0, s.currency) },
                {
                  key: "difference", header: "Diferencia", align: "right",
                  render: (s: Session) => {
                    const d = s.difference ?? 0;
                    if (Math.abs(d) < 0.01) return <Pill tone="success">Cuadrada</Pill>;
                    return <Pill tone={d > 0 ? "warning" : "danger"}>{formatMoney(d, s.currency)}</Pill>;
                  },
                },
              ]}
            />
          </section>
        </>
      )}

      {/* ---- open a session --------------------------------------------- */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription>
              El fondo de apertura es el efectivo con el que empiezas el turno. Se tendrá en cuenta en el arqueo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Caja</Label>
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger><SelectValue placeholder="Selecciona la caja" /></SelectTrigger>
                <SelectContent>
                  {registers.map((r) => (
                    <SelectItem key={r._id} value={r._id}>
                      {r.name}{typeof r.branch === "object" && r.branch ? ` · ${r.branch.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {registers.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No hay cajas dadas de alta. Créalas en Configuración → Cajas.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Fondo de apertura</Label>
              <Input type="number" step="0.01" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>Cancelar</Button>
            <Button onClick={openSession} disabled={busy}>{busy ? "Abriendo…" : "Abrir caja"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- arqueo / close --------------------------------------------- */}
      <Dialog open={!!closing} onOpenChange={(v) => !v && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arqueo de caja</DialogTitle>
            <DialogDescription>
              Cuenta el efectivo físico e introduce el total. La diferencia queda registrada en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Efectivo esperado</p>
              <p className="font-display text-2xl font-semibold tabular-nums">
                {formatMoney(closing?.expected_cash ?? 0, closing?.currency)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Efectivo contado</Label>
              <Input type="number" step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} autoFocus />
              {countedCash !== "" && (
                <p className="text-xs text-muted-foreground">
                  Diferencia:{" "}
                  <span className={Math.abs(Number(countedCash) - (closing?.expected_cash ?? 0)) < 0.01
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-semibold text-rose-600 dark:text-rose-400"}>
                    {formatMoney(Number(countedCash) - (closing?.expected_cash ?? 0), closing?.currency)}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Observaciones</Label>
              <Textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} rows={3}
                placeholder="Justifica la diferencia si la hay…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>Cancelar</Button>
            <Button onClick={closeSession} disabled={busy}>{busy ? "Cerrando…" : "Cerrar caja"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- manual movement -------------------------------------------- */}
      <Dialog open={!!movementFor} onOpenChange={(v) => !v && setMovementFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimiento de caja</DialogTitle>
            <DialogDescription>
              Entradas y salidas de efectivo que no proceden de una venta: retiros, aportes o gastos pagados en caja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={movementType} onValueChange={setMovementType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Importe</Label>
              <Input type="number" step="0.01" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Concepto</Label>
              <Input value={movementConcept} onChange={(e) => setMovementConcept(e.target.value)} placeholder="Retiro a bóveda, compra de combustible…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementFor(null)}>Cancelar</Button>
            <Button onClick={addMovement} disabled={busy}>{busy ? "Guardando…" : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
