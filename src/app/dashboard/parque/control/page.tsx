"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/tf/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { ATTRACTION_STATUS, ATTRACTION_TYPE, YES_NO } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";
import { formatNumber } from "@/lib/format";

/**
 * EL CENTRO DE CONTROL, CON LA PUERTA QUE LE FALTABA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES
 *
 * `POST /api/attractions/status` estaba escrito ENTERO —cambia el estado,
 * añade la entrada inmutable a la bitácora, acumula el downtime del rato que la
 * atracción estuvo parada y deja rastro en auditoría— y **no lo llamaba nadie**.
 * Ni una línea en toda la aplicación.
 *
 * Mientras tanto, esta pantalla ofrecía `operational_status` como un campo más
 * del formulario genérico. O sea que el estado SÍ se podía cambiar: la insignia
 * cambiaba y no se registraba nada. Ni bitácora, ni downtime, ni hora del
 * cambio.
 *
 * El resultado en pantalla era el peor posible: la bitácora —que se presenta
 * como «la fuente del downtime y de la disponibilidad histórica»— salía vacía
 * con el parque operando, y el downtime del día se quedaba en cero con las
 * atracciones paradas. Nadie ve el fallo hasta que alguien pide el informe de
 * disponibilidad del mes y no hay nada que enseñar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AHORA HAY UN SOLO CAMINO
 *
 * El estado se cambia por el botón de cada fila, que llama a la ruta. Y los tres
 * campos que la ruta DERIVA —`operational_status`, `downtime_minutes_today` y
 * `last_status_at`— salen del formulario y de la lista blanca de escritura del
 * CRUD genérico (`resources.ts`), para que no quede una segunda puerta que
 * escriba el estado sin dejar rastro. Una guarda lo sujeta.
 *
 * Lo que sigue sin estar: el tablero en vivo que se refresca solo. Eso es otra
 * entrega; esto es la puerta, que es lo que hacía falta para que el módulo
 * exista.
 */
interface Atraccion {
  _id: string;
  name?: string;
  operational_status?: string;
  guests_today?: number;
  queue_minutes?: number;
}

