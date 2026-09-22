"use client";

import { Suspense, use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ReportShell } from "@/components/tf/report-shell";
import { Icon } from "@/components/tf/icon";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  esNumerica, monedaDe, reportePorSlug, textoCelda, totalesDe,
  type DefinicionReporte,
} from "@/lib/reportes";

/**
 * UNA PANTALLA PARA TODOS LOS REPORTES DE LISTADO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO HAY VEINTE PANTALLAS
 *
 * Cada reporte del registro es el mismo documento con otras columnas: un
 * listado acotado a un período, con totales al pie. Con veinte pantallas, a los
 * seis meses una imprime el encabezado y otra no, una suma incluyendo las
 * anuladas y otra no, y nadie se entera hasta que dos hojas del mismo mes no
 * cuadran. Con una, eso no puede pasar: el período, la impresión, el CSV y los
 * totales son literalmente el mismo código.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DOCUMENTO TRAE TODAS LAS FILAS, NO LA PRIMERA PÁGINA
 *
 * El listado del ERP pagina de 200 en 200, y eso está bien para una pantalla
 * que se navega. Para un documento NO: una hoja que dice «Ventas de septiembre»
 * y trae las primeras 200 de 340 es peor que no tener reporte, porque el total
 * del pie parece correcto y está mal.
 *
 * Así que aquí se piden las páginas necesarias hasta juntar el período entero,
 * con un tope duro. Al llegar al tope el reporte lo DICE y manda al CSV, en vez
 * de imprimir un total incompleto con cara de completo.
 */

const POR_PAGINA = 200;
const TOPE_PAGINAS = 10;
const TOPE_FILAS = POR_PAGINA * TOPE_PAGINAS;

interface Respuesta {
  ok: boolean;
  data?: Record<string, unknown>[];
  total?: number;
  error?: { message?: string } | string;
}

function Reporte({ def }: { def: DefinicionReporte }) {
  const sp = useSearchParams();
  const [filas, setFilas] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const desde = sp.get("from");
  const hasta = sp.get("to");

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);

    (async () => {
      const juntas: Record<string, unknown>[] = [];
      let totalServidor = 0;

      for (let pagina = 0; pagina < TOPE_PAGINAS; pagina++) {
        const qs = new URLSearchParams({
          dateField: def.campoFecha,
          sort: `-${def.campoFecha}`,
          limit: String(POR_PAGINA),
          offset: String(pagina * POR_PAGINA),
        });
        if (desde) qs.set("from", desde);
        if (hasta) qs.set("to", hasta);

        const res = (await api.get(`/api/erp/${def.recurso}?${qs}`, { signal: ac.signal })) as Respuesta;
        if (ac.signal.aborted) return;
        if (!res.ok) {
          const msg = typeof res.error === "string" ? res.error : res.error?.message;
          setError(msg || "No se pudo cargar el reporte");
          setCargando(false);
          return;
        }
        const lote = Array.isArray(res.data) ? res.data : [];
        juntas.push(...lote);
        totalServidor = res.total ?? juntas.length;
        // Se para cuando el servidor devolvió menos de lo pedido (no hay más)
        // o cuando ya se juntó lo que el servidor dice que hay.
        if (lote.length < POR_PAGINA || juntas.length >= totalServidor) break;
      }

      setFilas(juntas);
      setTotal(Math.max(totalServidor, juntas.length));
      setCargando(false);
    })();

    return () => ac.abort();
  }, [def, desde, hasta]);

  const moneda = useMemo(() => monedaDe(filas), [filas]);
  const totales = useMemo(() => totalesDe(filas, def), [filas, def]);
  const incompleto = total > filas.length;

  return (
    <ReportShell
      titulo={def.titulo}
      descripcion={def.descripcion}
      campoFecha={def.campoFecha}
      recursoCsv={def.recurso}
      resumen={
        filas.length > 0 ? (
          <section className="print-block grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border px-3 py-2 print-plain">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Registros</p>
              <p className="text-lg font-bold tabular-nums">{formatNumber(filas.length)}</p>
            </div>
            {(def.totales ?? []).slice(0, 3).map((clave) => {
              const col = def.columnas.find((c) => c.clave === clave);
              if (!col) return null;
              return (
                <div key={clave} className="rounded-lg border border-border px-3 py-2 print-plain">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{col.titulo}</p>
                  <p className="text-lg font-bold tabular-nums">
                    {col.tipo === "dinero"
                      ? formatMoney(totales[clave], moneda)
                      : formatNumber(totales[clave], Number.isInteger(totales[clave]) ? 0 : 2)}
                  </p>
                </div>
              );
            })}
          </section>
        ) : null
      }
    >
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 && !error ? (
        <div className="py-12 text-center">
          <Icon name="Inbox" className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">Sin movimientos en el período</p>
          <p className="text-sm text-muted-foreground">Elige otro rango de fechas.</p>
        </div>
      ) : filas.length > 0 ? (
        <>
          {/* El aviso de recorte SÍ se imprime: una hoja incompleta tiene que
              decir que lo es, o quien la archive la dará por completa. */}
          {incompleto && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px]">
              Este documento trae las primeras {formatNumber(filas.length)} de {formatNumber(total)} filas
              del período (tope de {formatNumber(TOPE_FILAS)}). Los totales de abajo son solo de lo que se
              ve. Para el período completo, acorta el rango o descarga el CSV.
            </p>
          )}
          <p className="no-print text-xs text-muted-foreground">
            {formatNumber(filas.length)} registro(s)
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  {def.columnas.map((c) => (
                    <th
                      key={c.clave}
                      className={`py-2 pr-3 font-semibold ${esNumerica(c) ? "text-right" : ""}`}
                    >
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={String(f._id ?? i)} className="print-block border-b border-border/60 align-top">
                    {def.columnas.map((c) => (
                      <td
                        key={c.clave}
                        className={`py-1.5 pr-3 ${esNumerica(c) ? "text-right tabular-nums" : ""}`}
                      >
                        {textoCelda(f, c, moneda)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {def.totales && def.totales.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    {def.columnas.map((c, i) => {
                      const suma = totales[c.clave];
                      return (
                        <td
                          key={c.clave}
                          className={`py-2 pr-3 ${esNumerica(c) ? "text-right tabular-nums" : ""}`}
                        >
                          {suma !== undefined
                            ? c.tipo === "dinero"
                              ? formatMoney(suma, moneda)
                              : formatNumber(suma, Number.isInteger(suma) ? 0 : 2)
                            : i === 0
                              ? "Total"
                              : ""}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      ) : null}
    </ReportShell>
  );
}

function Desconocido({ slug }: { slug: string }) {
  return (
    <div className="py-16 text-center">
      <Icon name="CircleAlert" className="mx-auto size-8 text-muted-foreground" />
      <p className="mt-2 font-semibold">No existe el reporte «{slug}»</p>
      <p className="text-sm text-muted-foreground">
        Puede que haya cambiado de nombre.{" "}
        <Link href="/dashboard/analitica/reportes" className="underline">Ver todos los reportes</Link>.
      </p>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const def = reportePorSlug(slug);
  if (!def) return <Desconocido slug={slug} />;
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>}>
      <Reporte def={def} />
    </Suspense>
  );
}
