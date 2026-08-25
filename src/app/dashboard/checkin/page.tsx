"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BOOKING_STATUS, CHECKIN_STATUS } from "@/lib/labels";
import { formatDateTime, formatMoney, formatNumber, formatTime } from "@/lib/format";

interface Booking {
  _id: string; booking_number?: string; voucher_code?: string; status?: string;
  checkin_status?: string; checked_in_pax?: number;
  pax_total?: number; adults?: number; children?: number; infants?: number;
  total_amount?: number; paid_amount?: number; balance_amount?: number; currency?: string;
  travel_date?: string; pickup_time?: string; room_number?: string;
  customer?: any; product?: any; departure?: any; pickup_hotel?: any;
  participant?: any[]; voucher?: any[];
}

export default function CheckinPage() {
  const [code, setCode] = useState("");
  const [results, setResults] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState<Booking[]>([]);

  const [target, setTarget] = useState<Booking | null>(null);
  const [pax, setPax] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());

  // Today's departures give the desk something useful before anyone scans a code.
  const loadToday = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      limit: "100", dateField: "travel_date",
      from: start.toISOString(), to: end.toISOString(), sort: "travel_date",
    });
    const res = await api.get<Booking[]>(`/api/erp/booking?${params}`);
    if (!res.ok) {
      console.error("[checkin] error cargando las reservas de hoy:", res.error);
      return;
    }
    setToday((res.data || []).filter((b) => !["cancelled", "refunded", "draft"].includes(b.status || "")));
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  // AUD-U12: honour the ?code= deep-link used by the "Check-in" button on the
  // bookings page. Previously this param was ignored and the desk had to
  // re-type the voucher on an empty screen.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("code");
    if (initial) {
      setCode(initial);
      void search(initial);
    }
  }, []);

  const search = async (value?: string) => {
    const term = (value ?? code).trim();
    if (!term) { toast.error("Introduce un código de voucher, número de reserva o habitación"); return; }
    setLoading(true);
    const res = await api.get<Booking[]>(`/api/checkin/lookup?code=${encodeURIComponent(term)}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[checkin] error en la búsqueda:", res.error);
      toast.error(res.error?.message || "No se pudo buscar la reserva");
      return;
    }
    setResults(res.data || []);
    if ((res.data || []).length === 0) toast.error("No se encontró ninguna reserva con ese código");
  };

  const openCheckin = (b: Booking) => {
    setTarget(b);
    setPax(String(b.pax_total ?? 1));
    setNotes("");
    setForce(false);
    setSelectedParticipants(new Set((b.participant || []).map((p: any) => p._id)));
  };

  const submit = async (noShow = false, booking?: Booking) => {
    const b = booking || target;
    if (!b) return;
    setBusy(true);
    const res = await api.post<{ status: string; checked_in_pax?: number; total_pax?: number }>(
      `/api/bookings/${b._id}/checkin`,
      {
        pax: noShow ? undefined : Number(pax) || 0,
        no_show: noShow,
        participant_ids: noShow ? undefined : [...selectedParticipants],
        notes: notes || undefined,
        force,
      }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[checkin] error registrando el check-in:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el check-in");
      return;
    }
    toast.success(
      noShow ? "No-show registrado"
        : res.data?.status === "checked_in" ? "Check-in completo: voucher marcado como utilizado"
        : `Check-in parcial: ${res.data?.checked_in_pax}/${res.data?.total_pax} pax`
    );
    setTarget(null);
    loadToday();
    if (results) search();
  };

  const list = results ?? today;
  const pendingToday = today.filter((b) => b.checkin_status !== "done" && b.status !== "no_show");
  const doneToday = today.filter((b) => b.checkin_status === "done");
  const paxToday = today.reduce((s, b) => s + (b.pax_total ?? 0), 0);
  const paxChecked = today.reduce((s, b) => s + (b.checked_in_pax ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Check-in"
        description="Valida el voucher, comprueba el saldo y marca la asistencia. Un voucher utilizado no se puede volver a usar."
      />

      <section className="tf-card p-5">
        <Label className="text-xs">Código de voucher, número de reserva o habitación</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Icon name="ScanLine" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="VCH-XXXXX · RES-XXXXX · 1204"
              className="pl-9 font-mono"
              autoFocus
            />
          </div>
          <Button onClick={() => search()} disabled={loading} className="gap-1.5">
            <Icon name="Search" className="size-4" /> {loading ? "Buscando…" : "Buscar"}
          </Button>
          {results && (
            <Button variant="outline" onClick={() => { setResults(null); setCode(""); }} className="gap-1.5">
              <Icon name="X" className="size-4" /> Ver las de hoy
            </Button>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="CalendarCheck" label="Reservas de hoy" value={formatNumber(today.length)} />
        <StatCard icon="Clock" label="Pendientes de check-in" value={formatNumber(pendingToday.length)} tone="amber" />
        <StatCard icon="CheckCheck" label="Check-in realizados" value={formatNumber(doneToday.length)} tone="primary" />
        <StatCard icon="Users" label="Pasajeros presentados" value={`${formatNumber(paxChecked)}/${formatNumber(paxToday)}`} />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">
          {results ? `Resultados de la búsqueda (${results.length})` : "Reservas que viajan hoy"}
        </h2>

        {loading && !results ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="tf-card p-2">
            <EmptyState icon="ScanLine" title={results ? "Sin resultados" : "No hay reservas para hoy"}
              description={results
                ? "Prueba con el número de reserva completo o el código del voucher."
                : "Cuando haya salidas con reservas para hoy aparecerán aquí listas para el check-in."} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((b) => {
              const balance = b.balance_amount ?? 0;
              const done = b.checkin_status === "done";
              return (
                <article key={b._id} className="tf-card space-y-3 p-4">
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[12px] font-semibold">{b.booking_number}</p>
                      <p className="font-display text-base font-semibold">
                        {typeof b.customer === "object" && b.customer
                          ? [b.customer.first_name, b.customer.last_name].filter(Boolean).join(" ")
                          : "Sin cliente"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {typeof b.product === "object" && b.product ? b.product.name : "Excursión"}
                        {typeof b.departure === "object" && b.departure ? ` · ${formatTime(b.departure.departure_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusBadge value={b.status} dict={BOOKING_STATUS} />
                      <StatusBadge value={b.checkin_status} dict={CHECKIN_STATUS} />
                    </div>
                  </header>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-3">
                    <Field label="Pax" value={`${formatNumber(b.pax_total ?? 0)}${b.checked_in_pax ? ` (${b.checked_in_pax} presentes)` : ""}`} />
                    <Field label="Voucher" value={b.voucher_code || "—"} mono />
                    <Field label="Hotel" value={typeof b.pickup_hotel === "object" && b.pickup_hotel ? b.pickup_hotel.name : "—"} />
                    <Field label="Habitación" value={b.room_number || "—"} />
                    <Field label="Recogida" value={b.pickup_time || "—"} />
                    <Field label="Saldo" value={formatMoney(balance, b.currency)} />
                  </div>

                  {balance > 0.009 && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                      <Icon name="TriangleAlert" className="size-3.5 shrink-0" />
                      Saldo pendiente de {formatMoney(balance, b.currency)}: cobra antes del check-in o fuérzalo.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1.5" disabled={done} onClick={() => openCheckin(b)}>
                      <Icon name={done ? "CheckCheck" : "ScanLine"} className="size-4" />
                      {done ? "Check-in realizado" : "Hacer check-in"}
                    </Button>
                    {!done && b.status !== "no_show" && (
                      <Button size="sm" variant="outline" className="gap-1.5"
                        disabled={busy} onClick={() => submit(true, b)}>
                        <Icon name="UserX" className="size-4" /> No-show
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- check-in dialog --------------------------------------------- */}
      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check-in de {target?.booking_number}</DialogTitle>
            <DialogDescription>
              {target && typeof target.customer === "object" && target.customer
                ? [target.customer.first_name, target.customer.last_name].filter(Boolean).join(" ")
                : ""}
              {target ? ` · ${target.pax_total ?? 0} pax` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pasajeros presentados</Label>
              <Input type="number" min={0} max={target?.pax_total ?? 99} value={pax} onChange={(e) => setPax(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Si es menor que el total, el check-in queda como parcial y el voucher sigue activo.
              </p>
            </div>

            {(target?.participant || []).length > 0 && (
              <div className="space-y-2">
                <Label>Participantes</Label>
                <ul className="tf-card divide-y divide-border">
                  {(target?.participant || []).map((p: any) => (
                    <li key={p._id} className="flex items-center gap-2.5 px-3 py-2">
                      <Checkbox
                        checked={selectedParticipants.has(p._id)}
                        onCheckedChange={() => setSelectedParticipants((prev) => {
                          const next = new Set(prev);
                          if (next.has(p._id)) next.delete(p._id); else next.add(p._id);
                          return next;
                        })}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[p.category, p.age ? `${p.age} años` : null, p.document_id].filter(Boolean).join(" · ") || "Sin datos"}
                        </p>
                      </div>
                      {p.special_requirements && <Pill tone="warning">Requisitos</Pill>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(target?.balance_amount ?? 0) > 0.009 && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <Checkbox checked={force} onCheckedChange={(v) => setForce(!!v)} className="mt-0.5" />
                <span className="text-[13px] text-amber-900 dark:text-amber-100">
                  Forzar el check-in con un saldo pendiente de{" "}
                  {formatMoney(target?.balance_amount ?? 0, target?.currency)}. Queda registrado en la auditoría.
                </span>
              </label>
            )}

            <div className="space-y-1.5">
              <Label>Observaciones</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button>
            <Button variant="outline" onClick={() => submit(true)} disabled={busy} className="gap-1.5">
              <Icon name="UserX" className="size-4" /> No-show
            </Button>
            <Button onClick={() => submit(false)} disabled={busy}>{busy ? "Registrando…" : "Confirmar check-in"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate font-medium ${mono ? "font-mono text-[12px]" : ""}`}>{value}</p>
    </div>
  );
}

function StatCard({ icon, label, value, tone = "default" }: {
  icon: string; label: string; value: string; tone?: "default" | "primary" | "amber";
}) {
  const tones: Record<string, string> = {
    default: "bg-card",
    primary: "bg-primary/10 border-primary/30",
    amber: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
  };
  return (
    <div className={`tf-card flex items-center gap-3 p-4 ${tones[tone]}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon name={icon} className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="tf-num text-xl">{value}</p>
      </div>
    </div>
  );
}
