"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { StatusBadge } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SHIFT_STATUS } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatNumber } from "@/lib/format";
import { weekKey, plannedHours, type ShiftLike } from "@/lib/hr";

/**
 * EL CUADRANTE DE LA SEMANA.
 *
 * Era una lista con filtro por estado: para saber quién cubría el jueves había
 * que leer filas. Un cuadrante se mira en rejilla —persona por día— porque lo
 * que se busca no es un turno, es un HUECO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLICAR ES UN ACTO, NO UN DESPLEGABLE
 *
 * «Publicado» era una opción más del `select`, al lado de «planificado». Aquí
 * publicar pasa por `/api/shifts/publish`, que antes comprueba las dos cosas
 * que convierten un cuadrante en un problema: que nadie esté en dos sitios a la
 * vez y que nadie tenga una certificación obligatoria vencida. Lo que no puede
 * publicar lo devuelve con el motivo, en vez de parar la semana entera.
 */

interface Shift extends ShiftLike {
  _id: string;
  staff?: { _id?: string; full_name?: string } | string | null;
  zone?: { name?: string } | string | null;
  published_at?: string | null;
}

interface WeekStaff {
  staffId: string; name: string; plannedHours: number; shifts: number;
  blocked: boolean; blockReason: string | null; expiring: number;
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const hoy = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const staffId = (s: Shift["staff"]) => (typeof s === "object" && s ? String(s._id || "") : String(s || ""));
const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }) : "";

