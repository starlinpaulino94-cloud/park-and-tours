"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CabeceraDocumento, EncabezadoImpreso, PieImpreso, Firmas,
} from "@/components/tf/hoja-impresa";
import { formatMoney, formatNumber } from "@/lib/format";
import { AGING_BUCKET, labelOf } from "@/lib/labels";

/**
 * ANTIGÜEDAD DE SALDOS, EN PAPEL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE DOCUMENTO NO TIENE PERÍODO: TIENE FECHA DE CORTE
 *
 * Lo demás se pregunta «¿qué pasó entre el 1 y el 30?». Esto se pregunta «¿qué
 * se me debe HOY, y desde cuándo?». Un rango de fechas aquí no significa nada:
 * un saldo no ocurre en un día, se arrastra.
 *
 * Por eso no lleva selector de período y sí lleva, bien visible y también en el
 * papel, el instante del corte. Una antigüedad de saldos impresa sin fecha de
 * corte es inservible a la semana siguiente, porque los tramos se habrán
 * movido y nadie sabrá desde cuándo se contaron.
 */

const TRAMOS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
type Tramo = (typeof TRAMOS)[number];

interface Entidad extends Record<Tramo, number> {
  key: string;
  label: string;
  total: number;
  documents: number;
  oldest_days: number;
  over_limit?: boolean;
  credit_limit?: number;
}

interface Respuesta {
  type: "receivable" | "payable";
  entities: Entidad[];
  totals: Record<Tramo, number> & { total: number };
  truncated: boolean;
}

const VISTAS = [
  { tipo: "receivable" as const, titulo: "Antigüedad de cuentas por cobrar", que: "Lo que deben a la empresa, por tramo de vencimiento." },
  { tipo: "payable" as const, titulo: "Antigüedad de cuentas por pagar", que: "Lo que la empresa debe, por tramo de vencimiento." },
];

function Documento() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const tipo = sp.get("type") === "payable" ? "payable" : "receivable";
  const vista = VISTAS.find((v) => v.tipo === tipo)!;

  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [corte, setCorte] = useState<Date | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setCargando(true);
    setError(null);
    api.get<Respuesta>(`/api/reports/aging?type=${tipo}`, { signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        if (!res.ok) { setError(res.error?.message || "No se pudo cargar la antigüedad"); return; }
        setDatos(res.data ?? null);
        // El corte es cuando el servidor contó los tramos, no cuando se
        // imprime: entre una cosa y otra puede pasar media jornada.
        setCorte(new Date());
      })
      .finally(() => { if (!ac.signal.aborted) setCargando(false); });
    return () => ac.abort();
  }, [tipo]);

  const cambiar = (nuevo: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("type", nuevo);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const corteTexto = corte
    ? `Saldos al ${corte.toLocaleDateString("es-DO")} · ${corte.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`
    : "Saldos al momento de la consulta";

  return (
    <div className="space-y-5">
      <CabeceraDocumento
        titulo="Antigüedad de saldos"
        descripcion="Cuánto se debe y desde cuándo, repartido por tramo de vencimiento. Es una foto del momento, no un período."
      />

      <section className="no-print flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-1.5">
          {VISTAS.map((v) => (
            <Button
              key={v.tipo}
              size="sm"
              variant={v.tipo === tipo ? "default" : "outline"}
              onClick={() => cambiar(v.tipo)}
            >
              {v.tipo === "receivable" ? "Por cobrar" : "Por pagar"}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {vista.que} No lleva selector de fechas: un saldo no ocurre en un día, se arrastra.
        </p>
      </section>

      <EncabezadoImpreso titulo={vista.titulo} periodo={corteTexto} />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : datos ? (
        <div className="space-y-5">
          {datos.truncated && (
            <p className="print-block rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-[12px] font-semibold">
              Hay más documentos pendientes de los que este documento puede traer: las cifras están recortadas.
            </p>
          )}

          <div className="print-block grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-border px-3 py-2 print-plain">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total</p>
              <p className="text-lg font-bold tabular-nums">{formatMoney(datos.totals.total)}</p>
            </div>
            {TRAMOS.map((t) => (
              <div key={t} className="rounded-lg border border-border px-3 py-2 print-plain">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {labelOf(AGING_BUCKET, t).label}
                </p>
                <p className="text-base font-semibold tabular-nums">{formatMoney(datos.totals[t])}</p>
              </div>
            ))}
          </div>

          {datos.entities.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No hay saldos pendientes: nada que reclamar ni que pagar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">{tipo === "receivable" ? "Cliente o socio" : "Proveedor"}</th>
                    <th className="py-2 pr-3 text-right font-semibold">Docs.</th>
                    <th className="py-2 pr-3 text-right font-semibold">Más viejo</th>
                    {TRAMOS.map((t) => (
                      <th key={t} className="py-2 pr-3 text-right font-semibold">{labelOf(AGING_BUCKET, t).label}</th>
                    ))}
                    <th className="py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.entities.map((e) => (
                    <tr key={e.key} className="print-block border-b border-border/60">
                      <td className="py-1.5 pr-3">
                        {e.label}
                        {e.over_limit && (
                          <span className="ml-1.5 text-[11px] font-semibold text-destructive">
                            sobre su límite de {formatMoney(e.credit_limit)}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(e.documents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {e.oldest_days > 0 ? `${formatNumber(e.oldest_days)} d` : "—"}
                      </td>
                      {TRAMOS.map((t) => (
                        <td key={t} className="py-1.5 pr-3 text-right tabular-nums">
                          {e[t] > 0 ? formatMoney(e[t]) : "—"}
                        </td>
                      ))}
                      <td className="py-1.5 text-right font-semibold tabular-nums">{formatMoney(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 pr-3" />
                    {TRAMOS.map((t) => (
                      <td key={t} className="py-2 pr-3 text-right tabular-nums">{formatMoney(datos.totals[t])}</td>
                    ))}
                    <td className="py-2 text-right tabular-nums">{formatMoney(datos.totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <Firmas roles={["Preparó", "Revisó"]} />
          <PieImpreso nota={corteTexto} />
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
