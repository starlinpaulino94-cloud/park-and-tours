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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATTENDANCE_METHOD, ATTENDANCE_STATUS } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * ASISTENCIA: EL RELOJ, NO LA CALCULADORA.
 *
 * Esta pantalla era un formulario genérico con un campo «Horas trabajadas» que
 * se teclaba a mano teniendo al lado la entrada y la salida. Es decir: el
 * sistema tenía los dos marcajes y le pedía a una persona que hiciera la resta
 * —todos los días, para cada uno del equipo— y de ahí salía la nómina.
 *
 * Ahora hace las tres cosas que faltaban:
 *
 *  1. **Fichar.** Un botón. Las horas las calcula el servidor con los dos
 *     instantes completos, así que el turno de noche que cruza la medianoche
 *     sale bien en vez de salir negativo.
 *  2. **Aprobar.** El visto bueno del encargado es lo que convierte un marcaje
 *     en horas pagables, y recalcula antes de aprobar por si alguien corrigió
 *     la hora a mano.
 *  3. **Ver lo que está trabado.** Un marcaje ya incluido en una corrida de
 *     nómina no se toca: ahí se dice, en vez de dejar que alguien lo intente.
 */

interface Attendance {
  _id: string; attendance_date?: string; clock_in?: string; clock_out?: string;
  hours_worked?: number; regular_hours?: number; overtime_hours?: number; break_min?: number;
  status?: string; method?: string; notes?: string;
  approved_at?: string; payroll_run_id?: string;
  staff?: { _id?: string; full_name?: string } | string;
}

interface MiFichaje {
  linked: boolean; staffId?: string; staffName?: string | null;
  today: Attendance | null; canClockIn?: boolean; canClockOut?: boolean;
}

const hoy = () => new Date().toISOString().slice(0, 10);
const hora = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }) : "—");
const nombre = (s: Attendance["staff"]) => (typeof s === "object" && s ? s.full_name || "—" : "—");

