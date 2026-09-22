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
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import { ROW_PROBLEM_MESSAGE, type DgiiKind, type RowProblem } from "@/lib/dgii";

/**
 * LA DECLARACIÓN MENSUAL, EN PAPEL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA HOJA EXISTE SI YA SE BAJA EL TXT
 *
 * El archivo que se sube a la DGII no se puede leer: es un texto plano con
 * campos separados por barras. Lo que el contador necesita antes de enviarlo es
 * una hoja legible que cuadre contra su balance, y lo que hace falta DESPUÉS es
 * esa misma hoja archivada junto al acuse. Sin ella, dentro de un año nadie
 * puede reconstruir qué se declaró en septiembre sin volver a generar el
 * archivo — y para entonces los datos pueden haber cambiado.
 *
 * Es la misma llamada que produce el TXT, así que la hoja y el archivo no
 * pueden contar cosas distintas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO EXCLUIDO SE IMPRIME, Y CON SU MOTIVO
 *
 * Una factura sin NCF o sin RNC no entra en el archivo. Si la hoja solo
 * enseñara lo declarado, el contador cuadraría contra un total que no incluye
 * esas facturas sin enterarse de que faltan. Salen aparte, nombradas, con lo
 * que hay que arreglarles.
 */

const TIPOS: { kind: DgiiKind; titulo: string; que: string }[] = [
  { kind: "606", titulo: "606 · Compras de bienes y servicios", que: "Lo que la empresa compró, con el ITBIS que pagó." },
  { kind: "607", titulo: "607 · Ventas de bienes y servicios", que: "Lo que la empresa facturó, con el ITBIS que cobró." },
  { kind: "608", titulo: "608 · Comprobantes anulados", que: "Los NCF que se emitieron y luego se anularon." },
];

interface Fila {
  label: string;
  reference: string;
  date: string | null;
  amountTotal: number;
  itbis: number;
  problems: RowProblem[];
  columns: string[] | null;
}

interface Reporte {
  kind: DgiiKind;
  month: string;
  rows: Fila[];
  totals: { rows: number; invoiced: number; itbis: number };
  excluded: number;
}

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

function Tabla({ filas, conProblemas }: { filas: Fila[]; conProblemas: boolean }) {
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead>
        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="py-1.5 pr-3 font-semibold">Fecha</th>
          <th className="py-1.5 pr-3 font-semibold">NCF / Referencia</th>
          <th className="py-1.5 pr-3 font-semibold">Concepto</th>
          {conProblemas && <th className="py-1.5 pr-3 font-semibold">Qué le falta</th>}
          <th className="py-1.5 pr-3 text-right font-semibold">ITBIS</th>
          <th className="py-1.5 text-right font-semibold">Importe</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={`${f.reference}-${i}`} className="print-block border-b border-border/60 align-top">
            <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{f.date ? formatDate(f.date) : "—"}</td>
            <td className="py-1.5 pr-3 font-mono text-[11.5px]">{f.reference || "—"}</td>
            <td className="py-1.5 pr-3">{f.label}</td>
            {conProblemas && (
              <td className="py-1.5 pr-3 text-[12px]">
                {f.problems.map((p) => ROW_PROBLEM_MESSAGE[p] ?? p).join("; ")}
              </td>
            )}
            <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(f.itbis)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(f.amountTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Documento() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const kind = (TIPOS.some((t) => t.kind === sp.get("kind")) ? sp.get("kind") : "607") as DgiiKind;
  const month = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : mesActual();
  const tipo = TIPOS.find((t) => t.kind === kind)!;

  const [rep, setRep] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    api.get<Reporte>(`/api/reports/dgii?kind=${kind}&month=${month}`, { signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        if (!res.ok) { setError(res.error?.message || "No se pudo cargar la declaración"); return; }
        setRep(res.data ?? null);
      })
      .finally(() => { if (!ac.signal.aborted) setCargando(false); });
    return () => ac.abort();
  }, [kind, month]);

  const aplicar = (campo: "kind" | "month", valor: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(campo, valor);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const declarables = rep?.rows.filter((f) => f.columns !== null) ?? [];
  const excluidas = rep?.rows.filter((f) => f.columns === null) ?? [];

  return (
    <div className="space-y-5">
      <CabeceraDocumento
        titulo="Declaración DGII"
        descripcion="La misma información que se sube a la DGII, legible, para cuadrar antes de enviar y archivar después."
        acciones={
          <Button asChild variant="outline" className="gap-1.5">
            <a href={`/api/reports/dgii?kind=${kind}&month=${month}&format=txt`}>
              <Icon name="Download" className="size-4" />Archivo TXT
            </a>
          </Button>
        }
      />

      <section className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-1.5">
          {TIPOS.map((t) => (
            <Button
              key={t.kind}
              size="sm"
              variant={t.kind === kind ? "default" : "outline"}
              onClick={() => aplicar("kind", t.kind)}
            >
              {t.kind}
            </Button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Mes
          <Input type="month" className="h-9 w-[160px]" value={month} onChange={(e) => aplicar("month", e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">{tipo.que}</p>
      </section>

      <EncabezadoImpreso
        titulo={tipo.titulo}
        periodo={`Período fiscal ${month}`}
        nota="Hoja de trabajo para cuadrar y archivar. El envío a la DGII se hace con el archivo TXT."
      />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : rep ? (
        <div className="space-y-6">
          <div className="print-block grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Líneas declaradas", formatNumber(rep.totals.rows)],
              ["Importe declarado", formatMoney(rep.totals.invoiced)],
              ["ITBIS", formatMoney(rep.totals.itbis)],
              ["Fuera del archivo", formatNumber(rep.excluded)],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta} className="rounded-lg border border-border px-3 py-2 print-plain">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{etiqueta}</p>
                <p className="text-lg font-bold tabular-nums">{valor}</p>
              </div>
            ))}
          </div>

          {rep.excluded > 0 && (
            <p className="print-block rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[13px] font-semibold">
              {formatNumber(rep.excluded)} documento(s) NO entran en el archivo por los problemas que se detallan
              abajo. El total declarado no los incluye: si cuadras contra tu balance, esa es la diferencia.
            </p>
          )}

          <section className="print-block space-y-2">
            <h2 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Lo que se declara
            </h2>
            {declarables.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Sin documentos declarables en el mes.</p>
            ) : (
              <Tabla filas={declarables} conProblemas={false} />
            )}
          </section>

          {excluidas.length > 0 && (
            <section className="print-block space-y-2">
              <h2 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Lo que queda fuera, y por qué
              </h2>
              <Tabla filas={excluidas} conProblemas />
            </section>
          )}

          <Firmas roles={["Preparó", "Revisó"]} />
          <PieImpreso nota={`${tipo.titulo} · ${month}`} />
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
