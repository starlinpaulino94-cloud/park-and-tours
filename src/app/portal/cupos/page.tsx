"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { EmptyState } from "@/components/tf/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import type { AllotmentType } from "@/lib/allotments";

interface Celda {
  date: string;
  seats: number;
  used: number;
  released: number;
  /** -1 significa «sin tope»: el servidor no puede mandar `Infinity` en JSON. */
  remaining: number;
  type: AllotmentType;
  allotmentId: string | null;
}

interface Respuesta {
  partner_id: string;
  from: string;
  days: number;
  cells: Celda[];
}

const TIPO: Record<AllotmentType, { etiqueta: string; explica: string; tono: string }> = {
  guaranteed: {
    etiqueta: "Garantizado",
    explica: "Plazas apartadas para ti. Nadie más las toca hasta que se liberan.",
    tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  free_sale: {
    etiqueta: "Venta libre",
    explica: "Vendes hasta donde llegue la capacidad de la salida, sin tope propio.",
    tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  on_request: {
    etiqueta: "A petición",
    explica: "Puedes vender, pero cada reserva queda pendiente de que la operadora la confirme.",
    tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  closed: {
    etiqueta: "Cerrado",
    explica: "Tu contrato no permite vender estos días.",
    tono: "bg-destructive/10 text-destructive",
  },
};

const VENTANAS = [
  { value: "14", label: "14 días" },
  { value: "30", label: "30 días" },
  { value: "60", label: "60 días" },
];

const hoy = () => new Date().toISOString().slice(0, 10);

/** «mar 14 jul», que es como se lee una rejilla de cupos. */
function diaCorto(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * MI CUPO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA ARREGLA
 *
 * El motor de cupos estaba entero: la reserva se comprueba contra el contrato
 * antes de tomar plazas, y funciona. Lo que no existía era enseñárselo al socio.
 * El tour center se enteraba de cuántas plazas le quedaban cuando el sistema le
 * rechazaba una venta con el turista delante, o preguntando por WhatsApp — que
 * es exactamente lo que el motor de cupos vino a sustituir.
 *
 * La rejilla ya estaba escrita y pedía `manager`: el contrato que el socio
 * firmó solo podía verlo la otra parte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA REJILLA Y NO UNA LISTA
 *
 * Porque la pregunta no es «qué contratos tengo» sino «¿qué me queda el
 * jueves?». Una lista de filas con `valid_from`, `valid_to` y días de la semana
 * obliga a resolver el contrato de cabeza; la rejilla ya lo resolvió.
 */
export default function PortalCuposPage() {
  const { isStaff, partnerId } = usePortal();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [dias, setDias] = useState("14");
  const [desde, setDesde] = useState(hoy);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ from: desde, days: dias });
    if (isStaff && partnerId) params.set("partner", partnerId);
    const res = await api.get<Respuesta>(`/api/portal/cupos?${params}`);
    setCargando(false);
    if (!res.ok) {
      console.error("[portal/cupos] no se pudo cargar el cupo:", res.error);
      toast.error(res.error?.message || "No se pudo cargar tu cupo");
      setDatos(null);
      return;
    }
    setDatos(res.data ?? null);
  }, [desde, dias, isStaff, partnerId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const celdas = datos?.cells ?? [];
  /**
   * Solo cuentan los días con contrato de plazas.
   *
   * Sumar los de venta libre daría cero —no tienen plazas contratadas— y ese
   * cero se leería como «no me queda nada», que es lo contrario de lo que
   * significa la venta libre.
   */
  const conCupo = celdas.filter((c) => c.allotmentId && c.type === "guaranteed");
  const totalRestantes = conCupo.reduce((a, c) => a + Math.max(0, c.remaining), 0);
  const totalUsadas = conCupo.reduce((a, c) => a + c.used, 0);
  const diasCerrados = celdas.filter((c) => c.type === "closed").length;

  const sinContrato = !cargando && celdas.every((c) => !c.allotmentId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi cupo"
        description="Las plazas que tienes contratadas, día a día, antes de venderlas."
        actions={
          <div className="flex gap-2">
            <input
              type="date"
              id="desde"
              value={desde}
              onChange={(e) => setDesde(e.target.value || hoy())}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              aria-label="Desde"
            />
            <Select value={dias} onValueChange={setDias}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VENTANAS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {sinContrato ? (
        <EmptyState
          icon="CalendarRange"
          title="No tienes plazas contratadas"
          description="Vendes contra la disponibilidad general de cada salida, sin tope propio. Si quieres plazas apartadas para ti, háblalo con tu comercial."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Plazas que te quedan" value={formatNumber(totalRestantes)} icon="Ticket" />
            <KpiCard label="Plazas que ya vendiste" value={formatNumber(totalUsadas)} icon="ShoppingCart" />
            <KpiCard label="Días cerrados" value={formatNumber(diasCerrados)} icon="CalendarX" />
          </div>

          <Card>
            <CardHeader><CardTitle>Día a día</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {celdas.map((c) => {
                  const tipo = TIPO[c.type] ?? TIPO.free_sale;
                  /**
                   * `-1` es «sin tope», no «menos una plaza». Es lo que manda la
                   * rejilla para la venta libre y lo que pasa a petición, porque
                   * `Infinity` no cabe en un JSON. Pintarlo como número sería
                   * enseñarle al socio un cupo negativo.
                   */
                  const sinTope = c.remaining < 0;
                  const agotado = !sinTope && c.remaining === 0 && c.type === "guaranteed";
                  return (
                    <div
                      key={c.date}
                      className={`rounded-md border p-3 ${agotado || c.type === "closed" ? "border-destructive/40" : ""}`}
                    >
                      <div className="text-xs text-muted-foreground">{diaCorto(c.date)}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {c.type === "closed" ? "—" : sinTope ? "Sin tope" : formatNumber(c.remaining)}
                      </div>
                      {!sinTope && c.type === "guaranteed" && (
                        <div className="text-xs text-muted-foreground tabular-nums">
                          de {formatNumber(c.seats)} · {formatNumber(c.used)} vendidas
                          {c.released > 0 && ` · ${formatNumber(c.released)} liberadas`}
                        </div>
                      )}
                      <Badge variant="outline" className={`mt-2 ${tipo.tono}`}>{tipo.etiqueta}</Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>Qué significa cada tipo</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(Object.keys(TIPO) as AllotmentType[]).map((t) => (
            <div key={t} className="flex gap-3">
              <Badge variant="outline" className={`shrink-0 ${TIPO[t].tono}`}>{TIPO[t].etiqueta}</Badge>
              <span className="text-muted-foreground">{TIPO[t].explica}</span>
            </div>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">
            Las plazas <strong>liberadas</strong> volvieron a la venta libre porque no se vendieron a
            tiempo: ya no son tuyas y por eso no cuentan en lo que te queda.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
