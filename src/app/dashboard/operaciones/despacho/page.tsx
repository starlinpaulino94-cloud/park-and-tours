"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEPARTURE_STATUS, STAFF_TYPE } from "@/lib/labels";
import { formatDate, formatNumber, formatTime, toDateInput } from "@/lib/format";

interface DispatchItem {
  _id: string; product: string; product_id?: string;
  departure_at?: string; departure_time?: string | null; status?: string;
  capacity: number; pax: number; bookings_count: number;
  hotels: string[];
  vehicles: any[]; vehicle_capacity: number;
  guides: any[]; staff: any[]; routes: any[];
  pickups_without_route: number;
  alerts: string[];
}

interface DispatchData {
  date: string;
  /** La zona de la empresa: las horas vienen ya calculadas en ella. */
  timezone: string;
  items: DispatchItem[];
  totals: { departures: number; pax: number; vehicles: number; guides: number; hotels: number };
  /**
   * Choques REALES: el mismo recurso en dos salidas que se pisan. Antes esto
   * contaba usos por día y marcaba en rojo la guagua que hace el tour de la
   * mañana y el de la tarde, que es la operación normal.
   */
  conflicts: { kind: "staff" | "vehicle"; resourceId: string; resourceName: string; message: string; departureIds: string[] }[];
}

const ROLES = [
  { value: "guide", label: "Guía" },
  { value: "driver", label: "Conductor" },
  { value: "assistant", label: "Asistente" },
  { value: "photographer", label: "Fotógrafo" },
  { value: "coordinator", label: "Coordinador" },
];

