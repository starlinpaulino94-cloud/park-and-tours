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
import { GENERIC_STATUS } from "@/lib/labels";
import { ASSET_STATUS, ASSET_TYPE, CRITICALITY, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";

/** Lo que devuelve `changeAssetStatus`, con o sin `dryRun`. */
interface Impacto {
  assetName: string;
  from: string;
  to: string;
  blocksCapacity: boolean;
  seatsLost: number;
  departuresAffected: {
    _id: string; product: string; departureAt: string | null;
    capacityBefore: number; capacityAfter: number; bookedPax: number;
    oversold: number; closed: boolean;
  }[];
  bookingsAtRisk: { _id: string; bookingNumber: string; pax: number; customer: string }[];
}

/**
 * BAJAR UN ACTIVO NO ES EDITAR UN CAMPO: ES CERRAR SALIDAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES
 *
 * `asset-impact.ts` es un motor completo —recalcula el cupo de cada salida
 * futura que usa el activo, CIERRA las que ya no se pueden servir, arrastra a
 * mantenimiento la atracción que depende de él con su entrada de bitácora, y
 * **crea una tarea urgente por cada salida afectada para que alguien llame a
 * los clientes que se quedan fuera**— y su ruta, `POST /api/assets/:id/status`,
 * no la llamaba nadie.
 *
 * Mientras tanto esta pantalla ofrecía `operational_status` como un campo más
 * del formulario. Así que el activo SÍ se podía marcar «fuera de servicio»: la
 * insignia cambiaba y no pasaba nada de lo anterior. El cupo seguía a la venta,
 * la atracción seguía figurando abierta, y **los clientes que se quedaban sin
 * plaza no recibían aviso, porque la tarea no llegaba a existir**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIMERO SE ENSEÑA LA CONSECUENCIA, DESPUÉS SE CONFIRMA
 *
 * La ruta acepta `dryRun`, y esto lo usa: al elegir el estado se pide el
 * impacto sin escribir nada y se enseña qué salidas se cierran y **qué reservas
 * se quedan sobre el cupo, con su número y su cliente**. Solo entonces aparece
 * el botón de confirmar.
 *
 * No es adorno: bajar una guagua un sábado puede cerrar seis salidas y dejar a
 * cuarenta personas fuera. Quien pulsa tiene derecho a verlo antes.
 */
export default function ActivosPage() {
  const [version, setVersion] = useState(0);
  const [activo, setActivo] = useState<{ _id: string; name?: string; operational_status?: string } | null>(null);
  const [estado, setEstado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const abrir = (a: any) => {
    setActivo(a);
    setEstado("");
    setMotivo("");
    setImpacto(null);
  };

  /** Pide el impacto SIN escribir nada. */
  const previsualizar = async (destino: string) => {
    setEstado(destino);
    setImpacto(null);
    if (!activo || destino === activo.operational_status) return;
    setCalculando(true);
    const res = await api.post<Impacto>(`/api/assets/${activo._id}/status`, {
      status: destino, reason: motivo.trim() || undefined, dryRun: true,
    });
    setCalculando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo calcular el impacto");
      return;
    }
    setImpacto(res.data ?? null);
  };

  const confirmar = async () => {
    if (!activo || !estado) return;
    setConfirmando(true);
    const res = await api.post<Impacto>(`/api/assets/${activo._id}/status`, {
      status: estado, reason: motivo.trim() || undefined,
    });
    setConfirmando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cambiar el estado");
      return;
    }
    const cerradas = res.data?.departuresAffected.filter((d) => d.closed).length ?? 0;
    const enRiesgo = res.data?.bookingsAtRisk.length ?? 0;
    toast.success(
      `${activo.name}: ${ASSET_STATUS[estado]?.label ?? estado}` +
      (cerradas ? ` · ${cerradas} salida(s) cerrada(s)` : "") +
      (enRiesgo ? ` · tarea creada para reubicar ${enRiesgo} reserva(s)` : "")
    );
    setActivo(null);
    setVersion((v) => v + 1);
  };

  return (
    <>
    <ResourcePage
      key={version}
      resource="asset"
      eyebrow="Mantenimiento"
      title="Activos"
      description="Atracciones, vehículos, embarcaciones y equipos con su estado, medidores y criticidad. Marcar un activo como bloqueante hace que su caída reduzca el cupo vendible."
      createLabel="Nuevo activo"
      emptyIcon="Cog"
      emptyTitle="Sin activos registrados"
      emptyDescription="Registra los activos que sostienen la operación para controlar su mantenimiento y su impacto en ventas."
      rowActions={(a: any) => (
        <Button
          variant="ghost" size="icon" className="size-8 text-primary hover:text-primary"
          aria-label="Cambiar estado operativo"
          title="Cambiar el estado y ver antes qué salidas y reservas se ven afectadas"
          onClick={() => abrir(a)}
        >
          <Icon name="Wrench" className="size-3.5" />
        </Button>
      )}
      filters={[
        { name: "operational_status", label: "Estado", options: optionsFrom(ASSET_STATUS) },
        { name: "asset_type", label: "Tipo", options: optionsFrom(ASSET_TYPE) },
        { name: "criticality", label: "Criticidad", options: optionsFrom(CRITICALITY) },
      ]}
      columns={[
        {
          key: "name", header: "Activo",
          render: (a: any) => (
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-muted-foreground">
                {[a.code, a.serial_number, a.zone?.name || a.location].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (a: any) => <StatusBadge value={a.asset_type} dict={ASSET_TYPE} dot={false} /> },
        { key: "op", header: "Estado", render: (a: any) => <StatusBadge value={a.operational_status} dict={ASSET_STATUS} /> },
        { key: "crit", header: "Criticidad", hideOn: "sm", render: (a: any) => <StatusBadge value={a.criticality} dict={CRITICALITY} dot={false} /> },
        { key: "blocks", header: "Bloquea cupo", hideOn: "lg", render: (a: any) => <StatusBadge value={a.blocks_capacity} dict={YES_NO} dot={false} /> },
        {
          key: "meter", header: "Medidor", align: "right", hideOn: "lg",
          render: (a: any) => (
            <span className="tf-num text-xs">
              {a.meter_hours ? `${formatNumber(a.meter_hours)} h` : a.meter_km ? `${formatNumber(a.meter_km)} km` : "—"}
            </span>
          ),
        },
        { key: "next", header: "Próximo mant.", hideOn: "lg", render: (a: any) => <span className="tf-num text-xs">{a.next_maintenance_at ? formatDate(a.next_maintenance_at) : "—"}</span> },
        { key: "status", header: "Alta", render: (a: any) => <StatusBadge value={a.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "asset_type", label: "Tipo", type: "select", defaultValue: "equipment", options: optionsFrom(ASSET_TYPE) },
        { name: "criticality", label: "Criticidad", type: "select", defaultValue: "medium", options: optionsFrom(CRITICALITY) },
        { name: "blocks_capacity", label: "Bloquea capacidad", type: "select", defaultValue: "no", options: optionsFrom(YES_NO),
          help: "Si es Sí, al salir de servicio se recalcula el cupo vendible de las salidas que lo usan." },
        { name: "attraction", label: "Atracción", type: "reference", resource: "attraction" },
        { name: "vehicle", label: "Vehículo", type: "reference", resource: "vehicle" },
        { name: "zone", label: "Zona", type: "reference", resource: "zone" },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "serial_number", label: "Serie / VIN" },
        { name: "location", label: "Ubicación" },
        { name: "capacity", label: "Capacidad", type: "number", suffix: "pax" },
        { name: "purchase_date", label: "Fecha de compra", type: "date" },
        { name: "purchase_cost", label: "Costo de compra", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "warranty_until", label: "Garantía hasta", type: "date" },
        { name: "meter_hours", label: "Horómetro", type: "number", suffix: "h" },
        { name: "meter_km", label: "Kilometraje", type: "number", suffix: "km" },
        { name: "next_maintenance_at", label: "Próximo mantenimiento", type: "datetime" },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "status", label: "Alta", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />

    <Dialog open={!!activo} onOpenChange={(v) => !v && setActivo(null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cambiar el estado de {activo?.name}</DialogTitle>
          <DialogDescription>
            Si el activo bloquea cupo, bajarlo recalcula las salidas futuras que lo usan y
            cierra las que ya no se pueden servir. Aquí se ve antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Estado destino</Label>
              <Select value={estado} onValueChange={previsualizar}>
                <SelectTrigger><SelectValue placeholder="Elige el estado" /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(ASSET_STATUS)
                    .filter((o) => o.value !== activo?.operational_status)
                    .map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input value={motivo} placeholder="Avería, revisión, siniestro…"
                onChange={(e) => setMotivo(e.target.value)} />
            </div>
          </div>

          {calculando && (
            <p className="text-sm text-muted-foreground">Calculando el impacto…</p>
          )}

          {impacto && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              {!impacto.blocksCapacity ? (
                <p className="text-sm">
                  Este activo <strong>no bloquea cupo</strong>: el cambio no toca ninguna salida.
                </p>
              ) : impacto.departuresAffected.length === 0 ? (
                <p className="text-sm">
                  Bloquea cupo, pero <strong>no hay salidas futuras</strong> que lo usen.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <strong className="tf-num">{formatNumber(impacto.departuresAffected.length)}</strong> salida(s)
                    afectada(s){impacto.seatsLost ? <> · <strong className="tf-num">{formatNumber(impacto.seatsLost)}</strong> plazas menos cada una</> : null}
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded border bg-background">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60">
                        <tr>
                          <th className="p-1.5 text-left">Salida</th>
                          <th className="p-1.5 text-left">Cuándo</th>
                          <th className="p-1.5 text-right">Cupo</th>
                          <th className="p-1.5 text-right">Vendido</th>
                          <th className="p-1.5 text-left">Queda</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impacto.departuresAffected.map((d) => (
                          <tr key={d._id} className="border-t">
                            <td className="p-1.5">{d.product}</td>
                            <td className="p-1.5 tf-num">{d.departureAt ? formatDateTime(d.departureAt) : "—"}</td>
                            <td className="p-1.5 text-right tf-num">
                              {formatNumber(d.capacityBefore)} → {formatNumber(d.capacityAfter)}
                            </td>
                            <td className="p-1.5 text-right tf-num">{formatNumber(d.bookedPax)}</td>
                            <td className="p-1.5">
                              {d.closed
                                ? <span className="font-semibold text-destructive">se cierra</span>
                                : <span className="text-muted-foreground">abierta</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Lo que de verdad decide si esto se pulsa o no: a quién deja fuera. */}
              {impacto.bookingsAtRisk.length > 0 && (
                <div className="rounded-lg bg-destructive/10 p-2.5 text-[13px] text-destructive">
                  <p className="font-semibold">
                    {formatNumber(impacto.bookingsAtRisk.length)} reserva(s) quedan sobre el cupo
                  </p>
                  <p className="mt-1">
                    {impacto.bookingsAtRisk.map((b) => `${b.bookingNumber} · ${b.customer} (${b.pax} pax)`).join(" — ")}
                  </p>
                  <p className="mt-1.5 opacity-90">
                    Al confirmar se crea una tarea urgente para contactarles. Nadie se cancela solo.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setActivo(null)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!estado || calculando || confirmando}>
            {confirmando ? "Aplicando…" : "Confirmar el cambio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
