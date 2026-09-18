"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { Icon } from "@/components/tf/icon";
import { Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber } from "@/lib/format";

interface RunSheetStop {
  sequence: number;
  time: string | null;
  planned_time: string | null;
  hotel: string;
  location: string;
  room: string | null;
  pax: number;
  customer: string | null;
  phone: string | null;
  status: string | null;
  note: string | null;
}

interface RunSheet {
  route: {
    _id?: string; name?: string; start_time?: string; status?: string;
    zone?: { name?: string } | null;
    vehicle?: { name?: string; plate?: string; capacity?: number } | null;
    driver?: { full_name?: string; phone?: string } | null;
    guide?: { full_name?: string; phone?: string } | null;
  };
  departure: { departure_at?: string; product?: { name?: string } | null } | null;
  stops: RunSheetStop[];
  paxTotal: number;
}

const ESTADO: Record<string, string> = {
  pending: "Pendiente", confirmed: "Confirmada",
  picked_up: "Recogida", no_show: "No se presentó", cancelled: "Cancelada",
};

/**
 * La hoja que el conductor se lleva.
 *
 * El manifiesto dice quién viaja; esta hoja dice por dónde pasa el transporte,
 * en qué orden y a qué hora. Sin ella, el recorrido se decide en la calle: se
 * llega tarde al hotel más lejano, o se da la vuelta entera dos veces.
 *
 * Está pensada para el papel y para un teléfono con el sol de frente: números
 * de parada grandes, la hora en la primera columna, y nada de interfaz cuando
 * se imprime. Lleva una casilla en blanco para marcar a mano, porque en la
 * guagua no siempre hay señal.
 */
export default function RunSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<RunSheet | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<RunSheet>(`/api/operations/routes/${id}/run-sheet`);
    setLoading(false);
    if (!res.ok) {
      console.error("[hoja de ruta] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la hoja de ruta");
      return;
    }
    setData(res.data || null);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="tf-card p-2">
        <EmptyState icon="Route" title="No se encontró la ruta"
          description="Puede que se haya cancelado al rehacer el día."
          action={<Link href="/dashboard/pickups"><Button>Ir a recogidas</Button></Link>} />
      </div>
    );
  }

  const { route, departure, stops } = data;
  const vehiculo = route.vehicle;
  const desajustes = stops.filter((s) => s.planned_time && s.time && s.planned_time !== s.time);
  const sobreCapacidad = vehiculo?.capacity ? data.paxTotal > vehiculo.capacity : false;

  return (
    <div className="space-y-5">
      <div className="no-print">
        <PageHeader
          eyebrow="Operación"
          title={route.name || "Hoja de ruta"}
          description="Las paradas en orden, con la hora, el hotel, la habitación y a quién se busca."
          actions={
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => window.print()}>
                <Icon name="Printer" className="size-4" /> Imprimir
              </Button>
              <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
                <Icon name="RefreshCw" className="size-4" />
              </Button>
            </>
          }
        />
      </div>

      {/* ── cabecera de la hoja ───────────────────────────────────────────── */}
      <section className="tf-card print-plain print-block space-y-2 p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-display text-xl font-semibold">{route.name || "Ruta"}</h2>
          {route.start_time && (
            <Pill tone="neutral" className="font-mono text-sm">Sale {route.start_time}</Pill>
          )}
          <p className="text-sm text-muted-foreground">
            {departure?.product?.name || "Salida"} · {formatDate(departure?.departure_at)}
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Zona" valor={route.zone?.name || "Sin zona"} />
          <Dato
            titulo="Vehículo"
            valor={vehiculo ? `${vehiculo.name || "Vehículo"}${vehiculo.plate ? ` · ${vehiculo.plate}` : ""}` : "Sin asignar"}
          />
          <Dato
            titulo="Conductor"
            valor={route.driver?.full_name || "Sin asignar"}
            nota={route.driver?.phone || undefined}
          />
          <Dato
            titulo="Guía"
            valor={route.guide?.full_name || "Sin asignar"}
            nota={route.guide?.phone || undefined}
          />
        </dl>
        <p className="text-sm font-semibold">
          {formatNumber(stops.length)} paradas · {formatNumber(data.paxTotal)} pasajeros
          {vehiculo?.capacity ? ` · ${formatNumber(vehiculo.capacity)} plazas` : ""}
        </p>
      </section>

      {/* Los avisos van en el papel, no solo en la pantalla: quien conduce es
          quien tiene que saber que va sobrecargado o que a un cliente le
          prometieron otra hora. */}
      {(sobreCapacidad || desajustes.length > 0) && (
        <section className="tf-card print-block space-y-1 border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {sobreCapacidad && (
            <p className="flex gap-2">
              <Icon name="TriangleAlert" className="mt-0.5 size-3.5 shrink-0" />
              Van {formatNumber(data.paxTotal)} pasajeros y el vehículo tiene {formatNumber(vehiculo?.capacity ?? 0)} plazas.
            </p>
          )}
          {desajustes.map((s) => (
            <p key={s.hotel + s.sequence} className="flex gap-2">
              <Icon name="Clock" className="mt-0.5 size-3.5 shrink-0" />
              {s.hotel}: al cliente se le prometieron las {s.time} y al transporte le tocaría pasar a las {s.planned_time}.
            </p>
          ))}
        </section>
      )}

      {stops.length === 0 ? (
        <div className="tf-card p-2">
          <EmptyState icon="MapPin" title="Esta ruta no tiene paradas"
            description="Arma las rutas del día desde el despacho para que las recogidas se repartan." />
        </div>
      ) : (
        <ul className="tf-card divide-y divide-border print-plain">
          {stops.map((stop) => (
            <li key={stop.sequence + stop.hotel} className="print-block flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-sm font-bold">
                {stop.sequence || "—"}
              </span>
              <span className="w-[62px] shrink-0 font-mono text-base font-bold tabular-nums">
                {stop.time || stop.planned_time || "—:—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{stop.hotel}</p>
                <p className="text-[13px] text-muted-foreground">
                  {stop.location}
                  {stop.room ? ` · habitación ${stop.room}` : ""}
                </p>
                <p className="text-[13px]">
                  {stop.customer || "Sin nombre"}
                  {stop.phone ? ` · ${stop.phone}` : ""}
                </p>
                {stop.note && <p className="text-[13px] italic text-muted-foreground">{stop.note}</p>}
              </div>
              <span className="shrink-0 text-right">
                <span className="font-mono text-base font-bold tabular-nums">{formatNumber(stop.pax)}</span>
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">pax</span>
              </span>
              {/* La casilla se marca a bolígrafo: en la guagua no siempre hay
                  señal, y el estado real entra luego en el check-in. */}
              <span className="mt-1 hidden size-5 shrink-0 rounded border border-black print:block" aria-hidden />
              <span className="no-print shrink-0 text-[11px] text-muted-foreground">
                {ESTADO[stop.status || ""] || ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">
        {valor}
        {nota && <span className="ml-1 font-normal text-muted-foreground">{nota}</span>}
      </dd>
    </div>
  );
}
