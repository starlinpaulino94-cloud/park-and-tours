"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber } from "@/lib/format";

interface Row {
  entry: {
    _id: string; pax?: number; status?: string; created_at?: string;
    offer_expires_at?: string | null; notes?: string | null;
    seller?: { first_name?: string; last_name?: string } | null;
    booking?: { _id?: string; booking_number?: string; status?: string } | null;
  };
  outcome: "waiting" | "offered" | "converted" | "expired" | "cancelled";
  name: string;
  channel: string | null;
}

interface Payload {
  departureId: string;
  rows: Row[];
  queue: Row[];
  summary: {
    waiting: number; waitingPax: number; offered: number;
    converted: number; expired: number; cancelled: number; convertedPax: number;
  };
  freeSeats: number;
  capacity: number;
}

const ETIQUETA: Record<Row["outcome"], { texto: string; tono: "neutral" | "warning" | "success" | "danger" }> = {
  waiting: { texto: "En cola", tono: "neutral" },
  offered: { texto: "Plaza apartada", tono: "warning" },
  converted: { texto: "Compró", tono: "success" },
  expired: { texto: "Se le pasó", tono: "danger" },
  cancelled: { texto: "Se dio de baja", tono: "neutral" },
};

/**
 * La cola de una salida.
 *
 * Lo que esta pantalla contesta —y que antes no se podía ni preguntar— es
 * cuánta gente se quedó fuera y cuánta de esa gente acabó viajando. Ese segundo
 * número es el que dice si la lista de espera sirve para algo.
 */
export default function WaitlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Payload>(`/api/waitlist?departure=${id}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[lista de espera] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la lista de espera");
      return;
    }
    setData(res.data || null);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const darDeBaja = async (entryId: string) => {
    setBusy(entryId);
    const res = await api.delete(`/api/waitlist/${entryId}`);
    setBusy(null);
    if (!res.ok) {
      console.error("[lista de espera] no se pudo dar de baja:", res.error);
      toast.error(res.error?.message || "No se pudo dar de baja");
      return;
    }
    toast.success("Fuera de la cola");
    load();
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Salidas"
        title="Lista de espera"
        description="Quién se quedó fuera, en qué orden le toca y quién acabó viajando. Cuando alguien cancela, la plaza se aparta sola al primero de la cola que quepa."
        actions={
          <>
            <Link href="/dashboard/salidas">
              <Button variant="outline" className="gap-1.5">
                <Icon name="ChevronLeft" className="size-4" /> Salidas
              </Button>
            </Link>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="Users" label="Esperando"
          value={formatNumber(s?.waitingPax ?? 0)}
          hint={`${formatNumber(s?.waiting ?? 0)} espera(s) en cola`} />
        <KpiCard tone={(s?.offered ?? 0) > 0 ? "coral" : "default"} icon="Clock"
          label="Plazas apartadas" value={formatNumber(s?.offered ?? 0)}
          hint="Con reserva hecha, pendientes de cobrar" />
        <KpiCard tone="ink" icon="CircleCheck" label="Acabaron viajando"
          value={formatNumber(s?.convertedPax ?? 0)}
          hint="La venta que la lista recuperó" />
        <KpiCard icon="Armchair" label="Plazas libres ahora"
          value={formatNumber(data?.freeSeats ?? 0)}
          hint={data?.capacity ? `de ${formatNumber(data.capacity)}` : "sin límite"} />
      </section>

      {(data?.rows.length ?? 0) === 0 ? (
        <div className="tf-card p-2">
          <EmptyState icon="Users" title="Nadie se ha quedado fuera de esta salida"
            description="Cuando una venta no quepa, el punto de venta ofrecerá apuntar al cliente aquí en vez de dejarlo marchar."
            action={<Link href="/dashboard/pos"><Button className="gap-1.5">
              <Icon name="ShoppingCart" className="size-4" /> Ir al punto de venta
            </Button></Link>} />
        </div>
      ) : (
        <ul className="tf-card divide-y divide-border">
          {data?.rows.map((row, i) => {
            const enCola = row.outcome === "waiting";
            const puesto = enCola
              ? data.queue.findIndex((q) => q.entry._id === row.entry._id) + 1
              : 0;
            const etiqueta = ETIQUETA[row.outcome];
            return (
              <li key={row.entry._id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {/* El puesto en la cola, que es lo que el cliente pregunta por
                    teléfono. Solo lo tienen los que siguen esperando: un número
                    junto a quien ya compró no significaría nada. */}
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-sm font-bold">
                  {puesto || "—"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{row.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {row.channel ?? "Sin forma de contacto"}
                    {" · apuntado "}{formatDateTime(row.entry.created_at)}
                    {row.entry.seller
                      ? ` · por ${[row.entry.seller.first_name, row.entry.seller.last_name].filter(Boolean).join(" ")}`
                      : ""}
                  </p>
                  {row.entry.notes && (
                    <p className="text-[13px] italic text-muted-foreground">{row.entry.notes}</p>
                  )}
                  {row.outcome === "offered" && row.entry.offer_expires_at && (
                    <p className="text-[13px] font-medium text-amber-700 dark:text-amber-300">
                      Hay que llamarle antes de {formatDateTime(row.entry.offer_expires_at)}
                    </p>
                  )}
                  {row.entry.booking?.booking_number && (
                    <Link href={`/dashboard/reservas?q=${row.entry.booking.booking_number}`}
                      className="text-[13px] font-semibold text-primary hover:underline">
                      Reserva {row.entry.booking.booking_number}
                    </Link>
                  )}
                </div>
                <span className="shrink-0 text-right">
                  <span className="font-mono text-base font-bold tabular-nums">
                    {formatNumber(row.entry.pax ?? 0)}
                  </span>
                  <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">pax</span>
                </span>
                <Pill tone={etiqueta.tono} className="shrink-0">{etiqueta.texto}</Pill>
                {enCola && (
                  <Button size="sm" variant="outline" className="shrink-0"
                    onClick={() => darDeBaja(row.entry._id)} disabled={busy === row.entry._id}>
                    {busy === row.entry._id ? "…" : "Dar de baja"}
                  </Button>
                )}
                <span className="sr-only">{`Posición ${puesto || "sin cola"} de la lista, elemento ${i + 1}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
