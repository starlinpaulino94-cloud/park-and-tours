"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEPARTURE_STATUS } from "@/lib/labels";
import { formatDate, formatNumber, formatTime, toDateInput } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

interface Departure {
  _id: string; departure_at?: string; departure_time?: string; status?: string;
  capacity?: number; booked_pax?: number; pending_pax?: number; available_pax?: number;
  cutoff_hours?: number; meeting_point?: string; product?: any; branch?: any;
}

const WEEKDAYS = [
  { value: "mon", label: "L" }, { value: "tue", label: "M" }, { value: "wed", label: "X" },
  { value: "thu", label: "J" }, { value: "fri", label: "V" }, { value: "sat", label: "S" },
  { value: "sun", label: "D" },
];

const occupancyOf = (d: Departure) => {
  const booked = (d.booked_pax ?? 0) + (d.pending_pax ?? 0);
  return d.capacity ? Math.round((booked / d.capacity) * 100) : 0;
};

function OccupancyBar({ d }: { d: Departure }) {
  const pct = occupancyOf(d);
  const booked = (d.booked_pax ?? 0) + (d.pending_pax ?? 0);
  const tone = pct >= 100 ? "bg-coral" : pct >= 85 ? "bg-amber" : "bg-primary";
  return (
    <div className="w-36">
      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
        <span className="tf-num">{booked}/{d.capacity ?? 0} pax</span>
        <span className="tf-num">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export default function DeparturesPage() {
  const [rows, setRows] = useState<Departure[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [from, setFrom] = useState(toDateInput(new Date()));
  const [to, setTo] = useState(toDateInput(new Date(Date.now() + 29 * 86_400_000)));
  const [productFilter, setProductFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("__all");

  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({
    product_id: "", from: toDateInput(new Date()), to: toDateInput(new Date(Date.now() + 29 * 86_400_000)),
    times: "09:00", capacity: "", cutoff_hours: "12",
    weekdays: new Set<string>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "500", dateField: "departure_at", sort: "departure_at" });
    if (from) params.set("from", from);
    if (to) params.set("to", `${to}T23:59:59`);
    if (productFilter !== "__all") params.set("filter.product", productFilter);
    if (statusFilter !== "__all") params.set("filter.status", statusFilter);

    const res = await api.get<Departure[]>(`/api/erp/departure?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[salidas] error cargando el calendario:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las salidas");
      setRows([]);
      return;
    }
    setRows(res.data || []);
  }, [from, to, productFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get<any[]>("/api/erp/product?limit=200").then((res) => {
      if (!res.ok) {
        console.error("[salidas] error cargando las excursiones:", res.error);
        return;
      }
      setProducts(res.data || []);
    });
  }, []);

  const generate = async () => {
    const times = gen.times.split(",").map((t) => t.trim()).filter(Boolean);
    if (!gen.product_id) { toast.error("Selecciona la excursión"); return; }
    if (times.length === 0) { toast.error("Indica al menos un horario, por ejemplo 09:00"); return; }
    if (gen.weekdays.size === 0) { toast.error("Selecciona al menos un día de la semana"); return; }

    setBusy(true);
    const res = await api.post<{ created: number; skipped: number }>("/api/departures/generate", {
      product_id: gen.product_id,
      from: gen.from,
      to: gen.to,
      times,
      weekdays: [...gen.weekdays],
      capacity: gen.capacity ? Number(gen.capacity) : undefined,
      cutoff_hours: gen.cutoff_hours ? Number(gen.cutoff_hours) : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[salidas] error generando el calendario:", res.error);
      toast.error(res.error?.message || "No se pudieron generar las salidas");
      return;
    }
    const { created = 0, skipped = 0 } = res.data || {};
    toast.success(`${created} salida${created === 1 ? "" : "s"} creada${created === 1 ? "" : "s"}${skipped > 0 ? ` · ${skipped} ya existían` : ""}`);
    setGenOpen(false);
    load();
  };

  // Group by day for the calendar view.
  const byDay = useMemo(() => {
    const map = new Map<string, Departure[]>();
    for (const d of rows) {
      const key = (d.departure_at || "").slice(0, 10);
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), d]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const totalCapacity = rows.reduce((s, d) => s + (d.capacity ?? 0), 0);
  const totalBooked = rows.reduce((s, d) => s + (d.booked_pax ?? 0) + (d.pending_pax ?? 0), 0);
  const full = rows.filter((d) => occupancyOf(d) >= 100);
  const empty = rows.filter((d) => occupancyOf(d) === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Comercial"
        title="Salidas y cupos"
        description="La disponibilidad se calcula sobre la salida, no sobre el producto: es lo que impide vender dos veces la misma plaza."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setGenOpen(true)}>
              <Icon name="CalendarPlus" className="size-4" /> Generar calendario
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="CalendarRange" label="Salidas en el rango" value={formatNumber(rows.length)}
          hint={`${formatDate(from)} – ${formatDate(to)}`} />
        <KpiCard tone="ink" icon="Users" label="Ocupación global"
          value={`${totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0}%`}
          hint={`${formatNumber(totalBooked)} de ${formatNumber(totalCapacity)} plazas`} />
        <KpiCard tone="coral" icon="CircleSlash" label="Salidas llenas" value={formatNumber(full.length)}
          hint="Ya no admiten más reservas sin autorización" />
        <KpiCard tone="amber" icon="TrendingDown" label="Salidas sin ventas" value={formatNumber(empty.length)}
          hint="Candidatas a promoción o a cancelar" />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" />
        </div>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Excursión: todas</SelectItem>
            {products.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(DEPARTURE_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">Calendario</TabsTrigger>
          <TabsTrigger value="list">Listado</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-5">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
            </div>
          ) : byDay.length === 0 ? (
            <div className="tf-card p-2">
              <EmptyState icon="CalendarRange" title="No hay salidas en este rango"
                description="Genera el calendario de una excursión para empezar a vender plazas."
                action={<Button className="mt-1 gap-1.5" onClick={() => setGenOpen(true)}>
                  <Icon name="CalendarPlus" className="size-4" /> Generar calendario
                </Button>} />
            </div>
          ) : (
            <div className="space-y-4">
              {byDay.map(([day, items]) => {
                const dayPax = items.reduce((s, d) => s + (d.booked_pax ?? 0) + (d.pending_pax ?? 0), 0);
                const dayCap = items.reduce((s, d) => s + (d.capacity ?? 0), 0);
                return (
                  <section key={day} className="tf-card overflow-hidden">
                    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
                      <div>
                        <p className="font-display text-sm font-semibold capitalize">{formatDate(day)}</p>
                        <p className="text-xs text-muted-foreground">
                          {items.length} salida{items.length === 1 ? "" : "s"} · {formatNumber(dayPax)}/{formatNumber(dayCap)} pax
                        </p>
                      </div>
                      <Link href={`/dashboard/operaciones?date=${day}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Icon name="Radar" className="size-3.5" /> Ver despacho
                        </Button>
                      </Link>
                    </header>
                    <ul className="divide-y divide-border/60">
                      {items.map((d) => (
                        <li key={d._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <Pill tone="neutral" className="font-mono">{formatTime(d.departure_at)}</Pill>
                          <div className="min-w-[160px] flex-1">
                            <p className="text-sm font-semibold">
                              {typeof d.product === "object" && d.product ? d.product.name : "Salida"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {d.meeting_point || (typeof d.branch === "object" && d.branch ? d.branch.name : "Sin punto de encuentro")}
                            </p>
                          </div>
                          <OccupancyBar d={d} />
                          <StatusBadge value={d.status} dict={DEPARTURE_STATUS} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="list" className="mt-5">
          <DataTable
            rows={rows}
            loading={loading}
            emptyIcon="CalendarRange"
            emptyTitle="No hay salidas en este rango"
            emptyDescription="Ajusta el rango de fechas o genera el calendario de una excursión."
            columns={[
              {
                key: "product", header: "Excursión",
                render: (d: Departure) => (
                  <div>
                    <p className="font-semibold">{typeof d.product === "object" && d.product ? d.product.name : "Salida"}</p>
                    <p className="text-xs text-muted-foreground">{d.meeting_point || "Sin punto de encuentro"}</p>
                  </div>
                ),
              },
              { key: "date", header: "Fecha", render: (d: Departure) => (
                <div className="text-xs">
                  <p className="font-medium">{formatDate(d.departure_at)}</p>
                  <p className="text-muted-foreground">{formatTime(d.departure_at)}</p>
                </div>
              ) },
              { key: "occupancy", header: "Ocupación", render: (d: Departure) => <OccupancyBar d={d} /> },
              { key: "available", header: "Libres", align: "right", hideOn: "sm",
                render: (d: Departure) => <span className="font-semibold">{formatNumber(d.available_pax ?? 0)}</span> },
              { key: "cutoff", header: "Cierre", align: "right", hideOn: "lg",
                render: (d: Departure) => (d.cutoff_hours != null ? `${d.cutoff_hours} h antes` : "—") },
              { key: "status", header: "Estado", render: (d: Departure) => <StatusBadge value={d.status} dict={DEPARTURE_STATUS} /> },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* ---- generator --------------------------------------------------- */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar calendario de salidas</DialogTitle>
            <DialogDescription>
              Crea de golpe todas las salidas del rango. Las que ya existan a la misma hora se omiten,
              así que puedes ejecutarlo varias veces sin duplicar nada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Excursión</Label>
              <Select value={gen.product_id} onValueChange={(v) => {
                const p = products.find((x) => x._id === v);
                setGen((g) => ({ ...g, product_id: v, capacity: p?.default_capacity ? String(p.default_capacity) : g.capacity }));
              }}>
                <SelectTrigger><SelectValue placeholder="Selecciona la excursión" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Desde</Label>
                <Input type="date" value={gen.from} onChange={(e) => setGen((g) => ({ ...g, from: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Hasta</Label>
                <Input type="date" value={gen.to} onChange={(e) => setGen((g) => ({ ...g, to: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Días de la semana</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((w) => {
                  const active = gen.weekdays.has(w.value);
                  return (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setGen((g) => {
                        const next = new Set(g.weekdays);
                        if (next.has(w.value)) next.delete(w.value); else next.add(w.value);
                        return { ...g, weekdays: next };
                      })}
                      className={`size-9 rounded-lg border text-sm font-semibold transition-colors ${
                        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Horarios de salida</Label>
              <Input value={gen.times} onChange={(e) => setGen((g) => ({ ...g, times: e.target.value }))}
                placeholder="09:00, 14:30" />
              <p className="text-xs text-muted-foreground">Separa varios horarios con comas para crear varias salidas por día.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cupo por salida</Label>
                <Input type="number" value={gen.capacity} onChange={(e) => setGen((g) => ({ ...g, capacity: e.target.value }))}
                  placeholder="Cupo por defecto del producto" />
              </div>
              <div className="space-y-1.5">
                <Label>Cierre de ventas (horas antes)</Label>
                <Input type="number" value={gen.cutoff_hours} onChange={(e) => setGen((g) => ({ ...g, cutoff_hours: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>Cancelar</Button>
            <Button onClick={generate} disabled={busy}>{busy ? "Generando…" : "Generar salidas"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
