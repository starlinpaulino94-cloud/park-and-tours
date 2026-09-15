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
import { CASH_SESSION_STATUS } from "@/lib/labels-modules";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { DENOMINATIONS, isKnownCurrency } from "@/lib/cash-close";
import { rankOf } from "@/lib/nav";
import { useAppRole } from "@/components/tf/app-shell";
import { ArqueoDialog } from "./arqueo-dialog";
import { RevisionDialog, type ReviewSession } from "./revision-dialog";

interface Session {
  _id: string; code?: string; status?: string; currency?: string;
  opened_at?: string; closed_at?: string;
  opening_amount?: number; expected_cash?: number; counted_cash?: number; difference?: number;
  sales_total?: number; card_total?: number; transfer_total?: number;
  expenses_total?: number; withdrawals_total?: number;
  // 0038 — los totales de verdad viven por moneda; los escalares de arriba son
  // los de la moneda principal de la caja.
  expected_by_currency?: Record<string, number>;
  difference_by_currency?: Record<string, number>;
  requires_approval?: boolean;
  difference_reason?: string;
  closed_by?: any;
  cash_register?: any; branch?: any; user?: any;
}

/**
 * Suma importes agrupando por moneda.
 *
 * Es la corrección de fondo de esta pantalla: los KPI sumaban `expected_cash`
 * de todas las cajas y lo pintaban con la moneda de la primera, así que una
 * caja en pesos y otra en dólares producían un número que no era ninguna de
 * las dos cosas.
 */
