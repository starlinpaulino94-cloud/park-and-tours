"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/tf/status-badge";
import { formatMoney, formatNumber } from "@/lib/format";
import { PERIOD_STATUS } from "@/lib/labels-modules";
import type { IncomeStatement, BalanceSheet, AccountBalance } from "@/lib/financials";

/**
 * ESTADOS FINANCIEROS Y CIERRE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA
 *
 * Solo balance de comprobación, que es una herramienta de contable para ver si
 * los libros cuadran. El dueño de la operadora no pregunta «¿cuadra el mayor?»:
 * pregunta cuánto ganó el mes y qué tiene. Eso son el estado de resultados y el
 * balance general, y no existían en ninguna pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CIERRE NO ES ADORNO
 *
 * Nada impedía contabilizar dentro de un mes ya declarado. El 607 se envía el
 * día 20 y el sistema aceptaba tan tranquilamente un asiento con fecha del mes
 * anterior; a partir de ahí lo declarado y los libros dicen cosas distintas.
 * Desde aquí el periodo se cierra —y se reabre, si hace falta— y se marca como
 * declarado, que es lo que NO se reabre: corregir un mes enviado es una
 * rectificativa ante la DGII.
 */

interface Statements {
  range: { from: string; to: string };
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  trialBalance: AccountBalance[];
}