export default function AsistenciaPage() {
  const [rows, setRows] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [estado, setEstado] = useState("__all");
  const [mio, setMio] = useState<MiFichaje | null>(null);

  /**
   * El alta a mano existe para lo que NO tiene marcaje: la ausencia, las
   * vacaciones, el día de enfermedad, o la jornada de quien trabajó donde no
   * hay kiosco. Sin ella, esos días no existirían para la nómina y el encargado
   * volvería a llevarlos aparte — que es de donde venimos.
   */
  const [manual, setManual] = useState(false);
  const [personal, setPersonal] = useState<{ _id: string; full_name?: string }[]>([]);
  const [form, setForm] = useState({
    staff: "", attendance_date: hoy(), status: "absent",
    clock_in: "", clock_out: "", break_min: "", notes: "",
  });

  const cargarMio = useCallback(async () => {
    const res = await api.get<MiFichaje>("/api/attendance/clock");
    if (res.ok === false) {
      console.error("[asistencia] no se pudo leer el fichaje propio:", res.error);
      return;
    }
    setMio(res.data ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    params.set("filter.attendance_date.gte", desde);
    params.set("filter.attendance_date.lte", hasta);
    if (estado !== "__all") params.set("filter.status", estado);
    const res = await api.get<Attendance[]>(`/api/erp/attendance?${params}`);
    setLoading(false);
    if (res.ok === false) {
      console.error("[asistencia] error cargando marcajes:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar los marcajes");
      setRows([]);
      return;
    }
    setRows(res.data || []);
  }, [desde, hasta, estado]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { cargarMio(); }, [cargarMio]);

  useEffect(() => {
    if (!manual) return;
    api.get<{ _id: string; full_name?: string }[]>("/api/erp/staff?limit=300&filter.status=active").then((r) => {
      if (r.ok === false) {
        console.error("[asistencia] error cargando personal:", r.error);
        return;
      }
      setPersonal(r.data || []);
    });
  }, [manual]);

  const registrar = async () => {
    if (!form.staff) {
      toast.error("Elige a quién corresponde el registro.");
      return;
    }
    setBusy(true);
    const res = await api.post("/api/erp/attendance", {
      staff: form.staff,
      attendance_date: form.attendance_date,
      status: form.status,
      method: "manual",
      clock_in: form.clock_in || null,
      clock_out: form.clock_out || null,
      break_min: form.break_min ? Number(form.break_min) : null,
      notes: form.notes || null,
    });
    setBusy(false);
    if (res.ok === false) {
      // El índice único de la base contesta aquí cuando ya hay un marcaje de esa
      // persona ese día: dos filas del mismo día son horas contadas dos veces.
      toast.error(res.error?.message || "No se pudo registrar");
      return;
    }
    setManual(false);
    toast.success("Registrado. Recuerda aprobarlo para que entre en la nómina.");
    await load();
  };

  const fichar = async (action: "in" | "out") => {
    setBusy(true);
    const res = await api.post<{ hours: { worked: number; overtime: number } }>("/api/attendance/clock", { action });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo fichar");
      return;
    }
    toast.success(
      action === "in"
        ? "Entrada marcada"
        : `Salida marcada: ${formatNumber(res.data?.hours.worked ?? 0)} h` +
          ((res.data?.hours.overtime ?? 0) > 0 ? ` (${formatNumber(res.data!.hours.overtime)} extra)` : "")
    );
    await Promise.all([cargarMio(), load()]);
  };

  const aprobar = async (row: Attendance, revoke = false) => {
    setBusy(true);
    const res = await api.post(`/api/attendance/${row._id}/approve`, { revoke });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo aprobar");
      return;
    }
    toast.success(revoke ? "Aprobación retirada" : "Asistencia aprobada");
    await load();
  };

  const totales = rows.reduce(
    (acc, r) => ({
      horas: acc.horas + (r.hours_worked ?? 0),
      extra: acc.extra + (r.overtime_hours ?? 0),
      aprobadas: acc.aprobadas + (r.approved_at ? 1 : 0),
    }),
    { horas: 0, extra: 0, aprobadas: 0 }
  );
  const pendientes = rows.length - totales.aprobadas;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Equipo"
        title="Asistencia"
        description="Marcajes con horas calculadas, aprobación del encargado y el enlace directo con la nómina."
        actions={
          <Button variant="outline" onClick={() => setManual(true)}>
            <Icon name="Plus" className="mr-2 h-4 w-4" />
            Registrar a mano
          </Button>
        }
      />

      {/* ───────────────────────────── mi fichaje ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mi jornada de hoy</CardTitle>
          <CardDescription>
            {mio?.linked === false
              ? "Tu usuario no está enlazado a una ficha de personal, así que no puedes fichar. Pídeselo a quien administra el sistema."
              : "El servidor calcula las horas con los dos marcajes; el descanso se descuenta."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Entrada</p>
              <p className="font-semibold tabular-nums">{hora(mio?.today?.clock_in)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Salida</p>
              <p className="font-semibold tabular-nums">{hora(mio?.today?.clock_out)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Horas</p>
              <p className="font-semibold tabular-nums">{formatNumber(mio?.today?.hours_worked ?? 0)}</p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => fichar("in")} disabled={busy || !mio?.canClockIn}>
              <Icon name="LogIn" className="mr-2 h-4 w-4" />
              Marcar entrada
            </Button>
            <Button variant="outline" onClick={() => fichar("out")} disabled={busy || !mio?.canClockOut}>
              <Icon name="LogOut" className="mr-2 h-4 w-4" />
              Marcar salida
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Marcajes" value={formatNumber(rows.length)} icon="UserRoundCheck" />
        <KpiCard label="Horas del periodo" value={formatNumber(totales.horas)} icon="Clock" />
        <KpiCard label="Horas extra" value={formatNumber(totales.extra)} icon="TrendingUp"
          hint="Al 35 % hasta 68 h semanales; al 100 % por encima." />
        <KpiCard label="Sin aprobar" value={formatNumber(pendientes)} icon="CircleAlert"
          hint="Solo las horas aprobadas entran en la nómina." />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="d">Desde</Label>
          <Input id="d" type="date" className="w-40" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="h">Hasta</Label>
          <Input id="h" type="date" className="w-40" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos los estados</SelectItem>
            {optionsFrom(ATTENDANCE_STATUS).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        emptyIcon="UserRoundCheck"
        emptyTitle="Sin marcajes en este rango"
        emptyDescription="Ficha desde arriba o amplía las fechas."
        columns={[
          { key: "date", header: "Fecha", render: (r: Attendance) => formatDate(r.attendance_date) },
          { key: "staff", header: "Persona", render: (r: Attendance) => <span className="font-semibold">{nombre(r.staff)}</span> },
          { key: "in", header: "Entrada", align: "right", render: (r: Attendance) => <span className="tabular-nums">{hora(r.clock_in)}</span> },
          { key: "out", header: "Salida", align: "right", render: (r: Attendance) => <span className="tabular-nums">{hora(r.clock_out)}</span> },
          {
            key: "hours", header: "Horas", align: "right",
            render: (r: Attendance) => (
              <span className="tabular-nums">
                {formatNumber(r.hours_worked ?? 0)}
                {(r.overtime_hours ?? 0) > 0 && <span className="text-amber-600"> +{formatNumber(r.overtime_hours!)}</span>}
              </span>
            ),
          },
          { key: "status", header: "Estado", render: (r: Attendance) => <StatusBadge value={r.status} dict={ATTENDANCE_STATUS} /> },
          { key: "method", header: "Método", hideOn: "lg", render: (r: Attendance) => <StatusBadge value={r.method} dict={ATTENDANCE_METHOD} dot={false} /> },
          {
            key: "ok", header: "Nómina", align: "right",
            render: (r: Attendance) =>
              r.payroll_run_id ? (
                <span className="text-xs text-muted-foreground">Pagado</span>
              ) : r.approved_at ? (
                <Button size="sm" variant="ghost" onClick={() => aprobar(r, true)} disabled={busy}>
                  <Icon name="CircleCheck" className="mr-1 h-4 w-4 text-emerald-600" />
                  Aprobado
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => aprobar(r)} disabled={busy}>
                  Aprobar
                </Button>
              ),
          },
        ]}
      />

      {/* ──────────────────── ausencias y días sin kiosco ──────────────────── */}
      <Dialog open={manual} onOpenChange={setManual}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar asistencia a mano</DialogTitle>
            <DialogDescription>
              Para lo que no tiene marcaje: una ausencia, vacaciones, enfermedad, o una jornada
              trabajada donde no hay kiosco. Si pones entrada y salida, las horas las calcula el sistema.
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
                <Input id="fecha" type="date" value={form.attendance_date}
                  onChange={(e) => setForm((f) => ({ ...f, attendance_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {optionsFrom(ATTENDANCE_STATUS).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="mi">Entrada</Label>
                <Input id="mi" type="datetime-local" value={form.clock_in}
                  onChange={(e) => setForm((f) => ({ ...f, clock_in: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mo">Salida</Label>
                <Input id="mo" type="datetime-local" value={form.clock_out}
                  onChange={(e) => setForm((f) => ({ ...f, clock_out: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="br">Descanso (min)</Label>
              <Input id="br" type="number" min="0" value={form.break_min}
                onChange={(e) => setForm((f) => ({ ...f, break_min: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nt">Notas</Label>
              <Textarea id="nt" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManual(false)}>Cancelar</Button>
            <Button onClick={registrar} disabled={busy}>{busy ? "Guardando…" : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
