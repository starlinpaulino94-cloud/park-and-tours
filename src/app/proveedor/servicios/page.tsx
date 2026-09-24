"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { EmptyState } from "@/components/tf/empty-state";
import { DataTable } from "@/components/tf/data-table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  ETIQUETA_DE_ACEPTACION, horasQueQuedan, puedeResponder,
  type EstadoDeAceptacion,
} from "@/lib/aceptacion-proveedor";

interface Servicio {
  _id: string;
  tipo: "recurso" | "ruta";
  service_date: string | null;
  producto: string | null;
  detalle: string | null;
  punto_de_encuentro: string | null;
  pax: number | null;
  status: string | null;
  acceptance: EstadoDeAceptacion;
  acceptance_deadline: string | null;
  confirmation_number: string | null;
}

const VENTANAS = [
  { value: "proximos", label: "Próximos" },
  { value: "pasados", label: "Ya prestados" },
] as const;
type Ventana = (typeof VENTANAS)[number]["value"];

/** El papel que se le pidió, en palabras. */
const PAPEL: Record<string, string> = {
  vehicle: "Vehículo",
  driver: "Conductor",
  guide: "Guía",
  photographer: "Fotógrafo",
  coordinator: "Coordinador",
  equipment: "Equipo",
};

const ESTADO: Record<string, { texto: string; tono: string }> = {
  planned: { texto: "Previsto", tono: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  confirmed: { texto: "Confirmado", tono: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  in_progress: { texto: "En curso", tono: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  completed: { texto: "Completado", tono: "bg-muted text-muted-foreground" },
  conflict: { texto: "Con conflicto", tono: "bg-destructive/10 text-destructive" },
  cancelled: { texto: "Cancelado", tono: "bg-destructive/10 text-destructive" },
};

/**
 * MIS SERVICIOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA NO ENSEÑA, Y POR QUÉ
 *
 * Ni un nombre de cliente, ni un teléfono, ni una habitación. El proveedor es
 * el actor con más datos personales de terceros a tiro, y esta lista existe
 * para que sepa QUÉ tiene que hacer y CUÁNDO — no quién va dentro. Los datos de
 * cada parada están en la hoja de ruta, que es otra pantalla, para otro momento
 * y con otro ámbito.
 *
 * Tampoco enseña lo que se le paga: eso vive en su estado de cuenta, con su
 * detalle y su forma de discutirlo.
 *
 * Y no es una decisión de esta pantalla: la lista blanca del servidor ya quitó
 * esos campos antes de mandarlos (0085). Aquí solo se pinta lo que llega.
 */
export default function ProveedorServiciosPage() {
  const [ventana, setVentana] = useState<Ventana>("proximos");
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [cargando, setCargando] = useState(true);
  /** El servicio que se está contestando, para no dejar pulsar dos veces. */
  const [contestando, setContestando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await api.get<{ servicios: Servicio[] }>(`/api/proveedor/servicios?ventana=${ventana}`);
    setCargando(false);
    if (!res.ok) {
      console.error("[proveedor/servicios] no se pudieron cargar:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar tus servicios");
      setServicios([]);
      return;
    }
    setServicios(res.data?.servicios ?? []);
  }, [ventana]);

  /**
   * Contestar.
   *
   * El servidor decide: aquí no se toca el estado de la fila a mano ni se
   * intenta adivinar el número de confirmación. Se recarga. Pintar «aceptado»
   * en el navegador sin que el servidor lo haya escrito es la forma de que un
   * proveedor se vaya convencido de que confirmó algo que no confirmó.
   */
  const responder = useCallback(async (s: Servicio, respuesta: "accepted" | "rejected") => {
    const nota = respuesta === "rejected"
      ? (window.prompt("¿Por qué no puedes prestarlo? (opcional)") || "").trim()
      : "";
    setContestando(s._id);
    const res = await api.post<{ confirmation_number: string | null }>("/api/proveedor/respuesta", {
      tipo: s.tipo === "ruta" ? "pickup_route" : "departure_resource",
      id: s._id,
      respuesta,
      nota: nota || null,
    });
    setContestando(null);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo registrar tu respuesta");
      // Y se recarga IGUAL: el motivo más común de que falle es que la fila ya
      // no esté como esta pantalla cree —se reasignó, venció, se contestó desde
      // el enlace—, y dejarla pintada como estaba invita a volver a pulsar.
      void cargar();
      return;
    }
    toast.success(
      respuesta === "accepted"
        ? `Aceptado. Tu número de confirmación es ${res.data?.confirmation_number ?? "—"}.`
        : "Registrado. Avisamos a la operadora para que busque otro."
    );
    void cargar();
  }, [cargar]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis servicios"
        description="Lo que te toca prestar, con su día, su hora y su punto de encuentro."
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ventana de servicios">
        {VENTANAS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setVentana(v.value)}
            aria-pressed={ventana === v.value}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              ventana === v.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!cargando && servicios.length === 0 ? (
        <EmptyState
          icon="CalendarRange"
          title={ventana === "proximos" ? "No tienes servicios por delante" : "Todavía no has prestado ninguno"}
          description="Cuando la operadora te asigne un vehículo o una ruta de recogida, aparecerá aquí con su hora y su punto de encuentro."
        />
      ) : (
        <DataTable
          loading={cargando}
          rows={servicios}
          columns={[
            { key: "service_date", header: "Cuándo", render: (s: Servicio) => (
              s.service_date
                ? formatDateTime(s.service_date)
                // «Sin fecha» y no la de hoy: un servicio cuya salida se borró
                // no es un servicio de hoy, y ponerle una fecha inventada
                // mandaría a alguien a un sitio a una hora que nadie pactó.
                : <span className="text-muted-foreground">Sin fecha</span>
            ) },
            { key: "producto", header: "Excursión", render: (s: Servicio) => (
              <div>
                <div className="font-medium">{s.producto || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {s.tipo === "ruta" ? "Ruta de recogida" : "Recurso asignado"}
                  {s.detalle ? ` · ${PAPEL[s.detalle] ?? s.detalle}` : ""}
                </div>
              </div>
            ) },
            { key: "punto_de_encuentro", header: "Punto de encuentro", render: (s: Servicio) => (
              s.punto_de_encuentro || <span className="text-muted-foreground">—</span>
            ) },
            /**
             * La hoja de ruta, solo para las RUTAS y solo cuando están por
             * delante. Un enlace a la hoja de un servicio de hace un mes sería
             * un enlace a una lista de clientes que ya no hace falta ver — y el
             * servidor lo rechazaría, así que enseñarlo solo enseña un botón
             * que no funciona.
             */
            { key: "hoja", header: "", render: (s: Servicio) => (
              s.tipo === "ruta" && ventana === "proximos" ? (
                <Link
                  href={`/proveedor/hoja-de-ruta/${s._id}`}
                  className="text-sm font-medium underline underline-offset-4"
                >
                  Hoja de ruta
                </Link>
              ) : null
            ) },
            /**
             * «—» y no «0 pax» cuando no hay número: un cero dice que no va
             * nadie, que es una afirmación, y lo que pasa es que nadie lo
             * asignó todavía. Mismo criterio que las plazas del socio.
             */
            { key: "pax", header: "Pasajeros", align: "right", render: (s: Servicio) => (
              s.pax == null ? <span className="text-muted-foreground">—</span> : formatNumber(s.pax)
            ) },
            { key: "status", header: "Estado", render: (s: Servicio) => {
              const e = ESTADO[s.status || ""];
              return <Badge variant="outline" className={e?.tono}>{e?.texto || s.status || "—"}</Badge>;
            } },
            /**
             * TU RESPUESTA — el eje del proveedor, separado del de la casa.
             *
             * `status` dice lo que la operadora sabe del recurso; esta columna
             * dice lo que él contestó. Juntarlas haría que «confirmado»
             * quisiera decir dos cosas, y la primera vez que haya que decidir
             * si sale la guagua esa ambigüedad se resuelve a favor de lo que le
             * convenga al que mira.
             */
            { key: "acceptance", header: "Tu respuesta", render: (s: Servicio) => {
              const abierto = puedeResponder(s, new Date());
              if (abierto.ok) {
                const quedan = horasQueQuedan(s.acceptance_deadline, new Date());
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" disabled={contestando === s._id}
                        onClick={() => void responder(s, "accepted")}>Acepto</Button>
                      <Button size="sm" variant="outline" disabled={contestando === s._id}
                        onClick={() => void responder(s, "rejected")}>No puedo</Button>
                    </div>
                    {quedan != null ? (
                      <span className="text-xs text-muted-foreground">
                        {quedan > 0 ? `Te quedan ${quedan} h` : "Última hora para contestar"}
                      </span>
                    ) : null}
                  </div>
                );
              }
              return (
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">{ETIQUETA_DE_ACEPTACION[s.acceptance]}</span>
                  {s.confirmation_number ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.confirmation_number}
                    </span>
                  ) : null}
                </div>
              );
            } },
          ]}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Los datos de cada pasajero —nombre, hotel y teléfono— están en la hoja de ruta del día, no
        aquí.
      </p>
    </div>
  );
}