export default function OperationsPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(searchParams.get("date") || toDateInput(new Date()));
  const [data, setData] = useState<DispatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [vehicles, setVehicles] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [assignFor, setAssignFor] = useState<DispatchItem | null>(null);
  const [assign, setAssign] = useState({ vehicle: "", staff: "", role: "guide", pax: "" });
  const [building, setBuilding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<DispatchData>(`/api/operations/dispatch?date=${date}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[operaciones] error cargando el despacho:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el despacho del día");
      return;
    }
    setData(res.data || null);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.get<any[]>("/api/erp/vehicle?limit=200"),
      api.get<any[]>("/api/erp/staff?limit=300"),
    ]).then(([v, s]) => {
      if (!v.ok) console.error("[operaciones] error cargando vehículos:", v.error);
      if (!s.ok) console.error("[operaciones] error cargando personal:", s.error);
      setVehicles(v.data || []);
      setStaff(s.data || []);
    });
  }, []);

  const assignResource = async () => {
    if (!assignFor) return;
    if (!assign.vehicle && !assign.staff) {
      toast.error("Selecciona un vehículo o una persona para asignar");
      return;
    }
    setBusy(true);
    const res = await api.post("/api/erp/departure_resource", {
      departure: assignFor._id,
      vehicle: assign.vehicle || undefined,
      staff: assign.staff || undefined,
      resource_role: assign.staff ? assign.role : "vehicle",
      pax_assigned: assign.pax ? Number(assign.pax) : undefined,
      status: "confirmed",
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[operaciones] error asignando el recurso:", res.error);
      toast.error(res.error?.message || "No se pudo asignar el recurso");
      return;
    }
    toast.success("Recurso asignado a la salida");
    setAssignFor(null);
    setAssign({ vehicle: "", staff: "", role: "guide", pax: "" });
    load();
  };

  /**
   * Armar las rutas de recogida de una salida.
   *
   * Se puede repetir sin miedo: el motor actualiza las rutas que ya armó en vez
   * de duplicarlas, y no toca las que el despacho hizo a mano. Por eso el botón
   * no pregunta nada: a media mañana entran reservas y hay que rehacerlo.
   */
  const buildRoutes = async (item: DispatchItem) => {
    setBuilding(item._id);
    const res = await api.post<{ totals: { routes: number; created: number; updated: number; stops: number }; warnings: string[] }>(
      "/api/operations/dispatch/routes",
      { departure_id: item._id }
    );
    setBuilding(null);
    if (!res.ok) {
      console.error("[operaciones] error armando las rutas:", res.error);
      toast.error(res.error?.message || "No se pudieron armar las rutas");
      return;
    }
    const totals = res.data?.totals;
    const avisos = res.data?.warnings || [];
    toast.success(
      `${formatNumber(totals?.routes ?? 0)} rutas · ${formatNumber(totals?.stops ?? 0)} paradas colocadas`
    );
    // Los avisos se enseñan de uno en uno y completos: resumirlos en «hay 3
    // problemas» obliga a buscarlos, que es lo que hace que no se miren.
    for (const aviso of avisos.slice(0, 4)) toast.warning(aviso);
    if (avisos.length > 4) toast.warning(`Y ${avisos.length - 4} avisos más; míralos en la salida.`);
    load();
  };

  const shiftDay = (days: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    setDate(toDateInput(d));
  };

  const t = data?.totals;
  const withAlerts = (data?.items || []).filter((i) => i.alerts.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Despacho diario"
        description="Todo lo que sale hoy en una sola pantalla: pasajeros, vehículos, guías, hoteles y los conflictos de recursos antes de que ocurran."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => shiftDay(-1)} aria-label="Día anterior">
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[150px]" />
            <Button variant="outline" size="icon" onClick={() => shiftDay(1)} aria-label="Día siguiente">
              <Icon name="ChevronRight" className="size-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
          </div>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="primary" icon="Radar" label="Salidas del día" value={formatNumber(t?.departures ?? 0)}
              hint={formatDate(data?.date)} />
            <KpiCard tone="ink" icon="Users" label="Pasajeros" value={formatNumber(t?.pax ?? 0)}
              hint={`${formatNumber(t?.hotels ?? 0)} recogidas de hotel`} />
            <KpiCard icon="Bus" label="Vehículos asignados" value={formatNumber(t?.vehicles ?? 0)}
              hint={`${formatNumber(t?.guides ?? 0)} guías asignados`} />
            <KpiCard tone={withAlerts.length > 0 ? "coral" : "default"} icon="TriangleAlert" label="Salidas con avisos"
              value={formatNumber(withAlerts.length)}
              hint={(data?.conflicts.length ?? 0) > 0 ? `${data?.conflicts.length} conflictos de recursos` : "Sin conflictos de recursos"} />
          </section>

          {(data?.conflicts.length ?? 0) > 0 && (
            <section className="tf-card border-rose-300 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
              <h2 className="mb-2 flex items-center gap-2 font-display text-base font-semibold text-rose-900 dark:text-rose-100">
                <Icon name="ShieldAlert" className="size-4" /> Recursos en dos sitios a la vez
              </h2>
              <ul className="space-y-1 text-sm text-rose-900 dark:text-rose-100">
                {data?.conflicts.map((c, i) => (
                  <li key={`${c.resourceId}-${i}`} className="flex gap-2">
                    <Icon name={c.kind === "vehicle" ? "Bus" : "IdCard"} className="mt-0.5 size-3.5 shrink-0" />
                    {c.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(data?.items.length ?? 0) === 0 ? (
            <div className="tf-card p-2">
              <EmptyState icon="Radar" title="No hay salidas programadas este día"
                description="Elige otra fecha o genera el calendario de salidas de tus excursiones."
                action={<Link href="/dashboard/salidas" className="mt-1">
                  <Button className="gap-1.5"><Icon name="CalendarPlus" className="size-4" /> Ir a salidas</Button>
                </Link>} />
            </div>
          ) : (
            <div className="space-y-4">
              {data?.items.map((item) => {
                const occupancy = item.capacity ? Math.round((item.pax / item.capacity) * 100) : 0;
                return (
                  <article key={item._id} className="tf-card overflow-hidden">
                    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
                      {/* La hora la calcula el servidor en la zona de la empresa.
                          Calculada aquí saldría la del navegador: un coordinador
                          conectado desde Madrid vería el día corrido seis horas. */}
                      <Pill tone="neutral" className="font-mono text-[12px]">{item.departure_time || formatTime(item.departure_at)}</Pill>
                      <div className="min-w-[160px] flex-1">
                        <p className="font-display text-base font-semibold">{item.product}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(item.pax)} pax · {formatNumber(item.bookings_count)} reservas · {occupancy}% de ocupación
                        </p>
                      </div>
                      <StatusBadge value={item.status} dict={DEPARTURE_STATUS} />
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAssignFor(item)}>
                        <Icon name="Plus" className="size-3.5" /> Asignar recurso
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5"
                        onClick={() => buildRoutes(item)} disabled={building === item._id}>
                        <Icon name="Route" className="size-3.5" />
                        {building === item._id ? "Armando…" : "Armar rutas"}
                      </Button>
                    </header>

                    {item.alerts.length > 0 && (
                      <ul className="space-y-1 border-b border-border bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                        {item.alerts.map((a) => (
                          <li key={a} className="flex gap-2">
                            <Icon name="TriangleAlert" className="mt-0.5 size-3.5 shrink-0" /> {a}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      {/* El vehículo bloqueado se marca aquí y no solo en la
                          lista de avisos: quien mira este bloque está eligiendo
                          con qué sale, y necesita verlo en el sitio donde
                          decide. */}
                      <Block icon="Bus" title="Vehículos"
                        empty="Sin vehículo asignado"
                        items={item.vehicles.map((v: any) => ({
                          text: `${v.name}${v.plate ? ` · ${v.plate}` : ""}${v.capacity ? ` (${v.capacity} plazas)` : ""}`,
                          bad: Boolean(v.blocked_reason),
                          note: v.blocked_reason || (v.warnings?.length ? v.warnings.join(" · ") : undefined),
                        }))}
                        footer={item.vehicle_capacity > 0 ? `${item.pax}/${item.vehicle_capacity} plazas ocupadas` : undefined} />
                      <Block icon="IdCard" title="Personal"
                        empty="Sin personal asignado"
                        items={item.staff.map((s: any) => ({
                          text: `${s.full_name} · ${STAFF_TYPE[s.role || s.staff_type || ""]?.label || s.role || "Personal"}`,
                          bad: Boolean(s.certification_blocked),
                          note: s.certification_blocked
                            ? s.certification_note
                            : s.certifications_to_renew > 0
                              ? `${s.certifications_to_renew} certificación(es) por renovar`
                              : undefined,
                        }))} />
                      <Block icon="MapPin" title="Hoteles de recogida"
                        empty="Sin recogidas de hotel"
                        items={item.hotels} />
                      <Block icon="Route" title="Rutas de recogida"
                        empty="Sin rutas creadas"
                        items={item.routes.map((r: any) => ({
                          text: `${r.name || "Ruta"}${r.start_time ? ` · ${r.start_time}` : ""}${r.pax_total ? ` · ${r.pax_total} pax` : ""}`,
                          href: `/dashboard/operaciones/rutas/${r._id}/hoja`,
                        }))}
                        footer={item.pickups_without_route > 0
                          ? `${item.pickups_without_route} recogidas sin ruta`
                          : undefined} />
                    </div>

                    <footer className="flex flex-wrap gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
                      {/* El despacho dice cuánta gente va; el manifiesto, quién
                          es y dónde se le recoge. Es la hoja que se imprime. */}
                      <Link href={`/dashboard/salidas/${item._id}/manifiesto`}>
                        <Button size="sm" className="gap-1.5">
                          <Icon name="ClipboardList" className="size-3.5" /> Manifiesto
                        </Button>
                      </Link>
                      <Link href={`/dashboard/checkin?departure=${item._id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Icon name="ScanLine" className="size-3.5" /> Check-in
                        </Button>
                      </Link>
                      <Link href={`/dashboard/reservas?departure=${item._id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Icon name="CalendarCheck" className="size-3.5" /> Ver reservas
                        </Button>
                      </Link>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ---- assign a resource ------------------------------------------- */}
      <Dialog open={!!assignFor} onOpenChange={(v) => !v && setAssignFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar recurso</DialogTitle>
            <DialogDescription>
              {assignFor ? `${assignFor.product} · ${formatTime(assignFor.departure_at)} · ${assignFor.pax} pax` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Vehículo</Label>
              <Select value={assign.vehicle || "__none"}
                onValueChange={(v) => setAssign((a) => ({ ...a, vehicle: v === "__none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Sin vehículo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin vehículo</SelectItem>
                  {vehicles.map((v) => (
                    <SelectItem key={v._id} value={v._id}>
                      {v.name}{v.plate ? ` · ${v.plate}` : ""}{v.capacity ? ` (${v.capacity} plazas)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Persona</Label>
              <Select value={assign.staff || "__none"}
                onValueChange={(v) => setAssign((a) => ({ ...a, staff: v === "__none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Sin personal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin personal</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.full_name} · {STAFF_TYPE[s.staff_type || ""]?.label || s.staff_type || "Personal"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {assign.staff && (
              <div className="space-y-1.5">
                <Label>Rol en la salida</Label>
                <Select value={assign.role} onValueChange={(v) => setAssign((a) => ({ ...a, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Pax asignados</Label>
              <Input type="number" value={assign.pax} onChange={(e) => setAssign((a) => ({ ...a, pax: e.target.value }))}
                placeholder={assignFor ? String(assignFor.pax) : ""} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>Cancelar</Button>
            <Button onClick={assignResource} disabled={busy}>{busy ? "Asignando…" : "Asignar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface BlockItem {
  text: string;
  /** Lo que impide que salga: se marca con texto además de con color. */
  note?: string;
  bad?: boolean;
  href?: string;
}

function Block({ icon, title, items, empty, footer }: {
  icon: string; title: string; items: (string | BlockItem)[]; empty: string; footer?: string;
}) {
  const filas: BlockItem[] = items.map((i) => (typeof i === "string" ? { text: i } : i));
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon name={icon} className="size-3.5" /> {title}
      </p>
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-[13px]">
          {filas.map((fila, idx) => (
            <li key={`${fila.text}-${idx}`}>
              {fila.href ? (
                <Link href={fila.href} className="truncate font-medium text-primary hover:underline">
                  {fila.text}
                </Link>
              ) : (
                <span className={`block truncate ${fila.bad ? "font-semibold text-destructive" : ""}`}>
                  {fila.text}
                </span>
              )}
              {/* El motivo va escrito, no solo en rojo: el color solo no lo lee
                  quien no distingue ese rojo, y tampoco dice QUÉ pasa. */}
              {fila.note && (
                <span className={`block text-[11px] ${fila.bad ? "text-destructive" : "text-muted-foreground"}`}>
                  {fila.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {footer && <p className="mt-2 text-[11px] text-muted-foreground">{footer}</p>}
    </div>
  );
}