interface Period {
  _id?: string; period: string; status: string;
  net_income?: number; closed_at?: string; locked_at?: string;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function EstadosPage() {
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [data, setData] = useState<Statements | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));

  const load = useCallback(async () => {
    setLoading(true);
    const [s, p] = await Promise.all([
      api.get<Statements>(`/api/ledger/statements?from=${from}&to=${to}`),
      api.get<Period[]>("/api/ledger/periods"),
    ]);
    setLoading(false);
    if (s.ok === false) {
      console.error("[estados] error cargando los estados:", s.error);
      toast.error(s.error?.message || "No se pudieron cargar los estados");
      setData(null);
    } else setData(s.data ?? null);
    if (p.ok === false) console.error("[estados] error cargando periodos:", p.error);
    else setPeriods(p.data || []);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const mover = async (period: string, action: "close" | "reopen" | "lock") => {
    setBusy(true);
    const res = await api.post<{ status: string }>("/api/ledger/periods", { period, action });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo cambiar el periodo");
      return;
    }
    toast.success(
      action === "close" ? `${period} cerrado.`
      : action === "lock" ? `${period} marcado como declarado.`
      : `${period} reabierto.`
    );
    await load();
  };

  const cerrarEjercicio = async () => {
    setBusy(true);
    const res = await api.post<{ entryCode: string; total: number }>("/api/ledger/close-year", { year });
    setBusy(false);
    if (res.ok === false) {
      toast.error(res.error?.message || "No se pudo cerrar el ejercicio");
      return;
    }
    toast.success(`Ejercicio ${year} cerrado con el asiento ${res.data?.entryCode}.`);
    await load();
  };

  const er = data?.incomeStatement;
  const bg = data?.balanceSheet;
  const estadoDe = (p: string) => periods.find((x) => x.period === p)?.status ?? "open";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Estados financieros"
        description="Cuánto ganó la empresa y qué tiene, con el cierre de periodo que impide contabilizar dentro de un mes ya declarado."
        actions={
          <Button variant="outline" asChild>
            <a href={`/api/ledger/statements?from=${from}&to=${to}&format=csv`}>
              <Icon name="Download" className="mr-2 h-4 w-4" />
              Exportar para el contador
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="d">Desde</Label>
          <Input id="d" type="month" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="h">Hasta</Label>
          <Input id="h" type="month" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <StatusBadge value={estadoDe(to)} dict={PERIOD_STATUS} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ingresos" value={formatMoney(er?.totalRevenue ?? 0, "dop")} icon="TrendingUp"
          hint="Ventas menos descuentos y devoluciones." />
        <KpiCard label="Gastos" value={formatMoney(er?.totalExpenses ?? 0, "dop")} icon="TrendingDown" />
        <KpiCard label="Resultado del periodo" value={formatMoney(er?.netIncome ?? 0, "dop")} icon="Scale"
          hint={`Margen ${formatNumber(er?.marginPct ?? 0)} %`} />
        <KpiCard label="Activo total" value={formatMoney(bg?.totalAssets ?? 0, "dop")} icon="Landmark" />
      </div>

      {bg && !bg.balanced && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">El balance no cuadra</CardTitle>
            <CardDescription>
              Diferencia de {formatMoney(bg.difference, "dop")} entre el activo y el pasivo más el patrimonio.
              Casi siempre es un asiento contabilizado contra una cuenta de naturaleza equivocada:
              revísalo en el libro diario antes de dar el periodo por bueno.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─────────────────────── estado de resultados ─────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Estado de resultados</CardTitle>
            <CardDescription>{from} — {to}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading && <p className="text-muted-foreground">Cargando…</p>}
            {!loading && er && (
              <>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Ingresos</p>
                {er.revenue.length === 0 && <p className="text-muted-foreground">Sin ingresos en el periodo.</p>}
                {er.revenue.map((r) => (
                  <div key={r.code} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.code} · {r.name}</span>
                    <span className="tabular-nums">{formatMoney(r.amount, "dop")}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                  <span>Total ingresos</span>
                  <span className="tabular-nums">{formatMoney(er.totalRevenue, "dop")}</span>
                </div>

                <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Gastos</p>
                {er.expenses.map((r) => (
                  <div key={r.code} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.code} · {r.name}</span>
                    <span className="tabular-nums">{formatMoney(r.amount, "dop")}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                  <span>Total gastos</span>
                  <span className="tabular-nums">{formatMoney(er.totalExpenses, "dop")}</span>
                </div>

                <div className="flex justify-between gap-3 border-t-2 pt-2 text-base font-bold">
                  <span>Resultado</span>
                  <span className={`tabular-nums ${er.netIncome < 0 ? "text-destructive" : ""}`}>
                    {formatMoney(er.netIncome, "dop")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Margen bruto {formatMoney(er.grossMargin, "dop")} — ingresos menos el costo directo de operar
                  lo vendido, sin los gastos de estructura.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* ───────────────────────── balance general ────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Balance general</CardTitle>
            <CardDescription>Acumulado hasta {to}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!loading && bg && (
              <>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Activo</p>
                {bg.assets.map((r) => (
                  <div key={r.code} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.code} · {r.name}</span>
                    <span className="tabular-nums">{formatMoney(r.amount, "dop")}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                  <span>Total activo</span>
                  <span className="tabular-nums">{formatMoney(bg.totalAssets, "dop")}</span>
                </div>

                <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Pasivo</p>
                {bg.liabilities.map((r) => (
                  <div key={r.code} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.code} · {r.name}</span>
                    <span className="tabular-nums">{formatMoney(r.amount, "dop")}</span>
                  </div>
                ))}

                <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Patrimonio</p>
                {bg.equity.map((r) => (
                  <div key={r.code} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.code} · {r.name}</span>
                    <span className="tabular-nums">{formatMoney(r.amount, "dop")}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Resultado del ejercicio</span>
                  <span className="tabular-nums">{formatMoney(bg.currentResult, "dop")}</span>
                </div>

                <div className="flex justify-between gap-3 border-t-2 pt-2 font-bold">
                  <span>Pasivo + patrimonio</span>
                  <span className="tabular-nums">
                    {formatMoney(bg.totalLiabilities + bg.totalEquity, "dop")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  El resultado del ejercicio en curso todavía no está en «Resultados acumulados»: eso lo hace
                  el asiento de cierre. Por eso aparece como línea propia.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─────────────────────────── cierre de periodo ─────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cierre de periodo</CardTitle>
          <CardDescription>
            Cerrar impide contabilizar dentro de ese mes y se puede deshacer. «Declarado» es lo que ya se envió
            a la DGII y NO se reabre desde aquí: corregirlo es una rectificativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Periodo {to}:</span>
            <StatusBadge value={estadoDe(to)} dict={PERIOD_STATUS} />
            {estadoDe(to) === "open" && (
              <Button size="sm" onClick={() => mover(to, "close")} disabled={busy}>Cerrar</Button>
            )}
            {estadoDe(to) === "closed" && (
              <>
                <Button size="sm" onClick={() => mover(to, "lock")} disabled={busy}>Marcar como declarado</Button>
                <Button size="sm" variant="outline" onClick={() => mover(to, "reopen")} disabled={busy}>Reabrir</Button>
              </>
            )}
            {estadoDe(to) === "locked" && (
              <span className="text-sm text-muted-foreground">Declarado a la DGII. No se reabre desde aquí.</span>
            )}
          </div>

          {periods.length > 0 && (
            <div className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {periods.slice(0, 12).map((p) => (
                <div key={p.period} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                  <span className="tabular-nums">{p.period}</span>
                  <StatusBadge value={p.status} dict={PERIOD_STATUS} />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="y">Cerrar ejercicio</Label>
              <Input id="y" className="w-28" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <Button variant="outline" onClick={cerrarEjercicio} disabled={busy}>
              <Icon name="Scale" className="mr-2 h-4 w-4" />
              Llevar el resultado a acumulados
            </Button>
            <p className="max-w-xl text-xs text-muted-foreground">
              Salda los ingresos y los gastos del año contra «Resultados acumulados». Sin este asiento, el año
              que viene el estado de resultados incluiría este. Se hace una sola vez por ejercicio.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
