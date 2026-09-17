"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import type { Alert, Confidence, Forecast, LeadBucket } from "@/lib/analytics";

/**
 * ¿VA A SALIR LLENA?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA DECISIÓN QUE ESTA PANTALLA SOSTIENE
 *
 * Confirmar el segundo autobús, soltar cupo, hacer una oferta de última hora.
 * Todas se toman hoy, con la salida a medio vender, y mirar cuánto lleva
 * vendido no basta: hay que saber cuánto SUELE llevar vendido a esa misma
 * distancia.
 *
 * La curva sale de las salidas pasadas de esta misma operadora, no de un
 * supuesto de manual. Por eso se enseña de cuántas se aprendió: una previsión
 * con tres salidas detrás y otra con trescientas no valen lo mismo, y sin ese
 * número tendrían el mismo aspecto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS ALERTAS SON POCAS A PROPÓSITO
 *
 * Una alerta que no lleva a una acción es ruido, y el ruido hace que se dejen de
 * mirar las que sí importan. Solo se avisa dentro del horizonte en el que
 * todavía se puede hacer algo, y una previsión sin confianza no dispara nada:
 * decir «cancela el autobús» con dos salidas pasadas es peor que callarse.
 */

interface ForecastRow {
  departureId: string;
  product: string;
  travelAt: string;
  capacity: number;
  soldSeats: number;
  daysOut: number;
  forecast: Forecast;
}

interface Report {
  curveSample: number;
  rows: ForecastRow[];
  alerts: Alert[];
  leads: LeadBucket[];
}

const CONFIANZA: Record<Confidence, { label: string; tone: string }> = {
  high: { label: "Alta", tone: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  medium: { label: "Media", tone: "bg-sky-100 text-sky-900 border-sky-200" },
  low: { label: "Indicio", tone: "bg-amber-100 text-amber-900 border-amber-200" },
  none: { label: "Sin base", tone: "bg-zinc-100 text-zinc-600 border-zinc-200" },
};

const SEVERIDAD: Record<string, string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-sky-300 bg-sky-50 text-sky-900",
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-DO", { weekday: "short", day: "2-digit", month: "short" });

export default function OcupacionPage() {
  const [data, setData] = useState<Report | null>(null);
  const [horizon, setHorizon] = useState("60");
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Report>(`/api/analytics/occupancy?horizon=${horizon}`);
    setLoading(false);
    if (res.ok === false) {
      toast.error(res.error || "No se pudo calcular la previsión");
      return;
    }
    setData(res.data);
  }, [horizon]);

  useEffect(() => { void cargar(); }, [cargar]);

  const filas = data?.rows ?? [];
  const alertas = data?.alerts ?? [];
  const criticas = alertas.filter((a) => a.severity === "critical").length;
  const enRiesgo = filas.filter((f) => f.forecast.confidence !== "none" && f.forecast.expectedPct < 50).length;
  const plazas = filas.reduce((acc, f) => acc + f.capacity, 0);
  const vendidas = filas.reduce((acc, f) => acc + f.soldSeats, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analítica"
        title="Previsión de ocupación"
        description="Cuánto suele llevarse vendido a esta distancia, aplicado a lo que hay hoy."
        actions={
          <div className="flex items-center gap-2">
            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="14">Próximos 14 días</SelectItem>
                <SelectItem value="30">Próximos 30 días</SelectItem>
                <SelectItem value="60">Próximos 60 días</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void cargar()} disabled={loading}>
              <Icon name="RefreshCw" className="mr-2 h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Salidas en el horizonte" value={formatNumber(filas.length)} icon="CalendarRange" />
        <KpiCard
          label="Ocupación actual"
          value={plazas > 0 ? `${Math.round((vendidas / plazas) * 100)} %` : "—"}
          icon="Users"
          hint={`${formatNumber(vendidas)} de ${formatNumber(plazas)} plazas`}
        />
        <KpiCard label="Camino de media entrada" value={formatNumber(enRiesgo)} icon="TrendingDown" />
        <KpiCard
          label="Requieren acción hoy"
          value={formatNumber(criticas)}
          icon="TriangleAlert"
          hint={data ? `Curva aprendida de ${data.curveSample} salida(s)` : undefined}
        />
      </div>

      {/* ── lo que hay que hacer hoy ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alertas</CardTitle>
          <CardDescription>
            Solo lo que admite una decisión hoy. Una previsión sin base no dispara alerta:
            decir «cancela el autobús» con dos salidas pasadas es peor que callarse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alertas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? "Calculando…" : "Nada que atender: ninguna salida próxima necesita una decisión."}
            </p>
          ) : (
            <ul className="space-y-2">
              {alertas.map((alerta, i) => (
                <li
                  key={`${alerta.departureId}-${i}`}
                  className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 ${SEVERIDAD[alerta.severity]}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {alerta.product || "Salida"} · {fecha(alerta.travelAt)}
                    </p>
                    <p className="text-xs">{alerta.message}</p>
                  </div>
                  <Badge variant="outline" className={`shrink-0 ${CONFIANZA[alerta.confidence].tone}`}>
                    {CONFIANZA[alerta.confidence].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── salida por salida ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salidas próximas</CardTitle>
          <CardDescription>
            «Previsto» es lo vendido hoy dividido por la parte que suele estar vendida a esa
            distancia. Cuando el sistema no puede prever, lo dice en vez de rellenar el hueco.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {filas.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Calculando…" : "No hay salidas programadas en este horizonte."}
            </p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Salida</th>
                  <th className="px-4 py-2 text-left font-medium">Fecha</th>
                  <th className="px-3 py-2 text-right font-medium">Faltan</th>
                  <th className="px-3 py-2 text-right font-medium">Vendido</th>
                  <th className="px-3 py-2 text-right font-medium">Hoy</th>
                  <th className="px-3 py-2 text-right font-medium">Previsto</th>
                  <th className="px-4 py-2 text-left font-medium">Confianza</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const hoy = fila.capacity > 0 ? Math.round((fila.soldSeats / fila.capacity) * 100) : 0;
                  return (
                    <tr key={fila.departureId} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{fila.product || "—"}</td>
                      <td className="px-4 py-2">{fecha(fila.travelAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fila.daysOut} d</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(fila.soldSeats)}
                        <span className="text-muted-foreground"> / {formatNumber(fila.capacity)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoy} %</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {fila.forecast.confidence === "none" ? "—" : `${Math.round(fila.forecast.expectedPct)} %`}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className={CONFIANZA[fila.forecast.confidence].tone}>
                          {CONFIANZA[fila.forecast.confidence].label}
                        </Badge>
                        {fila.forecast.note && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{fila.forecast.note}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── con cuánta antelación compran ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Con cuánta antelación reservan</CardTitle>
          <CardDescription>
            Los tramos cortos están separados a propósito: en una operadora de destino casi todo
            pasa entre el mismo día y tres días antes, y un tramo de «0 a 30» escondería justo
            la parte que hay que gestionar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.leads ?? []).every((b) => b.seats === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? "Calculando…" : "Todavía no hay historial suficiente."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(data?.leads ?? []).map((bucket) => (
                <li key={bucket.from} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{bucket.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, bucket.share)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums">
                    {formatNumber(bucket.share, 1)} %
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