export default function Page() {
  const [version, setVersion] = useState(0);
  const [cambiando, setCambiando] = useState<Atraccion | null>(null);
  const [estado, setEstado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [visitantes, setVisitantes] = useState("");
  const [cola, setCola] = useState("");
  const [guardando, setGuardando] = useState(false);

  const abrir = (a: Atraccion) => {
    setCambiando(a);
    setEstado(a.operational_status || "open");
    setMotivo("");
    setVisitantes(a.guests_today != null ? String(a.guests_today) : "");
    setCola(a.queue_minutes != null ? String(a.queue_minutes) : "");
  };

  const confirmar = async () => {
    if (!cambiando) return;
    /**
     * El motivo es OBLIGATORIO cuando la atracción deja de estar abierta.
     *
     * Un downtime sin motivo no sirve para nada al mes siguiente: se sabe que
     * estuvo parada cuarenta minutos y no por qué, que es justo el dato con el
     * que se decide si hay que cambiar una pieza o formar a alguien.
     */
    if (estado !== "open" && !motivo.trim()) {
      toast.error("Pon el motivo: un downtime sin motivo no sirve para el informe");
      return;
    }
    setGuardando(true);
    const res = await api.post<{ elapsed: number; downtimeToday: number }>(
      "/api/attractions/status",
      {
        attraction: cambiando._id,
        status: estado,
        reason: motivo.trim() || undefined,
        ...(visitantes.trim() ? { guests: Number(visitantes) } : {}),
        ...(cola.trim() ? { queueMinutes: Number(cola) } : {}),
      }
    );
    setGuardando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cambiar el estado");
      return;
    }
    toast.success(
      `${cambiando.name}: ${ATTRACTION_STATUS[estado]?.label ?? estado}` +
      (res.data?.elapsed ? ` · ${formatNumber(res.data.elapsed)} min en el estado anterior` : "")
    );
    setCambiando(null);
    setVersion((v) => v + 1);
  };

  return (
    <>
      <ResourcePage
        key={version}
        resource="attraction"
        eyebrow="Parque"
        title="Centro de control"
        description="Estado operativo de cada atracción en vivo. Cada cambio de estado queda en la bitácora y suma al downtime del día."
        emptyIcon="MonitorDot"
        createLabel="Nueva atracción"
        filters={[{ name: "operational_status", label: "Estado", options: optionsFrom(ATTRACTION_STATUS) }]}
        rowActions={(a: Atraccion) => (
          <Button
            variant="ghost" size="icon" className="size-8 text-primary hover:text-primary"
            aria-label="Cambiar estado"
            title="Cambiar el estado operativo y registrarlo en la bitácora"
            onClick={() => abrir(a)}
          >
            <Icon name="Activity" className="size-3.5" />
          </Button>
        )}
        fields={[
          { name: "name", label: "Atracción", required: true, span: 2 },
          { name: "code", label: "Código" },
          { name: "attraction_type", label: "Tipo", type: "select", options: optionsFrom(ATTRACTION_TYPE) },
          // `operational_status` NO está aquí: se cambia por el botón de la fila,
          // que es lo único que deja rastro en la bitácora.
          { name: "zone", label: "Zona", type: "reference", resource: "zone", optionLabel: (z: any) => z.name },
          { name: "capacity_hour", label: "Capacidad por hora", type: "number", suffix: "pax/h" },
          { name: "capacity_simultaneous", label: "A la vez", type: "number", suffix: "pax" },
          { name: "duration_min", label: "Duración", type: "number", suffix: "min" },
          { name: "min_height_cm", label: "Altura mínima", type: "number", suffix: "cm" },
          { name: "max_height_cm", label: "Altura máxima", type: "number", suffix: "cm" },
          { name: "min_age", label: "Edad mínima", type: "number", suffix: "años" },
          { name: "max_weight_kg", label: "Peso máximo", type: "number", suffix: "kg" },
          { name: "requires_waiver", label: "Exige descargo", type: "select", options: optionsFrom(YES_NO) },
          { name: "weather_sensitive", label: "Cierra con mal tiempo", type: "select", options: optionsFrom(YES_NO) },
          { name: "health_restrictions", label: "Restricciones de salud", type: "textarea", span: 2 },
          { name: "location", label: "Ubicación" },
          { name: "status", label: "Alta/baja", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
          { name: "notes", label: "Notas", type: "textarea", span: 2 },
        ]}
        columns={[
          { key: "name", header: "Atracción", render: (a: any) => <span className="font-semibold">{a.name}</span> },
          {
            key: "operational_status", header: "Estado",
            render: (a: any) => <StatusBadge value={a.operational_status} dict={ATTRACTION_STATUS} />,
          },
          {
            key: "zone", header: "Zona",
            render: (a: any) => <span>{typeof a.zone === "object" ? a.zone?.name ?? "—" : a.zone ?? "—"}</span>,
          },
          { key: "queue_minutes", header: "Cola (min)", align: "right", render: (a: any) => <span className="tf-num">{formatNumber(a.queue_minutes ?? 0)}</span> },
          { key: "guests_today", header: "Visitantes hoy", align: "right", render: (a: any) => <span className="tf-num">{formatNumber(a.guests_today ?? 0)}</span> },
          {
            key: "downtime_minutes_today", header: "Downtime hoy (min)", align: "right", hideOn: "md",
            render: (a: any) => <span className="tf-num">{formatNumber(a.downtime_minutes_today ?? 0)}</span>,
          },
        ]}
      />

      <Dialog open={!!cambiando} onOpenChange={(v) => !v && setCambiando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar el estado de {cambiando?.name}</DialogTitle>
            <DialogDescription>
              Queda registrado en la bitácora con la hora, quién lo hizo y cuánto duró el estado
              anterior. Es lo que alimenta el downtime del día.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={setEstado}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(ATTRACTION_STATUS).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Motivo{estado !== "open" ? "" : " (opcional)"}
              </Label>
              <Input
                value={motivo}
                placeholder={estado === "open" ? "Vuelve a abrir" : "Avería del freno, tormenta, limpieza…"}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Visitantes hoy</Label>
              <Input type="number" min="0" value={visitantes} placeholder="—"
                onChange={(e) => setVisitantes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cola (min)</Label>
              <Input type="number" min="0" value={cola} placeholder="—"
                onChange={(e) => setCola(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCambiando(null)}>Cancelar</Button>
            <Button onClick={confirmar} disabled={guardando}>
              {guardando ? "Registrando…" : "Registrar cambio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
