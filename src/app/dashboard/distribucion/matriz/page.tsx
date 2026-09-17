"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALLOTMENT_TYPE } from "@/lib/labels-modules";
import { labelOf } from "@/lib/labels";
import { formatNumber } from "@/lib/format";
import type { MatrixCell } from "@/lib/allotments";

/**
 * LA MATRIZ DE CUPO POR SOCIO Y FECHA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA REJILLA Y NO UNA LISTA
 *
 * La pantalla de allotments es una lista de contratos, y responde a «¿qué
 * acuerdos tengo?». La pregunta que se hace el comercial diez veces al día es
 * otra: «¿qué le queda a esta agencia la semana que viene?». Eso no se lee en
 * filas — se mira en una rejilla, día a día.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ENSEÑA Y POR QUÉ IMPORTA
 *
 * Las plazas LIBERADAS ya no son del socio: volvieron a la venta libre porque
 * no las vendió a tiempo. Verlas aparte de las vendidas es lo que permite la
 * conversación del viernes —«te liberé seis del sábado, ¿las quieres de vuelta
 * o las vendo?»— que hasta ahora se hacía revisando un Excel.
 */

interface Partner {
  _id: string;
  name?: string;
  commercial_name?: string;
}

const hoy = () => new Date().toISOString().slice(0, 10);
const diaCorto = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-DO", { weekday: "short", day: "2-digit", timeZone: "UTC" });

export default function MatrizPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState("");
  const [from, setFrom] = useState(hoy());
  const [days, setDays] = useState("14");
  const [cells, setCells] = useState<MatrixCell[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Partner[]>("/api/erp/partner?limit=300").then((r) => {
      if (r.ok === false) {
        console.error("[matriz] error cargando socios:", r.error);
        toast.error(r.error?.message || "No se pudieron cargar los socios");
        return;
      }
      setPartners(r.data || []);
      if (!partnerId && r.data?.[0]) setPartnerId(r.data[0]._id);
    });
    // Solo al montar: la lista de socios no cambia mientras se mira la matriz.
  }, [partnerId]);

  const load = useCallback(async () => {
    if (!partnerId) return;
    setLoading(true);
    const res = await api.get<{ cells: MatrixCell[] }>(
      `/api/allotments/matrix?partner=${partnerId}&from=${from}&days=${days}`
    );
    setLoading(false);
    if (res.ok === false) {
      console.error("[matriz] error cargando la matriz:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la matriz");
      setCells([]);
      return;
    }
    setCells(res.data?.cells || []);
  }, [partnerId, from, days]);

  useEffect(() => { load(); }, [load]);

  const conCupo = cells.filter((c) => c.allotmentId);
  const totales = conCupo.reduce(
    (acc, c) => ({
      seats: acc.seats + c.seats,
      used: acc.used + c.used,
      released: acc.released + c.released,
      remaining: acc.remaining + Math.max(0, c.remaining),
    }),
    { seats: 0, used: 0, released: 0, remaining: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribución"
        title="Matriz de cupo"
        description="Qué le queda a cada socio, día a día. Lo liberado ya no es suyo: volvió a la venta libre."
        actions={
          <Button variant="outline" asChild>
            <a href="/dashboard/distribucion/allotments">
              <Icon name="TableProperties" className="mr-2 h-4 w-4" />
              Ver contratos
            </a>
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Socio</Label>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Elige el socio" /></SelectTrigger>
            <SelectContent>
              {partners.map((p) => (
                <SelectItem key={p._id} value={p._id}>{p.commercial_name || p.name || p._id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f">Desde</Label>
          <Input id="f" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="n">Días</Label>
          <Input id="n" type="number" min="1" max="60" className="w-24" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Plazas contratadas" value={formatNumber(totales.seats)} icon="TableProperties" />
        <KpiCard label="Vendidas" value={formatNumber(totales.used)} icon="Ticket" />
        <KpiCard label="Liberadas" value={formatNumber(totales.released)} icon="Undo2"
          hint="No las vendió a tiempo y volvieron a la venta libre." />
        <KpiCard label="Le quedan" value={formatNumber(totales.remaining)} icon="CircleCheck" />
      </div>

      {!loading && conCupo.length === 0 && partnerId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Este socio no tiene cupo en estas fechas</CardTitle>
            <CardDescription>
              Vende contra la capacidad de cada salida, sin plazas apartadas. Si le prometiste un número
              concreto por contrato, dale de alta un allotment garantizado.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-semibold">Día</th>
              <th className="p-3 text-left font-semibold">Tipo</th>
              <th className="p-3 text-right font-semibold">Contratadas</th>
              <th className="p-3 text-right font-semibold">Vendidas</th>
              <th className="p-3 text-right font-semibold">Liberadas</th>
              <th className="p-3 text-right font-semibold">Le quedan</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {!loading && cells.map((c) => (
              <tr key={c.date} className="border-t">
                <td className="p-3 tabular-nums">{diaCorto(c.date)}</td>
                <td className="p-3 text-muted-foreground">
                  {c.allotmentId ? labelOf(ALLOTMENT_TYPE, c.type).label : "Sin cupo"}
                </td>
                <td className="p-3 text-right tabular-nums">{c.allotmentId ? formatNumber(c.seats) : "—"}</td>
                <td className="p-3 text-right tabular-nums">{c.allotmentId ? formatNumber(c.used) : "—"}</td>
                <td className="p-3 text-right tabular-nums">
                  {c.released > 0 ? <span className="text-amber-600">{formatNumber(c.released)}</span> : c.allotmentId ? "0" : "—"}
                </td>
                <td className="p-3 text-right font-semibold tabular-nums">
                  {/* −1 significa «sin tope propio»: vende contra la capacidad
                      de la salida, no contra un número apartado. */}
                  {c.remaining < 0 ? <span className="text-muted-foreground">Libre</span> : formatNumber(c.remaining)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        «Libre» significa que el socio vende contra la capacidad de la salida, sin plazas apartadas. Solo el
        cupo garantizado tiene un número propio; la venta libre y el «a petición» no apartan nada.
      </p>
    </div>
  );
}
