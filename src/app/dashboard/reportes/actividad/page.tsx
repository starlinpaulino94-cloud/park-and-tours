"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ReportShell } from "@/components/tf/report-shell";
import { Icon } from "@/components/tf/icon";
import { Pill } from "@/components/tf/status-badge";
import { formatDateTime } from "@/lib/format";
import { ACCION, moduloDe, resumirPorModulo, type EventoBitacora } from "@/lib/bitacora";

/**
 * LA BITÁCORA: TODO LO QUE SE HIZO, EN UN PAPEL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ SIRVE DE VERDAD
 *
 * No es la pantalla de Auditoría con otro nombre. Aquélla se usa para BUSCAR un
 * evento concreto —«quién anuló esta factura»—; ésta se usa para CERRAR un
 * período: se elige un rango, se imprime y se archiva. Por eso lleva un resumen
 * por módulo arriba: quien firma la hoja necesita ver el volumen antes que el
 * detalle.
 *
 * La lista sale del mismo `audit_log` inmutable que alimenta la auditoría, así
 * que no puede contar una historia distinta de la que pasó.
 */

const PAGINA = 200;

function Reporte() {
  const sp = useSearchParams();
  const [eventos, setEventos] = useState<EventoBitacora[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modulo, setModulo] = useState<string>("");

  const desde = sp.get("from");
  const hasta = sp.get("to");

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    // Los nombres importan: la ruta lee `limit` y `sort`, no `_limit` ni
    // `_sort`. Con el guion bajo los ignoraba en silencio y la bitácora salía
    // con 50 eventos y en el orden por defecto, pareciendo completa.
    const qs = new URLSearchParams({
      dateField: "occurred_at",
      sort: "-occurred_at",
      limit: String(PAGINA),
    });
    if (desde) qs.set("from", desde);
    if (hasta) qs.set("to", hasta);

    api.get<{ items?: EventoBitacora[] } | EventoBitacora[]>(`/api/erp/audit_log?${qs}`, { signal: ac.signal })
      .then((res) => {
        if (!res.ok) { setError(res.error?.message || "No se pudo cargar la bitácora"); return; }
        const data = res.data as { items?: EventoBitacora[] } | EventoBitacora[];
        setEventos(Array.isArray(data) ? data : (data?.items ?? []));
      })
      .finally(() => setCargando(false));
    return () => ac.abort();
  }, [desde, hasta]);

  const visibles = useMemo(
    () => (modulo ? eventos.filter((e) => moduloDe(e) === modulo) : eventos),
    [eventos, modulo],
  );
  const porModulo = useMemo(() => resumirPorModulo(eventos), [eventos]);

  return (
    <ReportShell
      titulo="Bitácora de actividad"
      descripcion="Todo lo que se hizo en el período: quién, qué, cuándo y sobre qué. No se puede editar ni borrar."
      campoFecha="occurred_at"
      recursoCsv="audit_log"
      filtros={
        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Módulo
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal normal-case tracking-normal text-foreground"
            value={modulo}
            onChange={(e) => setModulo(e.target.value)}
          >
            <option value="">Todos</option>
            {porModulo.map((m) => (
              <option key={m.modulo} value={m.modulo}>{m.modulo} ({m.total})</option>
            ))}
          </select>
        </label>
      }
      resumen={
        porModulo.length > 0 ? (
          <section className="print-block grid grid-cols-2 gap-2 sm:grid-cols-4">
            {porModulo.slice(0, 8).map((m) => (
              <div key={m.modulo} className="rounded-lg border border-border px-3 py-2 print-plain">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{m.modulo}</p>
                <p className="text-lg font-bold tabular-nums">{m.total}</p>
              </div>
            ))}
          </section>
        ) : null
      }
    >
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : visibles.length === 0 ? (
        <div className="py-12 text-center">
          <Icon name="ShieldCheck" className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">Sin actividad en el período</p>
          <p className="text-sm text-muted-foreground">Elige otro rango de fechas.</p>
        </div>
      ) : (
        <>
          <p className="no-print text-xs text-muted-foreground">
            {visibles.length} evento(s){visibles.length === PAGINA ? " (máximo por página; afina el rango o descarga el CSV)" : ""}
          </p>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Cuándo</th>
                <th className="py-2 pr-3 font-semibold">Quién</th>
                <th className="py-2 pr-3 font-semibold">Acción</th>
                <th className="py-2 pr-3 font-semibold">Sobre qué</th>
                <th className="py-2 font-semibold">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e._id} className="print-block border-b border-border/60 align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDateTime(e.occurred_at)}</td>
                  <td className="py-1.5 pr-3">{e.user?.name || e.user?.email || "Sistema"}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{ACCION[e.action] || e.action}</span>
                    {e.severity && e.severity !== "info" && (
                      <Pill tone={e.severity === "critical" ? "danger" : "warning"} className="ml-1.5 no-print">
                        {e.severity === "critical" ? "Crítico" : "Aviso"}
                      </Pill>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{e.entity_type || "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{e.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ReportShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>}>
      <Reporte />
    </Suspense>
  );
}