export default function TurnosPage() {
  const [semana, setSemana] = useState(() => weekKey(hoy()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [equipo, setEquipo] = useState<WeekStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [personal, setPersonal] = useState<{ _id: string; full_name?: string }[]>([]);
  const [form, setForm] = useState({
    staff: "", shift_date: hoy(), starts_at: "", ends_at: "",
    role_label: "", break_min: "", notes: "",
  });

  const dias = useMemo(() => DIAS.map((_, i) => addDays(semana, i)), [semana]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, t] = await Promise.all([
      api.get<Shift[]>(`/api/erp/shift?limit=500&filter.shift_date.gte=${semana}&filter.shift_date.lte=${addDays(semana, 6)}`),
      api.get<{ weekOf: string; staff: WeekStaff[] }>(`/api/team/week?date=${semana}`),
    ]);
    setLoading(false);
    if (s.ok === false) {
      console.error("[turnos] error cargando turnos:", s.error);
      toast.error(s.error?.message || "No se pudieron cargar los turnos");
    }
    if (t.ok === false) console.error("[turnos] error cargando el equipo:", t.error);
    setShifts(s.ok === true ? s.data || [] : []);
    setEquipo(t.ok === true ? t.data?.staff || [] : []);
  }, [semana]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    api.get<{ _id: string; full_name?: string }[]>("/api/erp/staff?limit=300&filter.status=active").then((r) => {
      if (r.ok === false) {
        console.error("[turnos] error cargando personal:", r.error);
        return;
      }
      setPersonal(r.data || []);
    });
  }, [open]);

  const crear = async () => {
    if (!form.staff) {
      toast.error("Elige a quién asignas el turno.");
      return;
    }
    setBusy(true);
    const res = await api.post("/api/erp/shift", {
      staff: form.staff,
      shift_date: form.shift_date,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      role_label: form.role_label || null,
      break_min: form.break_min ? Number(form.break_min) : null,
      notes: form.notes || null,
      status: "planned",
    });
    setBusy(false);
    if (res.ok === false) {
      // El bloqueo por certificación llega por aquí: el mensaje del servidor
      // dice QUÉ certificación, así que se enseña tal cual.
      toast.error(res.error?.message || "No se pudo crear el turno");
      return;
    }
    setOpen(false);
    toast.success("Turno creado en planificación.");
    await load();
  };

  const publicar = async () => {
    setBusy(true);
    const res = await api.post<{ published: number; rejected: { label: string; reason: string }[] }>(
      "/api/shifts/publish", { from: semana, to: addDays(semana, 6) }
    );
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo publicar el cuadrante");
      return;
    }
    const { published = 0, rejected = [] } = res.data ?? {};
    if (published > 0) toast.success(`${published} turnos publicados.`);
    if (published === 0 && rejected.length === 0) toast.info("No había turnos en planificación esta semana.");
    for (const r of rejected) toast.warning(`${r.label}: ${r.reason}`);
    await load();
  };

  const porPersonaYDia = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const key = `${staffId(s.staff)}|${String(s.shift_date || "").slice(0, 10)}`;
      map.set(key, [...(map.get(key) || []), s]);
    }
    return map;
  }, [shifts]);

  const planificados = shifts.filter((s) => s.status === "planned").length;
  const horas = shifts.reduce((acc, s) => acc + plannedHours(s), 0);
  const bloqueados = equipo.filter((e) => e.blocked);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Equipo"
        title="Turnos"
        description="El cuadrante de la semana en rejilla. Publicar comprueba solapes y certificaciones antes de comprometer a nadie."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(true)}>
              <Icon name="Plus" className="mr-2 h-4 w-4" />
              Nuevo turno
            </Button>
            <Button onClick={publicar} disabled={busy || planificados === 0}>
              <Icon name="Send" className="mr-2 h-4 w-4" />
              Publicar semana ({planificados})
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Turnos" value={formatNumber(shifts.length)} icon="BriefcaseBusiness" />
        <KpiCard label="En planificación" value={formatNumber(planificados)} icon="CalendarDays"
          hint="Solo estos se publican; lo confirmado ya está comprometido." />
        <KpiCard label="Horas previstas" value={formatNumber(horas)} icon="Clock" />
        <KpiCard label="Sin poder asignar" value={formatNumber(bloqueados.length)} icon="ShieldAlert"
          hint="Personas con una certificación obligatoria vencida o revocada." />
      </div>

      {bloqueados.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">No se les puede asignar trabajo</CardTitle>
            <CardDescription>Renueva la acreditación o quita la marca de bloqueo en la certificación.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {bloqueados.map((b) => (
              <p key={b.staffId}>
                <span className="font-semibold">{b.name}</span>{" "}
                <span className="text-muted-foreground">{b.blockReason}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setSemana(addDays(semana, -7))}>
          <Icon name="ChevronLeft" className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold tabular-nums">
          {semana} — {addDays(semana, 6)}
        </p>
        <Button variant="outline" size="sm" onClick={() => setSemana(addDays(semana, 7))}>
          <Icon name="ChevronRight" className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSemana(weekKey(hoy()))}>Esta semana</Button>
      </div>

      {/* ───────────────────────────── la rejilla ──────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-semibold">Persona</th>
              {dias.map((d, i) => (
                <th key={d} className="p-3 text-left font-semibold">
                  {DIAS[i]} <span className="text-xs font-normal text-muted-foreground">{d.slice(8)}</span>
                </th>
              ))}
              <th className="p-3 text-right font-semibold">Horas</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Cargando…</td></tr>
            )}
            {!loading && equipo.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">
                No hay personal activo. Da de alta al equipo en «Personal».
              </td></tr>
            )}
            {!loading && equipo.map((p) => (
              <tr key={p.staffId} className="border-t">
                <td className="p-3 align-top">
                  <p className="font-semibold">{p.name}</p>
                  {p.blocked && <p className="text-xs text-destructive">Bloqueado por certificación</p>}
                  {!p.blocked && p.expiring > 0 && (
                    <p className="text-xs text-amber-600">{p.expiring} por vencer</p>
                  )}
                </td>
                {dias.map((d) => {
                  const celda = porPersonaYDia.get(`${p.staffId}|${d}`) || [];
                  return (
                    <td key={d} className="p-2 align-top">
                      {celda.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        celda.map((s) => (
                          <div key={s._id} className="mb-1 rounded border bg-card p-2">
                            <p className="text-xs font-semibold">{s.role_label || "Turno"}</p>
                            {s.starts_at && (
                              <p className="text-xs tabular-nums text-muted-foreground">
                                {hhmm(s.starts_at)}–{hhmm(s.ends_at)}
                              </p>
                            )}
                            <StatusBadge value={s.status} dict={SHIFT_STATUS} dot={false} />
                          </div>
                        ))
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-right align-top font-semibold tabular-nums">
                  {formatNumber(p.plannedHours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ───────────────────────────── nuevo turno ─────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo turno</DialogTitle>
            <DialogDescription>
              Nace en planificación. Se comprueba la certificación de la persona al guardarlo, no al publicar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Persona</Label>
              <Select value={form.staff} onValueChange={(v) => setForm((f) => ({ ...f, staff: v }))}>
                <SelectTrigger><SelectValue placeholder="Elige a quién" /></SelectTrigger>
                <SelectContent>
                  {personal.map((p) => (
                    <SelectItem key={p._id} value={p._id}>{p.full_name || p._id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fecha">Fecha</Label>
                <Input id="fecha" type="date" value={form.shift_date}
                  onChange={(e) => setForm((f) => ({ ...f, shift_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rol">Puesto</Label>
                <Input id="rol" placeholder="Guía, cajero, conductor…" value={form.role_label}
                  onChange={(e) => setForm((f) => ({ ...f, role_label: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ini">Entrada</Label>
                <Input id="ini" type="datetime-local" value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fin">Salida</Label>
                <Input id="fin" type="datetime-local" value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Descanso (min)</Label>
              <Input id="desc" type="number" min="0" value={form.break_min}
                onChange={(e) => setForm((f) => ({ ...f, break_min: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notas">Notas</Label>
              <Textarea id="notas" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={crear} disabled={busy}>{busy ? "Guardando…" : "Crear turno"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        Estados: {optionsFrom(SHIFT_STATUS).map((o) => o.label).join(" · ")}.
      </p>
    </div>
  );
}