function totalByCurrency(
  sessions: Session[],
  pick: (s: Session) => number
): { currency: string; amount: number }[] {
  const out = new Map<string, number>();
  for (const session of sessions) {
    const currency = String(session.currency || "usd").toLowerCase();
    out.set(currency, (out.get(currency) ?? 0) + (pick(session) || 0));
  }
  return [...out.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Un KPI con varias monedas.
 *
 * Se apilan con su símbolo en vez de convertirse a una moneda base: la tasa de
 * hoy no es la del momento del cobro, y un arqueo no se hace con conversiones.
 */
function money(rows: { currency: string; amount: number }[]): string {
  if (rows.length === 0) return formatMoney(0);
  return rows.map((row) => formatMoney(row.amount, row.currency)).join("  ·  ");
}

/** Las diferencias de un cierre, moneda a moneda. */
function differenceRows(session: Session): { currency: string; amount: number }[] {
  const map = session.difference_by_currency;
  if (map && Object.keys(map).length > 0) {
    return Object.entries(map)
      .filter(([currency, amount]) => isKnownCurrency(currency) && Math.abs(Number(amount)) > 0.009)
      .map(([currency, amount]) => ({ currency, amount: Number(amount) }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }
  const amount = session.difference ?? 0;
  return Math.abs(amount) > 0.009
    ? [{ currency: String(session.currency || "usd"), amount }]
    : [];
}

/** Los importes de una caja, moneda a moneda. */
function expectedRows(session: Session): { currency: string; amount: number }[] {
  const map = session.expected_by_currency;
  if (map && Object.keys(map).length > 0) {
    return Object.entries(map)
      .filter(([currency]) => isKnownCurrency(currency))
      .map(([currency, amount]) => ({ currency, amount: Number(amount) || 0 }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }
  return [{ currency: String(session.currency || "usd"), amount: session.expected_cash ?? 0 }];
}

/** Las monedas que el sistema sabe contar; el dominio del arqueo es la fuente. */
const CURRENCIES = Object.keys(DENOMINATIONS);

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

  const [arqueoFor, setArqueoFor] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Session | null>(null);

  const [movementFor, setMovementFor] = useState<Session | null>(null);
  const [movementType, setMovementType] = useState("withdrawal");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementConcept, setMovementConcept] = useState("");
  const [movementCurrency, setMovementCurrency] = useState("");

  const role = useAppRole();
  const canReview = rankOf(role) >= rankOf("manager");

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

  const addMovement = async () => {
    if (!movementFor) return;
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount === 0) { toast.error("Indica un importe distinto de cero"); return; }
    setBusy(true);
    const res = await api.post("/api/cash/movements", {
      cash_session_id: movementFor._id,
      movement_type: movementType,
      amount,
      currency: movementCurrency || undefined,
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
    setMovementCurrency("");
    load();
  };

  const open = sessions.filter((s) => s.status === "open");
  const closed = sessions.filter((s) => s.status !== "open");
  const pending = sessions.filter((s) => s.status === "pending_approval");
  const cashOnHand = totalByCurrency(open, (s) => s.expected_cash ?? 0);
  const salesToday = totalByCurrency(open, (s) => s.sales_total ?? 0);
  const cardToday = totalByCurrency(open, (s) => s.card_total ?? 0);
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
            <KpiCard tone="amber" icon="Wallet" label="Efectivo esperado" value={money(cashOnHand)}
              hint={`${formatNumber(open.length)} caja${open.length === 1 ? "" : "s"} abierta${open.length === 1 ? "" : "s"}`} />
            <KpiCard tone="primary" icon="Banknote" label="Ventas en cajas abiertas" value={money(salesToday)}
              hint="Suma de los cobros de las sesiones activas" />
            <KpiCard icon="CreditCard" label="Cobros con tarjeta" value={money(cardToday)}
              hint="No afecta al arqueo de efectivo" />
            <KpiCard tone={pending.length > 0 ? "coral" : diffs.length > 0 ? "amber" : "default"}
              icon="Scale" label="Arqueos por revisar" value={formatNumber(pending.length)}
              hint={`${formatNumber(diffs.length)} cierres con diferencia de ${formatNumber(closed.length)}`} />
          </section>

          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold">Esperando revisión</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {pending.map((s) => (
                  <article key={s._id} className="tf-card flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {s.code}
                        {typeof s.cash_register === "object" && s.cash_register ? ` · ${s.cash_register.name}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cerrada {formatDateTime(s.closed_at)}
                        {typeof s.user === "object" && s.user ? ` por ${s.user.name || s.user.email}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {differenceRows(s).map((row) => (
                          <Pill key={row.currency} tone={row.amount > 0 ? "warning" : "danger"} className="tf-num">
                            {row.currency.toUpperCase()} {formatMoney(row.amount, row.currency)}
                          </Pill>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5" asChild>
                        <a href={`/api/cash/sessions/${s._id}/arqueo/pdf`} target="_blank" rel="noopener noreferrer">
                          <Icon name="Printer" className="size-4" /> Acta
                        </a>
                      </Button>
                      <Button size="sm" className="gap-1.5" disabled={!canReview} onClick={() => setReviewing(s)}>
                        <Icon name="ShieldCheck" className="size-4" /> Revisar
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              {!canReview && (
                <p className="text-xs text-muted-foreground">
                  La revisión de un descuadre la hace un supervisor, y nunca la misma persona que cerró la caja.
                </p>
              )}
            </section>
          )}

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
                      <StatusBadge value={s.status || "open"} dict={CASH_SESSION_STATUS} />
                    </header>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      <Metric label="Fondo inicial" value={formatMoney(s.opening_amount ?? 0, s.currency)} />
                      <Metric label="Ventas" value={formatMoney(s.sales_total ?? 0, s.currency)} />
                      <Metric label="Tarjeta" value={formatMoney(s.card_total ?? 0, s.currency)} />
                      <Metric label="Transferencia" value={formatMoney(s.transfer_total ?? 0, s.currency)} />
                      <Metric label="Gastos" value={formatMoney(s.expenses_total ?? 0, s.currency)} />
                      <Metric label="Retiros" value={formatMoney(s.withdrawals_total ?? 0, s.currency)} />
                    </dl>

                    <div className="space-y-1 rounded-lg bg-primary/10 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Efectivo esperado en caja</p>
                      {/* Una moneda por línea: el turno recibe pesos y dólares y
                          sumarlos daría un número que no es ninguno de los dos. */}
                      {expectedRows(s).map((row) => (
                        <p key={row.currency} className="tf-num text-2xl">
                          {formatMoney(row.amount, row.currency)}
                          {expectedRows(s).length > 1 && (
                            <span className="ml-1.5 text-xs font-semibold uppercase text-primary">{row.currency}</span>
                          )}
                        </p>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5"
                        onClick={() => {
                          setMovementFor(s);
                          setMovementType("withdrawal");
                          setMovementCurrency(String(s.currency || ""));
                        }}>
                        <Icon name="ArrowLeftRight" className="size-4" /> Movimiento
                      </Button>
                      <Button size="sm" className="gap-1.5" onClick={() => setArqueoFor(s._id)}>
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
                    const rows = differenceRows(s);
                    if (rows.length === 0) return <Pill tone="success">Cuadrada</Pill>;
                    return (
                      <div className="flex flex-wrap justify-end gap-1">
                        {rows.map((row) => (
                          <Pill key={row.currency} tone={row.amount > 0 ? "warning" : "danger"} className="tf-num">
                            {formatMoney(row.amount, row.currency)}
                          </Pill>
                        ))}
                      </div>
                    );
                  },
                },
                {
                  key: "status", header: "Estado",
                  render: (s: Session) => <StatusBadge value={s.status || "closed"} dict={CASH_SESSION_STATUS} />,
                },
                {
                  key: "acta", header: "", align: "right",
                  render: (s: Session) => (
                    <Button variant="ghost" size="icon" asChild aria-label={`Acta del arqueo ${s.code ?? ""}`}>
                      <a href={`/api/cash/sessions/${s._id}/arqueo/pdf`} target="_blank" rel="noopener noreferrer">
                        <Icon name="Printer" className="size-4" />
                      </a>
                    </Button>
                  ),
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

      <ArqueoDialog
        sessionId={arqueoFor}
        open={!!arqueoFor}
        onOpenChange={(v) => !v && setArqueoFor(null)}
        onClosed={load}
      />

      <RevisionDialog
        session={reviewing as ReviewSession | null}
        open={!!reviewing}
        onOpenChange={(v) => !v && setReviewing(null)}
        onResolved={load}
      />

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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="movement-amount">Importe</Label>
                <Input id="movement-amount" type="number" step="0.01" value={movementAmount}
                  onChange={(e) => setMovementAmount(e.target.value)} autoFocus />
                {movementType === "adjustment" && (
                  <p className="text-xs text-muted-foreground">
                    Un ajuste admite importe negativo para corregir un sobrante mal registrado.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                {/* La misma caja recibe pesos y dólares: el retiro tiene que
                    decir de qué moneda sale, o descuadra la que no era. */}
                <Label htmlFor="movement-currency">Moneda</Label>
                <Select value={movementCurrency} onValueChange={setMovementCurrency}>
                  <SelectTrigger id="movement-currency"><SelectValue placeholder="Moneda de la caja" /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
      <dd className="tf-num">{value}</dd>
    </div>
  );
}
