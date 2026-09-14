"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEPARTURE_STATUS, CHECKIN_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatTime } from "@/lib/format";
import type { ManifestRow, PickupStop, PaxSummary, ManifestAlert } from "@/lib/manifest";

interface ManifestPayload {
  departure: {
    _id: string; departure_at?: string; status?: string; capacity?: number;
    meeting_point?: string | null; notes?: string | null;
    closed_at?: string | null; departed_at?: string | null;
    actual_pax?: number | null; no_show_pax?: number | null;
    incident_notes?: string | null; guide_notes?: string | null;
    product?: { _id?: string; name?: string; duration_hours?: number } | null;
    branch?: { name?: string } | null;
  };
  vehicles: { _id: string; name?: string; plate?: string; capacity?: number; vehicle_type?: string }[];
  staff: { _id: string; name: string; role?: string; phone?: string | null; languages?: string | null }[];
  routes: { _id: string; name?: string; start_time?: string; zone?: string | null; driver?: string; guide?: string; vehicle?: string | null }[];
  vehicle_seats: number;
  rows: ManifestRow[];
  stops: PickupStop[];
  summary: PaxSummary;
  alerts: ManifestAlert[];
  close: {
    blocker: string | null; message: string | null;
    totals: { actual_pax: number; no_show_pax: number; uncollected: Record<string, number> };
  };
  excluded: number;
  generated_at: string;
  generated_by: string;
}

/**
 * El manifiesto de una salida, pensado para imprimirse.
 *
 * El despacho decía cuántos pax llevaba cada salida; esta pantalla dice quiénes
 * son, dónde y a qué hora se les recoge, qué necesita cada uno y cuánto queda
 * por cobrar a bordo. Es la hoja que el guía se lleva al autobús, así que el
 * orden es el de la RUTA —no el de la venta— y todo lo que es interfaz (botones,
 * filtros, el panel entero) desaparece al imprimir.
 */
