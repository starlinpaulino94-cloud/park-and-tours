"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CabeceraDocumento, EncabezadoImpreso, PieImpreso, Firmas } from "@/components/tf/hoja-impresa";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { labelOf, PAYMENT_METHOD, CHANNEL } from "@/lib/labels";
import { companyTimeZone, diaLocal } from "@/lib/report";
import { formatDateInZone } from "@/lib/time";
import type { CierreDia } from "@/lib/cierre-dia";

/**
 * EL CIERRE DEL DÍA, EN UNA HOJA QUE SE FIRMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO USA `ReportShell`
 *
 * El marco de reportes trabaja con un RANGO —desde/hasta— y este documento es
 * de un solo día por definición: un cierre de «del 1 al 30» no es un cierre, es
 * un resumen mensual, y mezclarlos haría que alguien archivara uno creyendo que
 * es el otro. Lleva su propio selector de un día, y el mismo encabezado impreso
 * con empresa, documento y fecha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS AVISOS VAN ARRIBA
 *
 * Quien firma necesita ver PRIMERO lo que está mal —el efectivo que falta, las
 * cajas sin cerrar, las incidencias graves— y solo después el detalle. Un
 * descuadre enterrado en la cuarta sección es un descuadre que no se dijo.
 */

interface Documento extends CierreDia {
  timezone: string;
  recortado: boolean;
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="print-block space-y-2">
      <h2 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2 print-plain">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{etiqueta}</p>
      <p className={`tabular-nums ${fuerte ? "text-lg font-bold" : "text-base font-semibold"}`}>{valor}</p>
    </div>
  );
}

function Cierre() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tz = companyTimeZone(null);
  const fecha = sp.get("date") || diaLocal(new Date(), tz);

  const [doc, setDoc] = useState<Documento | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    api.get<Documento>(`/api/reports/daily-close?date=${encodeURIComponent(fecha)}`, { signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        if (!res.ok) { setError(res.error?.message || "No se pudo cargar el cierre"); return; }
        setDoc(res.data ?? null);
      })
      .finally(() => { if (!ac.signal.aborted) setCargando(false); });
    return () => ac.abort();
  }, [fecha]);

  const irA = (dia: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("date", dia);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const desplazar = (dias: number) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    irA(d.toISOString().slice(0, 10));
  };

  const moneda = "usd";
  const c = doc?.caja;

  return (
    <div className="space-y-5">
      <CabeceraDocumento
        titulo="Cierre del día"
        descripcion="Qué operó, qué se vendió, qué entró y si la caja cuadra. Para imprimir, firmar y archivar."
      />

      <section className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <Button size="sm" variant="outline" onClick={() => desplazar(-1)}>
          <Icon name="ArrowLeft" className="size-4" />
        </Button>
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Día
          <Input type="date" className="h-9 w-[160px]" value={fecha} onChange={(e) => irA(e.target.value)} />
        </label>
        <Button size="sm" variant="outline" onClick={() => desplazar(1)}>
          <Icon name="ArrowRight" className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => irA(diaLocal(new Date(), tz))}>Hoy</Button>
      </section>

      <EncabezadoImpreso
        titulo="Cierre del día"
        periodo={formatDateInZone(`${fecha}T12:00:00Z`, tz)}
      />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : doc ? (
        <div className="space-y-5">
          {/* Lo que hay que mirar ANTES de firmar. */}
          {doc.avisos.length > 0 && (
            <section className="print-block rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider">Antes de firmar</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                {doc.avisos.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </section>
          )}

          {doc.recortado && (
            <p className="print-block rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[12px] font-semibold">
              El día tiene más movimientos de los que este documento puede traer: las cifras están recortadas.
            </p>
          )}

          <Bloque titulo="Caja">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato etiqueta="Efectivo según sistema" valor={formatMoney(c?.segunSistema, moneda)} />
              <Dato etiqueta="Contado (sin fondo)" valor={formatMoney(c?.contado, moneda)} />
              <Dato etiqueta="Fondo de apertura" valor={formatMoney(c?.fondo, moneda)} />
              <Dato
                etiqueta="Diferencia"
                fuerte
                valor={
                  c?.veredicto === "sin_cierre" ? "Sin contar" : formatMoney(c?.diferencia ?? 0, moneda)
                }
              />
            </div>
            <p className="text-[12.5px]">
              {c?.veredicto === "cuadra" && "La caja cuadra con lo cobrado en efectivo."}
              {c?.veredicto === "falta" && "Falta efectivo: hay menos en caja de lo que el sistema cobró."}
              {c?.veredicto === "sobra" && "Sobra efectivo: hay más en caja de lo que el sistema cobró."}
              {c?.veredicto === "sin_cierre" && "Ninguna caja se cerró en el día: no hay nada contado con qué comparar."}
            </p>
          </Bloque>

          <Bloque titulo="Operación">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Dato etiqueta="Salidas programadas" valor={formatNumber(doc.operacion.programadas)} />
              <Dato etiqueta="Operadas" valor={formatNumber(doc.operacion.operadas)} />
              <Dato etiqueta="Canceladas" valor={formatNumber(doc.operacion.canceladas)} />
              <Dato
                etiqueta="Ocupación"
                valor={doc.operacion.ocupacion === null ? "Sin cupo" : formatPercent(doc.operacion.ocupacion)}
              />
              <Dato etiqueta="Cupo" valor={formatNumber(doc.operacion.cupo)} />
              <Dato etiqueta="Pax vendidos" valor={formatNumber(doc.operacion.vendido)} />
              <Dato etiqueta="Pax operados" valor={formatNumber(doc.operacion.operado)} />
              <Dato etiqueta="No-show" valor={formatNumber(doc.operacion.noShow)} />
            </div>
          </Bloque>

          <Bloque titulo="Venta del día">
            {doc.ventas.lineas.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Sin ventas registradas.</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Canal</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Documentos</th>
                    <th className="py-1.5 text-right font-semibold">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.ventas.lineas.map((l) => (
                    <tr key={l.canal} className="border-b border-border/60">
                      <td className="py-1.5 pr-3">{labelOf(CHANNEL, l.canal).label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(l.documentos)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(l.importe, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-1.5 pr-3">Total</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(doc.ventas.documentos)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(doc.ventas.total, moneda)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Bloque>

          <Bloque titulo="Cobros por método">
            {doc.cobros.lineas.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Sin cobros registrados.</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Método</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Cobros</th>
                    <th className="py-1.5 text-right font-semibold">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.cobros.lineas.map((l) => (
                    <tr key={l.metodo} className="border-b border-border/60">
                      <td className="py-1.5 pr-3">{labelOf(PAYMENT_METHOD, l.metodo).label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(l.cobros)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(l.importe, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-1.5 pr-3">Total</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums" />
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(doc.cobros.total, moneda)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </Bloque>

          <Bloque titulo="Incidencias">
            <p className="text-[13px]">
              {doc.incidencias.total === 0
                ? "Sin incidencias registradas."
                : `${formatNumber(doc.incidencias.total)} incidencia(s), de las cuales ${formatNumber(doc.incidencias.graves)} grave(s).`}
            </p>
          </Bloque>

          <Firmas roles={["Cerró la jornada", "Revisó"]} />

          <PieImpreso nota={`día cortado en ${doc.timezone}`} />
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>}>
      <Cierre />
    </Suspense>
  );
}
