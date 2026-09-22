"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import {
  CabeceraDocumento, EncabezadoImpreso, PieImpreso, Firmas,
} from "@/components/tf/hoja-impresa";
import { formatMoney, formatPercent } from "@/lib/format";
import { BALANCE_TOLERANCE, type BalanceSheet, type IncomeStatement } from "@/lib/financials";

/**
 * ESTADO DE RESULTADOS Y BALANCE GENERAL, EN PAPEL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PERÍODO AQUÍ SON MESES, Y HAY QUE DECIRLO
 *
 * El resto de los reportes se acotan por día. La contabilidad NO: se cierra por
 * períodos mensuales, y `/api/ledger/statements` trabaja en `AAAA-MM`. Un
 * selector de días sobre esto sería una mentira cómoda — pedirías «del 1 al 15»
 * y recibirías septiembre entero, con cara de quincena.
 *
 * Así que el selector es de meses y el encabezado impreso dice exactamente qué
 * períodos contables entran. Un documento fiscal que no dice su alcance no vale
 * como documento fiscal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SI EL BALANCE NO CUADRA, LO DICE ARRIBA
 *
 * Activo = Pasivo + Patrimonio no es una curiosidad de contable: si no se
 * cumple, el documento entero es inservible y quien lo firme está firmando algo
 * que no cuadra. Sale arriba, no escondido al pie de la tercera tabla.
 */

interface Estados {
  range: { from: string; to: string };
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
}

/** El mes actual como AAAA-MM. */
function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

function Lineas({
  titulo, filas, total, etiquetaTotal,
}: {
  titulo: string;
  filas: { code: string; name: string; amount: number }[];
  total: number;
  etiquetaTotal: string;
}) {
  return (
    <section className="print-block space-y-1">
      <h2 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {titulo}
      </h2>
      {filas.length === 0 ? (
        <p className="py-1 text-[13px] text-muted-foreground">Sin movimiento en el período.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {filas.map((f) => (
              <tr key={f.code} className="border-b border-border/50">
                <td className="w-[80px] py-1 pr-2 tabular-nums text-muted-foreground">{f.code}</td>
                <td className="py-1 pr-3">{f.name}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(f.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-1.5 pr-2" />
              <td className="py-1.5 pr-3">{etiquetaTotal}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

function Documento() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const hasta = sp.get("to") || mesActual();
  // Un rango invertido se endereza en vez de devolver vacío, igual que en el
  // resto de los reportes: teclear los meses al revés es un desliz, no una
  // consulta de cero filas.
  const desdeCrudo = sp.get("from") || hasta;
  const desde = desdeCrudo > hasta ? hasta : desdeCrudo;

  const [datos, setDatos] = useState<Estados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    api.get<Estados>(`/api/ledger/statements?from=${desde}&to=${hasta}`, { signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        if (!res.ok) { setError(res.error?.message || "No se pudieron cargar los estados"); return; }
        setDatos(res.data ?? null);
      })
      .finally(() => { if (!ac.signal.aborted) setCargando(false); });
    return () => ac.abort();
  }, [desde, hasta]);

  const aplicar = (campo: "from" | "to", valor: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(campo, valor);
    if (campo === "to" && !next.get("from")) next.set("from", valor);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const periodoTexto = desde === hasta ? `Período contable ${desde}` : `Períodos contables ${desde} a ${hasta}`;
  const bs = datos?.balanceSheet;
  const descuadre = bs ? Math.round((bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) * 100) / 100 : 0;
  const cuadra = Math.abs(descuadre) <= BALANCE_TOLERANCE;

  return (
    <div className="space-y-5">
      <CabeceraDocumento
        titulo="Estados financieros"
        descripcion="Estado de resultados del período y balance general acumulado, listos para imprimir y archivar."
        acciones={
          <Button asChild variant="outline" className="gap-1.5">
            <a href={`/api/ledger/statements?from=${desde}&to=${hasta}&format=csv`}>
              <Icon name="Download" className="size-4" />CSV
            </a>
          </Button>
        }
      />

      <section className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Desde el mes
          <Input type="month" className="h-9 w-[160px]" value={desde} onChange={(e) => aplicar("from", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Hasta el mes
          <Input type="month" className="h-9 w-[160px]" value={hasta} onChange={(e) => aplicar("to", e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">
          La contabilidad se cierra por meses: este documento no se puede acotar a días.
        </p>
      </section>

      <EncabezadoImpreso
        titulo="Estados financieros"
        periodo={periodoTexto}
        nota="El balance general es acumulado hasta el último mes del rango; el estado de resultados es solo del rango."
      />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : datos ? (
        <div className="space-y-6">
          <p
            className={`print-block rounded-md border px-3 py-2 text-[13px] ${
              cuadra
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-destructive/50 bg-destructive/10 font-semibold"
            }`}
          >
            {cuadra
              ? `El balance cuadra: activo ${formatMoney(bs!.totalAssets)} = pasivo + patrimonio.`
              : `EL BALANCE NO CUADRA: diferencia de ${formatMoney(Math.abs(descuadre))} entre el activo y ` +
                `la suma de pasivo y patrimonio. No firmes este documento sin revisar los asientos del período.`}
          </p>

          <div className="grid gap-2 sm:grid-cols-4">
            {[
              ["Ingresos", formatMoney(datos.incomeStatement.totalRevenue)],
              ["Gastos", formatMoney(datos.incomeStatement.totalExpenses)],
              ["Resultado neto", formatMoney(datos.incomeStatement.netIncome)],
              ["Margen", formatPercent(datos.incomeStatement.marginPct)],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta} className="rounded-lg border border-border px-3 py-2 print-plain">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{etiqueta}</p>
                <p className="text-lg font-bold tabular-nums">{valor}</p>
              </div>
            ))}
          </div>

          <Lineas
            titulo="Estado de resultados · Ingresos"
            filas={datos.incomeStatement.revenue}
            total={datos.incomeStatement.totalRevenue}
            etiquetaTotal="Total de ingresos"
          />
          <Lineas
            titulo="Estado de resultados · Gastos"
            filas={datos.incomeStatement.expenses}
            total={datos.incomeStatement.totalExpenses}
            etiquetaTotal="Total de gastos"
          />
          <Lineas titulo="Balance general · Activo" filas={bs!.assets} total={bs!.totalAssets} etiquetaTotal="Total del activo" />
          <Lineas titulo="Balance general · Pasivo" filas={bs!.liabilities} total={bs!.totalLiabilities} etiquetaTotal="Total del pasivo" />
          <Lineas titulo="Balance general · Patrimonio" filas={bs!.equity} total={bs!.totalEquity} etiquetaTotal="Total del patrimonio" />

          <Firmas roles={["Preparó", "Revisó", "Aprobó"]} />
          <PieImpreso nota={periodoTexto} />
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>}>
      <Documento />
    </Suspense>
  );
}
