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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PAYROLL_PERIOD, PAYROLL_STATUS } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { periodFor, TSS_DEFAULTS, type PeriodType } from "@/lib/hr";

/**
 * LA NÓMINA.
 *
 * Hasta aquí, «asistencia» era una lista de marcajes con las horas tecleadas a
 * mano y el ciclo acababa ahí: para pagar, alguien copiaba esas horas a un
 * Excel. Esta pantalla cierra el recorrido —turno, marcaje, horas, pago— y lo
 * deja auditado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE PUEDE EDITAR UN IMPORTE
 *
 * No hay ni un campo de dinero editable. Todo sale de los marcajes y de los
 * porcentajes que la corrida congeló al generarse. Un bruto que se pueda
 * teclear convierte esto en una hoja de cálculo con base de datos —que es
 * justo lo que viene a sustituir— y hace imposible explicar de dónde salió una
 * cifra seis meses después. Si una línea está mal, lo que está mal es el
 * marcaje: se corrige y se vuelve a generar.
 */

interface Run {
  _id: string; code?: string; status?: string; period_type?: string;
  period_start?: string; period_end?: string; currency?: string;
  gross_amount?: number; deductions_amount?: number; net_amount?: number;
  employer_cost?: number; staff_count?: number; notes?: string;
  approved_at?: string; paid_at?: string;
  sfs_employee_pct?: number; afp_employee_pct?: number;
}

interface Line {
  _id: string; staff_name?: string; payroll_code?: string; social_security_id?: string;
  days_worked?: number; regular_hours?: number; overtime_hours?: number; extra_overtime_hours?: number;
  hourly_rate?: number; regular_amount?: number; overtime_amount?: number;
  gross_amount?: number; sfs_employee?: number; afp_employee?: number; isr_amount?: number;
  deductions_amount?: number; net_amount?: number; employer_cost?: number; currency?: string;
}

const hoy = () => new Date().toISOString().slice(0, 10);