export default function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ManifestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ incident_notes: "", guide_notes: "", reason: "" });
  const [force, setForce] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<ManifestPayload>(`/api/departures/${id}/manifest`);
    setLoading(false);
    if (!res.ok || !res.data) {
      console.error("[manifiesto] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el manifiesto");
      return;
    }
    setData(res.data);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const checkIn = async (row: ManifestRow, mode: "done" | "no_show") => {
    setBusy(true);
    // Un saldo pendiente no puede impedir embarcar a quien ya está en la puerta:
    // se cobra a bordo y queda contado en el cierre. Pero `force` también salta
    // la guarda de fecha futura, así que solo se manda cuando la salida es de
    // hoy o anterior: desde el manifiesto de mañana no se embarca a nadie.
    const departsToday = Boolean(
      data?.departure.departure_at &&
      new Date(data.departure.departure_at).getTime() - Date.now() <= 86_400_000
    );
    const res = await api.post(`/api/bookings/${row.booking_id}/checkin`, {
      ...(mode === "no_show" ? { no_show: true } : { pax: row.seats }),
      force: !row.paid && departsToday,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo registrar el check-in");
      return;
    }
    toast.success(mode === "no_show" ? `${row.lead_name}: no-show` : `${row.lead_name}: embarcado`);
    void load();
  };

  const closeDeparture = async () => {
    setBusy(true);
    const res = await api.post(`/api/departures/${id}/close`, {
      incident_notes: form.incident_notes || undefined,
      guide_notes: form.guide_notes || undefined,
      reason: form.reason || undefined,
      force,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cerrar la salida");
      return;
    }
    toast.success("Salida cerrada");
    setClosing(false);
    void load();
  };

  const exportCsv = () => {
    if (!data) return;
    const headers = [
      "Orden", "Hora recogida", "Hotel", "Zona", "Habitación", "Reserva", "Voucher",
      "Pasajero", "Teléfono", "Idioma", "Adultos", "Niños", "Bebés", "Plazas",
      "Saldo", "Moneda", "Check-in", "Vendido por", "Requerimientos",
    ];
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = data.rows.map((r, i) => [
      i + 1, r.pickup_time, r.pickup_hotel, r.pickup_zone, r.room, r.booking_number, r.voucher_code,
      r.lead_name, r.phone, r.language, r.adults, r.children, r.infants, r.seats,
      r.balance, r.currency.toUpperCase(),
      CHECKIN_STATUS[r.checkin_status]?.label || r.checkin_status,
      r.sold_by, r.requirements.join(" · "),
    ].map(cell).join(","));
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manifiesto-${data.departure.product?.name || "salida"}-${(data.departure.departure_at || "").slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon="ClipboardList"
        title="No se pudo cargar el manifiesto"
        description="Puede que la salida ya no exista o que no tengas acceso a ella."
      />
    );
  }

  const { departure: dep, summary, rows, stops, alerts, close } = data;
  const closed = Boolean(dep.closed_at);

  return (
    <div className="space-y-5">
      <div className="no-print">
        <PageHeader
          title="Manifiesto de salida"
          actions={
            <>
              <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
                <Icon name="RefreshCw" className="size-4" />
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={exportCsv}>
                <Icon name="Download" className="size-4" /> CSV
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => window.print()}>
                <Icon name="Printer" className="size-4" /> Imprimir
              </Button>
              {/* El PDF es para mandárselo al guía la noche antes: lo abre sin
                  sesión y lo lee sin conexión a las 6 de la mañana. */}
              <a href={`/api/departures/${id}/manifest/pdf`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="gap-1.5">
                  <Icon name="FileText" className="size-4" /> PDF
                </Button>
              </a>
              {!closed && (
                <Button className="gap-1.5" onClick={() => setClosing(true)} disabled={busy}>
                  <Icon name="CircleCheck" className="size-4" /> Cerrar salida
                </Button>
              )}
            </>
          }
        />
        <Link href="/dashboard/salidas" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <Icon name="ArrowLeft" className="size-3.5" /> Volver a salidas
        </Link>
      </div>

      {/* ---- cabecera del documento ------------------------------------- */}
      <section className="tf-card print-plain space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold">{dep.product?.name || "Salida"}</h1>
            <p className="tf-num text-sm text-muted-foreground">
              {dep.departure_at ? `${formatDate(dep.departure_at)} · ${formatTime(dep.departure_at)}` : "Sin fecha"}
              {dep.product?.duration_hours ? ` · ${dep.product.duration_hours} h` : ""}
              {dep.branch?.name ? ` · ${dep.branch.name}` : ""}
            </p>
            {dep.meeting_point && (
              <p className="text-sm"><span className="text-muted-foreground">Punto de encuentro: </span>{dep.meeting_point}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={dep.status} dict={DEPARTURE_STATUS} />
            {closed && <Pill tone="neutral">Cerrada {formatDate(dep.closed_at!)}</Pill>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Reservas" value={formatNumber(summary.bookings)} />
          <Figure
            label="Plazas"
            value={`${formatNumber(summary.seats)}${dep.capacity ? ` / ${formatNumber(dep.capacity)}` : ""}`}
            hint={`${summary.adults} adultos · ${summary.children} niños · ${summary.infants} bebés`}
          />
          <Figure
            label="Embarcados"
            value={`${formatNumber(summary.checked_in)} / ${formatNumber(summary.seats)}`}
            hint={summary.no_show > 0 ? `${summary.no_show} no-show` : `${summary.pending_checkin} por embarcar`}
          />
          <Figure
            label="Por cobrar a bordo"
            value={moneyByCurrency(summary.to_collect_by_currency) || formatMoney(0, summary.currency)}
            hint={
              Object.keys(summary.to_collect_by_currency).length > 0
                ? "Saldo pendiente de las reservas"
                : "Todo cobrado"
            }
          />
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Line label="Vehículos" value={
            data.vehicles.length === 0 ? "Sin asignar"
              : data.vehicles.map((v) => `${v.plate || v.name}${v.capacity ? ` (${v.capacity} plazas)` : ""}`).join(" · ")
          } />
          <Line label="Personal" value={
            data.staff.length === 0 ? "Sin asignar"
              : data.staff.map((s) => `${s.name}${s.role ? ` — ${s.role}` : ""}${s.phone ? ` · ${s.phone}` : ""}`).join(" · ")
          } />
          <Line label="Idiomas a bordo" value={
            Object.entries(summary.languages).map(([lang, pax]) => `${lang}: ${pax}`).join(" · ") || "—"
          } />
          {data.routes.length > 0 && (
            <Line label="Rutas de recogida" value={
              data.routes.map((r) => `${r.name || "Ruta"}${r.zone ? ` (${r.zone})` : ""}${r.start_time ? ` · ${r.start_time}` : ""}`).join(" · ")
            } />
          )}
          {dep.notes && <Line label="Notas de la salida" value={dep.notes} />}
        </div>
      </section>

      {/* ---- lo que hay que resolver antes de salir ---------------------- */}
      {alerts.length > 0 && (
        <section className="space-y-1.5">
          {/* Un aviso sin salida es un callejón: "sin vehículo asignado" se
              resuelve en el despacho del día, así que se enlaza desde aquí. */}
          {alerts.some((a) => a.message.includes("asignado")) && dep.departure_at && (
            <Link
              href={`/dashboard/operaciones/despacho?date=${dep.departure_at.slice(0, 10)}`}
              className="no-print inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Asignar vehículo o guía en el despacho del día
              <Icon name="ArrowRight" className="size-3.5" />
            </Link>
          )}
          {alerts.map((a, i) => (
            <p
              key={i}
              className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${
                a.level === "danger"
                  ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              }`}
            >
              <Icon name={a.level === "danger" ? "TriangleAlert" : "Info"} className="mt-0.5 size-4 shrink-0" />
              {a.message}
            </p>
          ))}
        </section>
      )}

      {/* ---- hoja de ruta del conductor ---------------------------------- */}
      {stops.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-sm font-semibold">Hoja de ruta ({stops.length} paradas)</h2>
          <ul className="tf-card divide-y divide-border print-plain">
            {stops.map((stop, i) => (
              <li key={stop.key} className="print-block flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="tf-num w-6 shrink-0 text-sm font-semibold text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{stop.hotel}</p>
                    <p className="text-xs text-muted-foreground">
                      {stop.zone ? `${stop.zone} · ` : ""}{stop.bookings.length} reserva(s)
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tf-num text-sm font-semibold">{stop.time}</p>
                  <p className="text-xs text-muted-foreground">{stop.seats} pax</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- la lista de pasajeros --------------------------------------- */}
      <section className="space-y-2">
        <h2 className="font-display text-sm font-semibold">
          Pasajeros ({rows.length} reserva{rows.length === 1 ? "" : "s"})
          {data.excluded > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {data.excluded} cancelada(s) fuera de la lista
            </span>
          )}
        </h2>

        {rows.length === 0 ? (
          <EmptyState icon="Users" title="Nadie reservado todavía"
            description="Cuando entren reservas para esta salida aparecerán aquí, en orden de recogida." />
        ) : (
          <ul className="tf-card divide-y divide-border print-plain">
            {rows.map((row, i) => (
              <li key={row.booking_id} className="print-block px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="tf-num w-6 shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {row.lead_name}
                        <StatusBadge value={row.checkin_status} dict={CHECKIN_STATUS} />
                        {!row.paid && (
                          <Pill tone="warning">Cobrar {formatMoney(row.balance, row.currency)}</Pill>
                        )}
                        {row.unnamed_pax > 0 && <Pill tone="danger">{row.unnamed_pax} sin nombre</Pill>}
                      </p>
                      <p className="tf-num text-xs text-muted-foreground">
                        {row.booking_number}
                        {row.voucher_code ? ` · ${row.voucher_code}` : ""}
                        {row.phone ? ` · ${row.phone}` : ""}
                        {row.language ? ` · ${row.language}` : ""}
                        {row.sold_by ? ` · ${row.sold_by}` : ""}
                      </p>
                      <p className="text-xs">
                        <span className="text-muted-foreground">Recogida: </span>
                        {row.pickup_hotel
                          ? `${row.pickup_time} · ${row.pickup_hotel}${row.pickup_zone ? ` (${row.pickup_zone})` : ""}${row.room ? ` · hab. ${row.room}` : ""}`
                          : row.pickup_location || "Punto de encuentro"}
                      </p>
                      {row.requirements.length > 0 && (
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          <Icon name="Info" className="mr-1 inline size-3" />
                          {row.requirements.join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="tf-num text-sm font-semibold">{row.seats} pax</p>
                      <p className="text-xs text-muted-foreground">
                        {row.adults}A {row.children}N {row.infants}B
                      </p>
                    </div>
                    <div className="no-print flex gap-1">
                      {row.participants.length > 0 && (
                        <Button variant="ghost" size="sm" aria-label="Ver acompañantes"
                          onClick={() => setExpanded(expanded === row.booking_id ? null : row.booking_id)}>
                          <Icon name="Users" className="size-4" />
                        </Button>
                      )}
                      {!closed && row.checkin_status !== "done" && (
                        <Button size="sm" disabled={busy} onClick={() => checkIn(row, "done")}>Embarcar</Button>
                      )}
                      {!closed && row.checkin_status !== "no_show" && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => checkIn(row, "no_show")}>
                          No-show
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Los acompañantes se imprimen siempre: es la lista que pide el
                    seguro. En pantalla se despliegan para no llenar la vista. */}
                {row.participants.length > 0 && (
                  <ul className={`mt-2 space-y-0.5 pl-9 text-xs text-muted-foreground ${
                    expanded === row.booking_id ? "" : "hidden print:block"
                  }`}>
                    {row.participants.map((p) => (
                      <li key={p._id}>
                        {[p.full_name, [p.first_name, p.last_name].filter(Boolean).join(" ")].find(Boolean) || "Sin nombre"}
                        {p.age ? ` · ${p.age} años` : ""}
                        {p.document_id ? ` · ${p.document_id}` : ""}
                        {p.nationality ? ` · ${p.nationality}` : ""}
                        {p.special_requirements ? ` · ${p.special_requirements}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- lo que pasó, si ya está cerrada ------------------------------ */}
      {closed && (
        <section className="tf-card print-plain space-y-2 p-4">
          <h2 className="font-display text-sm font-semibold">Cierre de la salida</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="Pax embarcados" value={formatNumber(dep.actual_pax ?? 0)} />
            <Figure label="No-show" value={formatNumber(dep.no_show_pax ?? 0)} />
            <Figure label="Salió a las" value={dep.departed_at ? formatTime(dep.departed_at) : "—"} />
          </div>
          {dep.incident_notes && <Line label="Incidencias" value={dep.incident_notes} />}
          {dep.guide_notes && <Line label="Notas del guía" value={dep.guide_notes} />}
        </section>
      )}

      <p className="print-only text-[11px] text-muted-foreground">
        Manifiesto generado el {formatDateTime(data.generated_at)} por {data.generated_by}.
      </p>

      {/* ---- cierre ------------------------------------------------------ */}
      <Dialog open={closing} onOpenChange={(o) => !o && setClosing(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cerrar la salida</DialogTitle>
            <DialogDescription>
              Se registrarán {close.totals.actual_pax} pax embarcados
              {close.totals.no_show_pax > 0 ? ` y ${close.totals.no_show_pax} no-show` : ""}.
              De ese número salen la ocupación real y la rentabilidad de la salida.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {Object.keys(close.totals.uncollected).length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                Quedan {moneyByCurrency(close.totals.uncollected)} sin cobrar de reservas que sí
                embarcaron. Cóbralo antes de cerrar o quedará como deuda.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="c-incident">Incidencias</Label>
              <Textarea id="c-incident" rows={2} placeholder="Retraso de 40 min por avería · una clienta se mareó"
                value={form.incident_notes} onChange={(e) => setForm({ ...form, incident_notes: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-guide">Notas del guía</Label>
              <Textarea id="c-guide" rows={2} placeholder="Grupo muy puntual · el mirador estaba cerrado"
                value={form.guide_notes} onChange={(e) => setForm({ ...form, guide_notes: e.target.value })} />
            </div>

            {close.blocker && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <Checkbox id="c-force" checked={force} onCheckedChange={(v) => setForce(v === true)} />
                <span>{close.message} Cerrar igualmente necesita rango de gestión y motivo.</span>
              </label>
            )}
            {close.blocker && force && (
              <div className="space-y-1.5">
                <Label htmlFor="c-reason">Motivo <span className="text-destructive">*</span></Label>
                <Input id="c-reason" value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(false)}>Cancelar</Button>
            <Button onClick={closeDeparture} disabled={busy}>{busy ? "Cerrando…" : "Cerrar salida"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Importes por divisa, sin sumarlos.
 *
 * Una salida puede llevar reservas en dólares y en pesos; sumarlas 1:1 da un
 * número que no es dinero y que no cuadra contra la caja.
 */
function moneyByCurrency(amounts: Record<string, number>): string {
  return Object.entries(amounts)
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" + ");
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="tf-num text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}
