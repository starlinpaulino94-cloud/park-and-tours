"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ETIQUETA_DE_PARADA, type EstadoDeParada } from "@/lib/hoja-de-ruta";

interface Parada {
  id: string;
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
  marked_at: string | null;
  marked_via: string | null;
}

interface Hoja {
  route: Record<string, unknown>;
  departure: Record<string, unknown> | null;
  stops: Parada[];
  paxTotal: number;
}

const TONO: Record<string, string> = {
  picked_up: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  no_show: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/**
 * LA HOJA DE RUTA, EN EL MÓVIL DEL CHOFER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUIÉN ES
 *
 * Para alguien conduciendo, parado en la puerta de un hotel a las siete de la
 * mañana, con una mano en el volante. Por eso cada parada es un bloque grande
 * con dos botones grandes, y no una fila de tabla: una tabla en un móvil obliga
 * a hacer zoom para pulsar, y eso acaba en marcas puestas en la fila de al lado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ AQUÍ SÍ SALEN LOS DATOS DEL CLIENTE
 *
 * En «Mis servicios» no sale ni un nombre, y es correcto: allí el proveedor
 * mira qué le toca hacer. Aquí está recogiendo a esas personas, así que necesita
 * saber a quién busca, en qué habitación está y a qué teléfono llamar cuando no
 * baja.
 *
 * Lo que acota esta pantalla no es esconder campos: es que solo se abre para
 * SUS rutas, solo alrededor del servicio, y que cada apertura queda anotada. Eso
 * lo decide el servidor; aquí solo se pinta lo que llega.
 */
export default function HojaDeRutaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await api.get<Hoja>(`/api/proveedor/hoja-de-ruta?ruta=${encodeURIComponent(id)}`);
    setCargando(false);
    if (!res.ok) {
      setError(res.error?.message || "No se pudo cargar la hoja de ruta");
      setHoja(null);
      return;
    }
    setError(null);
    setHoja(res.data ?? null);
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const marcar = useCallback(async (parada: Parada, marca: "picked_up" | "no_show") => {
    setMarcando(parada.id);
    const res = await api.post<{ espero_lo_suficiente: boolean | null }>(
      "/api/proveedor/hoja-de-ruta", { parada: parada.id, marca }
    );
    setMarcando(null);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo marcar");
      void cargar();
      return;
    }
    /**
     * Si se marcó un no-show antes de la hora prevista se dice, y no se
     * bloquea. Bloquear deja al chofer con la hoja a medias y a la operadora
     * sin saber qué pasó, que es peor que una marca temprana anotada.
     */
    if (marca === "no_show" && res.data?.espero_lo_suficiente === false) {
      toast.warning("Anotado. Ojo: lo marcaste antes de la hora prevista de recogida.");
    } else {
      toast.success(marca === "picked_up" ? "Recogido" : "Anotado como no presentado");
    }
    void cargar();
  }, [cargar]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hoja de ruta" description="Las paradas de esta ruta, en orden." />
        <EmptyState icon="MapPinOff" title="No está disponible" description={error} />
        <Link href="/proveedor/servicios" className="text-sm underline">Volver a mis servicios</Link>
      </div>
    );
  }

  const ruta = hoja?.route as { name?: string; start_time?: string } | undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title={ruta?.name || "Hoja de ruta"}
        description={
          hoja
            ? `${hoja.stops.length} parada(s) · ${hoja.paxTotal} pasajero(s)${ruta?.start_time ? ` · sale ${ruta.start_time}` : ""}`
            : "Las paradas de esta ruta, en orden."
        }
      />

      {!cargando && (hoja?.stops.length ?? 0) === 0 ? (
        <EmptyState
          icon="MapPin"
          title="Esta ruta no tiene paradas"
          description="Cuando la operadora le asigne recogidas, aparecerán aquí en orden."
        />
      ) : null}

      <ol className="space-y-3">
        {(hoja?.stops ?? []).map((p) => {
          const estado = (p.status || "pending") as EstadoDeParada;
          const cerrada = estado === "cancelled";
          return (
            <li key={p.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold tabular-nums">
                      {p.time || p.planned_time || "--:--"}
                    </span>
                    <Badge variant="outline" className={TONO[estado]}>
                      {ETIQUETA_DE_PARADA[estado]}
                    </Badge>
                  </div>
                  <div className="mt-1 font-medium">{p.location || p.hotel}</div>
                  <div className="text-sm text-muted-foreground">
                    {p.customer || "Sin nombre"}
                    {p.room ? ` · hab. ${p.room}` : ""}
                    {p.pax ? ` · ${p.pax} pax` : ""}
                  </div>
                  {p.note ? <div className="mt-1 text-xs text-muted-foreground">{p.note}</div> : null}
                  {p.marked_at ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Marcado a las {new Date(p.marked_at).toLocaleTimeString("es-DO", {
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  ) : null}
                </div>
                {p.phone ? (
                  // Un enlace de teléfono y no el número suelto: en el móvil,
                  // con el motor encendido, copiar un número no es una opción.
                  <a
                    href={`tel:${p.phone}`}
                    className="shrink-0 rounded-md border px-3 py-2 text-sm font-semibold"
                  >
                    Llamar
                  </a>
                ) : null}
              </div>

              {cerrada ? null : (
                <div className="mt-3 flex gap-2">
                  <Button
                    className="min-h-11 flex-1"
                    disabled={marcando === p.id}
                    onClick={() => void marcar(p, "picked_up")}
                  >
                    Recogido
                  </Button>
                  <Button
                    variant="outline"
                    className={cn("min-h-11 flex-1", estado === "no_show" && "border-destructive")}
                    disabled={marcando === p.id}
                    onClick={() => void marcar(p, "no_show")}
                  >
                    No bajó
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground">
        Esta hoja solo se abre el día del servicio. Los datos de estas personas son de la
        operadora: úsalos para recogerlas y nada más.
      </p>
    </div>
  );
}