export default function NominaPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all");

  const [detail, setDetail] = useState<Run | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const inicial = periodFor("biweekly", hoy());
  const [form, setForm] = useState({
    period_type: "biweekly" as PeriodType,
    period_start: inicial.start,
    period_end: inicial.end,
    currency: "dop",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (statusFilter !== "__all") params.set("filter.status", statusFilter);
    const res = await api.get<Run[]>(`/api/erp/payroll_run?${params}`);
    setLoading(false);
    if (res.ok === false) {
      console.error("[nomina] error cargando corridas:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las corridas");
      setRuns([]);
      return;
    }
    setRuns(res.data || []);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  /** Cambiar el tipo de periodo reencuadra las fechas al periodo que toca. */
  const setPeriodType = (t: PeriodType) => {
    const p = periodFor(t, form.period_start || hoy());
    setForm((f) => ({ ...f, period_type: t, period_start: p.start, period_end: p.end }));
  };

  const openDetail = async (run: Run) => {
    setDetail(run);
    setLinesLoading(true);
    const res = await api.get<Line[]>(`/api/erp/payroll_line?limit=500&filter.payroll_run=${run._id}`);
    setLinesLoading(false);
    if (res.ok === false) {
      console.error("[nomina] error cargando líneas:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las líneas");
      setLines([]);
      return;
    }
    setLines(res.data || []);
  };

  const crear = async () => {
    setBusy(true);
    const res = await api.post<Run>("/api/erp/payroll_run", {
      ...form,
      sfs_employee_pct: TSS_DEFAULTS.sfsEmployee,
      afp_employee_pct: TSS_DEFAULTS.afpEmployee,
      sfs_employer_pct: TSS_DEFAULTS.sfsEmployer,
      afp_employer_pct: TSS_DEFAULTS.afpEmployer,
      risk_employer_pct: TSS_DEFAULTS.riskEmployer,
    });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo crear la corrida");
      return;
    }
    setOpen(false);
    toast.success("Corrida creada. Ahora calcúlala para traer los marcajes.");
    await load();
    if (res.data) await openDetail(res.data);
  };

  const generar = async (run: Run) => {
    setBusy(true);
    const res = await api.post<{ totals: { staffCount: number; net: number }; skipped: { staffName: string; reason: string }[] }>(
      `/api/payroll/${run._id}/generate`, {}
    );
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo calcular la nómina");
      return;
    }
    const saltados = res.data?.skipped ?? [];
    toast.success(`Calculada: ${res.data?.totals.staffCount ?? 0} personas`);
    // Lo que se quedó fuera se dice en voz alta: una persona sin tarifa no
    // aparece en la corrida, y descubrirlo el día de pago es tarde.
    for (const s of saltados) toast.warning(`${s.staffName}: ${s.reason}`);
    await load();
    const fresco = (await api.get<Run>(`/api/erp/payroll_run/${run._id}`));
    if (fresco.ok === true && fresco.data) await openDetail(fresco.data);
  };

  const cambiarEstado = async (run: Run, action: "approve" | "pay" | "cancel") => {
    setBusy(true);
    const res = await api.post<{ status: string; released: number }>(`/api/payroll/${run._id}/status`, { action });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo cambiar el estado");
      return;
    }
    toast.success(
      action === "cancel" && res.data?.released
        ? `Anulada. ${res.data.released} marcajes vuelven a estar disponibles.`
        : "Listo"
    );
    setDetail(null);
    await load();
  };

  const totales = runs.reduce(
    (acc, r) => ({
      net: acc.net + (r.net_amount ?? 0),
      cost: acc.cost + (r.employer_cost ?? 0),
      people: Math.max(acc.people, r.staff_count ?? 0),
    }),
    { net: 0, cost: 0, people: 0 }
  );
  const abierta = runs.find((r) => r.status === "draft");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Equipo"
        title="Nómina"
        description="De los marcajes aprobados al neto a transferir, con TSS e ISR calculados y el archivo para el contador."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Icon name="Plus" className="mr-2 h-4 w-4" />
            Nueva corrida
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Corridas" value={formatNumber(runs.length)} icon="Receipt" />
        <KpiCard label="Neto acumulado" value={formatMoney(totales.net, "dop")} icon="Banknote" />
        <KpiCard label="Costo de empresa" value={formatMoney(totales.cost, "dop")} icon="Building2"
          hint="Bruto más los aportes patronales de TSS y riesgos laborales." />
        <KpiCard label="Personas (mayor corrida)" value={formatNumber(totales.people)} icon="UsersRound" />
      </div>

      {abierta && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-semibold">Hay una corrida en borrador</p>
          <p className="text-muted-foreground">
            {formatDate(abierta.period_start)} — {formatDate(abierta.period_end)}. Mientras esté en borrador
            puedes volver a calcularla: solo añade los marcajes nuevos, nunca repite los ya incluidos.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos los estados</SelectItem>
            {optionsFrom(PAYROLL_STATUS).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={runs}
        loading={loading}
        onRowClick={openDetail}
        emptyIcon="Receipt"
        emptyTitle="Sin corridas de nómina"
        emptyDescription="Crea la primera quincena: el sistema traerá los marcajes del periodo."
        columns={[
          {
            key: "period", header: "Periodo",
            render: (r: Run) => (
              <div>
                <p className="font-semibold">{formatDate(r.period_start)} — {formatDate(r.period_end)}</p>
                <p className="text-xs text-muted-foreground">{r.code || "Sin código"}</p>
              </div>
            ),
          },
          { key: "type", header: "Tipo", hideOn: "md", render: (r: Run) => <StatusBadge value={r.period_type} dict={PAYROLL_PERIOD} dot={false} /> },
          { key: "people", header: "Personas", align: "right", render: (r: Run) => formatNumber(r.staff_count ?? 0) },
          { key: "gross", header: "Bruto", align: "right", hideOn: "sm", render: (r: Run) => formatMoney(r.gross_amount ?? 0, r.currency || "dop") },
          { key: "ded", header: "Deducciones", align: "right", hideOn: "lg", render: (r: Run) => formatMoney(r.deductions_amount ?? 0, r.currency || "dop") },
          { key: "net", header: "Neto", align: "right", render: (r: Run) => <span className="font-semibold">{formatMoney(r.net_amount ?? 0, r.currency || "dop")}</span> },
          { key: "status", header: "Estado", render: (r: Run) => <StatusBadge value={r.status} dict={PAYROLL_STATUS} /> },
        ]}
      />

      {/* ─────────────────────────────── crear ─────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva corrida de nómina</DialogTitle>
            <DialogDescription>
              Elige el periodo. Los porcentajes de la TSS quedan congelados en la corrida: cuando cambien,
              lo pagado hoy seguirá explicándose con los de hoy.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de periodo</Label>
              <Select value={form.period_type} onValueChange={(v) => setPeriodType(v as PeriodType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(PAYROLL_PERIOD).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="desde">Desde</Label>
                <Input id="desde" type="date" value={form.period_start}
                  onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hasta">Hasta</Label>
                <Input id="hasta" type="date" value={form.period_end}
                  onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notas">Notas</Label>
              <Textarea id="notas" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={crear} disabled={busy}>{busy ? "Creando…" : "Crear corrida"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────── detalle ───────────────────────────── */}
      <Sheet open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {formatDate(detail.period_start)} — {formatDate(detail.period_end)}
                </SheetTitle>
                <SheetDescription>
                  <StatusBadge value={detail.status} dict={PAYROLL_STATUS} />{" "}
                  {detail.code || ""}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Bruto</p>
                    <p className="font-semibold tabular-nums">{formatMoney(detail.gross_amount ?? 0, detail.currency || "dop")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Deducciones</p>
                    <p className="font-semibold tabular-nums">{formatMoney(detail.deductions_amount ?? 0, detail.currency || "dop")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Neto a pagar</p>
                    <p className="font-semibold tabular-nums">{formatMoney(detail.net_amount ?? 0, detail.currency || "dop")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Costo empresa</p>
                    <p className="font-semibold tabular-nums">{formatMoney(detail.employer_cost ?? 0, detail.currency || "dop")}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail.status === "draft" && (
                    <>
                      <Button size="sm" onClick={() => generar(detail)} disabled={busy}>
                        <Icon name="Calculator" className="mr-2 h-4 w-4" />
                        Calcular
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cambiarEstado(detail, "approve")} disabled={busy || (detail.staff_count ?? 0) === 0}>
                        <Icon name="Check" className="mr-2 h-4 w-4" />
                        Aprobar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cambiarEstado(detail, "cancel")} disabled={busy}>
                        Anular
                      </Button>
                    </>
                  )}
                  {detail.status === "approved" && (
                    <Button size="sm" onClick={() => cambiarEstado(detail, "pay")} disabled={busy}>
                      <Icon name="Banknote" className="mr-2 h-4 w-4" />
                      Marcar como pagada
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/payroll/${detail._id}/export`}>
                      <Icon name="Download" className="mr-2 h-4 w-4" />
                      Exportar para el contador
                    </a>
                  </Button>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Detalle por persona</h3>
                  <DataTable
                    rows={lines}
                    loading={linesLoading}
                    emptyIcon="Users"
                    emptyTitle="Sin líneas"
                    emptyDescription="Pulsa «Calcular» para traer los marcajes del periodo."
                    columns={[
                      {
                        key: "name", header: "Persona",
                        render: (l: Line) => (
                          <div>
                            <p className="font-semibold">{l.staff_name}</p>
                            <p className="text-xs text-muted-foreground">{l.payroll_code || l.social_security_id || "—"}</p>
                          </div>
                        ),
                      },
                      { key: "days", header: "Días", align: "right", hideOn: "md", render: (l: Line) => formatNumber(l.days_worked ?? 0) },
                      {
                        key: "hours", header: "Horas", align: "right",
                        render: (l: Line) => (
                          <span className="tabular-nums">
                            {formatNumber(l.regular_hours ?? 0)}
                            {(l.overtime_hours ?? 0) + (l.extra_overtime_hours ?? 0) > 0 && (
                              <span className="text-amber-600"> +{formatNumber((l.overtime_hours ?? 0) + (l.extra_overtime_hours ?? 0))}</span>
                            )}
                          </span>
                        ),
                      },
                      { key: "gross", header: "Bruto", align: "right", hideOn: "sm", render: (l: Line) => formatMoney(l.gross_amount ?? 0, l.currency || "dop") },
                      { key: "ded", header: "Deduc.", align: "right", hideOn: "lg", render: (l: Line) => formatMoney(l.deductions_amount ?? 0, l.currency || "dop") },
                      { key: "net", header: "Neto", align: "right", render: (l: Line) => <span className="font-semibold tabular-nums">{formatMoney(l.net_amount ?? 0, l.currency || "dop")}</span> },
                    ]}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  SFS {detail.sfs_employee_pct ?? TSS_DEFAULTS.sfsEmployee}% y AFP {detail.afp_employee_pct ?? TSS_DEFAULTS.afpEmployee}%
                  sobre el bruto; el ISR se retiene sobre lo que queda después de la Seguridad Social, con la escala anual
                  repartida en el periodo. Las horas extra van al 35 % hasta 68 h semanales y al 100 % por encima.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
