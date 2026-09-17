"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import { ROW_PROBLEM_MESSAGE, type RowProblem } from "@/lib/dgii";

/**
 * DECLARACIONES 606, 607 Y 608.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA EVITA
 *
 * Que el contador vuelva a teclear en un Excel las mismas facturas y los mismos
 * gastos que ya están en el sistema. Desde el momento en que eso pasa, la cifra
 * del sistema y la declarada empiezan a separarse, y cuadrarlas al final del año
 * cuesta días.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE FALTA SE VE ANTES, NO DESPUÉS
 *
 * La DGII rechaza el archivo ENTERO por una línea incompleta, días después y sin
 * decir cuál. Por eso aquí se listan primero las filas que no se pueden
 * declarar, con lo que les falta y el enlace para arreglarlo. El archivo se
 * genera con lo que está bien: declarar tarde por una factura sin RNC es peor
 * que declarar sin ella y corregir después.
 */

interface Row {
  label: string;
  reference: string;
  date: string | null;
  amountTotal: number;
  itbis: number;
  problems: RowProblem[];
  columns: string[] | null;
}

interface Report {
  kind: "606" | "607" | "608";
  month: string;
  rows: Row[];
  totals: { rows: number; invoiced: number; itbis: number };
  excluded: number;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Page() {
  const [month, setMonth] = useState(thisMonth);
  const [kind, setKind] = useState<"606" | "607" | "608">("607");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Report>(`/api/reports/dgii?kind=${kind}&month=${month}`);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo preparar la declaración");
      setReport(null);
      return;
    }
    setReport(res.data || null);
  }, [kind, month]);

  useEffect(() => { load(); }, [load]);

  const descargar = async () => {
    const res = await fetch(`/api/reports/dgii?kind=${kind}&month=${month}&format=txt`, { credentials: "same-origin" });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      toast.error(detail?.error?.message || "No se pudo generar el archivo");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DGII_${kind}_${month.replace("-", "")}.TXT`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Archivo generado. Valídalo en la herramienta de la DGII antes de enviarlo.");
  };

  const conProblemas = (report?.rows || []).filter((row) => row.problems.length > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Finanzas"
        title="Declaraciones 606, 607 y 608"
        description="Las compras y las ventas del mes, en el formato que pide la DGII. Sale de lo que ya está registrado: nada se vuelve a teclear."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Período</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mes" className="text-xs">Mes</Label>
            <Input id="mes" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" />
          </div>
          <div className="flex gap-2 rounded-lg border border-border p-1">
            {(["607", "606", "608"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setKind(value)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                  kind === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {value === "607" ? "607 · Ventas" : value === "606" ? "606 · Compras" : "608 · Anulaciones"}
              </button>
            ))}
          </div>
          <Button onClick={descargar} disabled={loading || !report} className="gap-1.5">
            <Icon name="Download" className="size-4" /> Descargar archivo
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : !report ? (
        <p className="text-sm text-muted-foreground">No se pudo preparar la declaración.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardDescription>Líneas a declarar</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{formatNumber(report.totals.rows)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Monto facturado</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{formatMoney(report.totals.invoiced)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>ITBIS</CardDescription></CardHeader>
              <CardContent className="text-2xl font-semibold">{formatMoney(report.totals.itbis)}</CardContent>
            </Card>
          </div>

          {conProblemas.length > 0 && (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon name="TriangleAlert" className="size-4 text-amber-600" />
                  {conProblemas.length} {conProblemas.length === 1 ? "registro se queda fuera" : "registros se quedan fuera"}
                </CardTitle>
                <CardDescription>
                  La DGII rechaza el archivo entero por una línea incompleta, y el rechazo llega días después
                  sin decir cuál. Estos no entran: arréglalos y vuelve a generar.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {conProblemas.slice(0, 40).map((row, index) => (
                  <div key={`${row.reference}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{row.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.reference} {row.date ? `· ${formatDate(row.date)}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {row.problems.map((problem) => (
                        <Pill key={problem} tone="warning">{ROW_PROBLEM_MESSAGE[problem]}</Pill>
                      ))}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Antes de enviar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Valida el archivo en la herramienta de la DGII la primera vez que declares con el sistema. El
                formato está construido según el envío vigente, pero una validación de dos minutos evita un
                rechazo que se descubre días después.
              </p>
              <p>
                El total facturado y el ITBIS de arriba deberían cuadrar con tu balance del mes. Si no cuadran,
                lo que falta casi siempre son los registros de la lista de arriba.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
