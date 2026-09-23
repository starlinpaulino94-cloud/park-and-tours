"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/tf/icon";
import { CabeceraDocumento, EncabezadoImpreso, PieImpreso } from "@/components/tf/hoja-impresa";
import {
  atajos, etiquetaPeriodo, normalizarPeriodo, companyTimeZone, type Periodo,
} from "@/lib/report";

/**
 * EL MARCO DE UN REPORTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESUELVE, Y POR QUÉ UNA SOLA VEZ
 *
 * Todo reporte de este sistema necesita las mismas cuatro cosas: elegir un
 * período, verse en pantalla, imprimirse en papel y bajarse como archivo. Si
 * cada pantalla las resuelve por su cuenta, el selector de fechas funciona
 * distinto en cada sitio y —lo que de verdad cuesta— el papel sale sin decir de
 * qué empresa es ni de qué período. Una hoja impresa sin encabezado es una hoja
 * que no se puede archivar.
 *
 * El período vive en la URL, no en el estado del componente: así un reporte se
 * comparte por enlace y se vuelve a abrir igual, y el botón de atrás del
 * navegador hace lo que se espera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SALE EN EL PAPEL Y NO EN LA PANTALLA
 *
 * El encabezado impreso lleva la empresa, el nombre del reporte y el período; el
 * pie, quién lo generó y cuándo. Eso es lo que convierte una impresión en un
 * documento: dentro de seis meses, quien lo encuentre en una carpeta sabrá qué
 * está mirando sin tener que preguntar.
 */
export function ReportShell({
  titulo, descripcion, campoFecha, recursoCsv, filtros, resumen, children,
}: {
  titulo: string;
  descripcion?: string;
  /** Campo por el que se filtra el período (p. ej. `occurred_at`). */
  campoFecha: string;
  /** Recurso para el CSV; sin él no se ofrece descarga. */
  recursoCsv?: string;
  /** Controles propios del reporte (no se imprimen). */
  filtros?: React.ReactNode;
  /** Cifras de cabecera; SÍ se imprimen, porque son el resumen del documento. */
  resumen?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tz = companyTimeZone(null);
  const periodo = useMemo(
    () => normalizarPeriodo(sp.get("from"), sp.get("to"), new Date(), tz),
    [sp, tz],
  );

  const aplicar = useCallback((p: Periodo) => {
    const next = new URLSearchParams(sp.toString());
    next.set("from", p.desde);
    next.set("to", p.hasta);
    router.replace(`${pathname}?${next.toString()}`);
  }, [pathname, router, sp]);

  const lista = useMemo(() => atajos(new Date(), tz), [tz]);

  const csvHref = recursoCsv
    ? `/api/export/${recursoCsv}?dateField=${encodeURIComponent(campoFecha)}` +
      `&from=${periodo.desde}&to=${periodo.hasta}`
    : null;

  return (
    <div className="space-y-5">
      <CabeceraDocumento
        titulo={titulo}
        descripcion={descripcion}
        acciones={
          csvHref ? (
            <Button asChild variant="outline" className="gap-1.5">
              <a href={csvHref}><Icon name="Download" className="size-4" />CSV</a>
            </Button>
          ) : null
        }
      />

      {/* Selector de período */}
      <section className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-1.5">
          {lista.map((a) => {
            const activo = a.periodo.desde === periodo.desde && a.periodo.hasta === periodo.hasta;
            return (
              <Button
                key={a.clave}
                size="sm"
                variant={activo ? "default" : "outline"}
                onClick={() => aplicar(a.periodo)}
              >
                {a.etiqueta}
              </Button>
            );
          })}
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Desde
            <Input
              type="date" className="h-9 w-[150px]" value={periodo.desde}
              onChange={(e) => aplicar({ ...periodo, desde: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Hasta
            <Input
              type="date" className="h-9 w-[150px]" value={periodo.hasta}
              onChange={(e) => aplicar({ ...periodo, hasta: e.target.value })}
            />
          </label>
        </div>
        {filtros}
      </section>

      <EncabezadoImpreso titulo={titulo} periodo={`Período: ${etiquetaPeriodo(periodo)}`} />

      {resumen}
      {children}

      <PieImpreso />
    </div>
  );
}
