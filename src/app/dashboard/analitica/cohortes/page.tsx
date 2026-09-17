"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, formatNumber } from "@/lib/format";
import type { CohortRow } from "@/lib/analytics";

/**
 * ¿VUELVEN?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PANTALLA Y NO OTRO INFORME DE VENTAS
 *
 * Todos los informes que ya existen contestan «qué pasó» con distinto corte.
 * Ninguno contesta la pregunta de la que depende que el negocio crezca solo: si
 * el cliente que vino en enero volvió en marzo.
 *
 * Sin esto, la única métrica disponible es «vendí más que el mes pasado», que
 * también sube gastando más en publicidad — y una operadora que crece así deja
 * de crecer el día que deja de pagar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE LEE LA REJILLA
 *
 * Cada fila es el grupo de clientes que compró por primera vez ese mes. Las
 * columnas son los meses siguientes. Un cliente NO cambia de fila cuando
 * vuelve: si cambiara, la retención saldría perfecta siempre.
 *
 * El triángulo vacío de abajo a la derecha no es un fallo: son meses que
 * todavía no han ocurrido para esas cohortes.
 */

interface Report {
  cohorts: CohortRow[];
  repeatRatePct: number;
  averageCustomerValue: number;
  customers: number;
}

const MES = (clave: string) => {
  const [year, month] = clave.split("-").map(Number);
  if (!year || !month) return clave;
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString("es-DO", { month: "short", year: "2-digit", timeZone: "UTC" });
};

/** El color de una celda: cuanto más retiene, más intenso. */
function tono(pct: number): string {
  if (pct >= 40) return "bg-emerald-600 text-white";
  if (pct >= 25) return "bg-emerald-400 text-emerald-950";
  if (pct >= 15) return "bg-emerald-200 text-emerald-900";
  if (pct > 0) return "bg-emerald-50 text-emerald-900";
  return "text-muted-foreground";
}

export default function CohortesPage() {
  const [data, setData] = useState<Report | null>(null);
  const [months, setMonths] = useState("12");
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Report>(`/api/analytics/cohorts?months=${months}`);
    setLoading(false);
    if (res.ok === false) {
      toast.error(res.error || "No se pudieron cargar las cohortes");
      return;
    }
    setData(res.data);
  }, [months]);

  useEffect(() => { void cargar(); }, [cargar]);

  const cohortes = data?.cohorts ?? [];
  const span = Number(months);
  // Solo se pintan las columnas que alguna cohorte puede haber alcanzado: un
  // ancho fijo de doce dejaría media rejilla en blanco el primer año.
  const columnas = Math.max(1, Math.min(span, cohortes.length));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analítica"
        title="Cohortes de clientes"
        description="Si el cliente que vino en enero volvió en marzo. La métrica de la que depende crecer sin gastar más."
        actions={
          <div className="flex items-center gap-2">
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
                <SelectItem value="24">24 meses</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void cargar()} disabled={loading}>
              <Icon name="RefreshCw" className="mr-2 h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Clientes en el periodo" value={formatNumber(data?.customers ?? 0)} icon="Users" />
        <KpiCard
          label="Tasa de recompra"
          value={`${formatNumber(data?.repeatRatePct ?? 0, 1)} %`}
          icon="Repeat"
          hint="Clientes que compraron en más de un mes"
        />
        <KpiCard
          label="Valor medio por cliente"
          value={formatMoney(data?.averageCustomerValue ?? 0)}
          icon="Banknote"
          hint="Todo lo que ha comprado cada uno"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retención por mes de alta</CardTitle>
          <CardDescription>
            Cada fila es el grupo que compró por primera vez ese mes. Un cliente no cambia de fila
            cuando vuelve: si cambiara, la retención saldría perfecta siempre.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {cohortes.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Calculando…" : "Todavía no hay ventas suficientes para agrupar cohortes."}
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Alta</th>
                  <th className="px-3 py-2 text-right font-medium">Clientes</th>
                  <th className="px-3 py-2 text-right font-medium">Ingreso</th>
                  {Array.from({ length: columnas }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center font-medium">
                      {i === 0 ? "Mes 0" : `+${i}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohortes.map((cohorte, fila) => (
                  <tr key={cohorte.cohort} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-medium">{MES(cohorte.cohort)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(cohorte.customers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(cohorte.revenue)}</td>
                    {Array.from({ length: columnas }, (_, i) => {
                      // El triángulo vacío de abajo a la derecha son meses que
                      // todavía no ocurrieron para esa cohorte, no ceros.
                      const alcanzable = i <= cohortes.length - 1 - fila;
                      const pct = cohorte.retention[i] ?? 0;
                      return (
                        <td key={i} className="px-1 py-1 text-center">
                          {alcanzable ? (
                            <span className={`inline-block w-full rounded px-1.5 py-1 text-xs tabular-nums ${tono(pct)}`}>
                              {pct > 0 ? `${Math.round(pct)}%` : "—"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
