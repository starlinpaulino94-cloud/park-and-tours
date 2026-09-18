"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney, formatNumber } from "@/lib/format";
import type { OctoBookingStatus } from "@/lib/octo";
import type { ChannelRow } from "@/lib/octo-service";

/**
 * LOS CANALES DE VENTA EXTERNOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CONTESTA ESTA PANTALLA
 *
 * Cuando una operadora se conecta a una OTA deja de ver sus propias ventas. Las
 * reservas entran solas, el cupo se mueve solo, y la pregunta del lunes por la
 * mañana —«¿cuánto me trajo GetYourGuide y cuánto de eso se cayó?»— no tiene
 * dónde mirarse.
 *
 * Aquí está: cuántas entraron por cada revendedor, cuántas están retenidas
 * ahora mismo, cuántas se confirmaron y —lo que más duele— cuántas VENCIERON
 * sin pagar. Una tasa de vencimiento alta no es mala suerte: es que el plazo de
 * retención que se le concedió a ese revendedor es demasiado corto para su
 * pasarela de pago, y se arregla con una conversación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VENCIDA NO ES CANCELADA
 *
 * Se enseñan en columnas distintas a propósito. Una cancelación es una
 * incidencia que atender: hay un cliente que se cayó y puede haber reembolso.
 * Un vencimiento es un carrito abandonado en la web del revendedor, y no hay
 * nada que hacer. Mezclarlas haría que la operadora persiguiera fantasmas.
 */

interface Booking {
  id: string;
  reference: string;
  uuid: string;
  resellerReference: string | null;
  testMode: boolean;
  status: OctoBookingStatus;
  holdUntil: string | null;
  product: string;
  partner: string;
  travelDate: string | null;
  pax: number;
  total: number;
  currency: string;
  createdAt: string;
}

interface Payload {
  channels: ChannelRow[];
  bookings: Booking[];
  capabilities: string[];
  endpoint: string;
  days: number;
}

const ESTADO: Record<OctoBookingStatus, { label: string; tone: string }> = {
  ON_HOLD: { label: "Retenida", tone: "bg-amber-100 text-amber-900 border-amber-200" },
  CONFIRMED: { label: "Confirmada", tone: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  REDEEMED: { label: "Embarcada", tone: "bg-sky-100 text-sky-900 border-sky-200" },
  EXPIRED: { label: "Vencida", tone: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  CANCELLED: { label: "Cancelada", tone: "bg-rose-100 text-rose-900 border-rose-200" },
  PENDING: { label: "Pendiente", tone: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  REJECTED: { label: "Rechazada", tone: "bg-rose-100 text-rose-900 border-rose-200" },
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Cuánto le queda a una retención. Es lo único de esta pantalla que corre. */
function restante(holdUntil: string | null): string | null {
  if (!holdUntil) return null;
  const ms = new Date(holdUntil).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "vencida";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} d`;
}

export default function CanalesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [days, setDays] = useState("90");
  const [loading, setLoading] = useState(true);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    setLoading(true);
    const res = await api.get<Payload>(`/api/octo/channels?days=${days}`);
    setLoading(false);
    if (res.ok === false) {
      toast.error(res.error || "No se pudieron cargar los canales");
      return;
    }
    setData(res.data);
  }, [days]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Las retenciones caducan en minutos: un contador congelado enseñaría «28
  // min» durante media hora y haría creer que hay tiempo.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const canales = data?.channels ?? [];
  const reservas = data?.bookings ?? [];
  const total = canales.reduce((acc, c) => acc + c.bookings, 0);
  const confirmadas = canales.reduce((acc, c) => acc + c.confirmed + c.redeemed, 0);
  const vencidas = canales.reduce((acc, c) => acc + c.expired, 0);
  const ingreso = canales.reduce((acc, c) => acc + c.revenue, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canales externos"
        description="Lo que traen los revendedores conectados por el estándar OCTO."
        actions={
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
                <SelectItem value="365">Último año</SelectItem>
              </SelectContent>
            </Select>
            {/*
              Esta pantalla no tiene alta, y no le falta: un canal no se crea, se
              CONECTA. Aparece aquí solo cuando un revendedor empieza a reservar
              contra el conector OCTO, porque lo que se lista son sus reservas
              agrupadas por socio.
              Lo que sí hacía falta era decir dónde se habilita, porque quien
              abre esta pantalla vacía no tiene forma de adivinarlo.
            */}
            <Link href="/dashboard/administracion/integraciones">
              <Button variant="outline" className="gap-1.5">
                <Icon name="Plug" className="size-4" /> Conectar un canal
              </Button>
            </Link>
            <Button variant="outline" onClick={() => void cargar()} disabled={loading}>
              <Icon name="RefreshCw" className="mr-2 h-4 w-4" />
              Actualizar
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Reservas entrantes" value={formatNumber(total)} icon="Inbox" />
        <KpiCard label="Confirmadas" value={formatNumber(confirmadas)} icon="CircleCheck" />
        <KpiCard
          label="Vencidas sin pagar"
          value={formatNumber(vencidas)}
          icon="TimerOff"
          hint={total > 0 ? `${Math.round((vencidas / total) * 100)}% de lo que entró` : undefined}
        />
        <KpiCard label="Venta confirmada" value={formatMoney(ingreso)} icon="Banknote" />
      </div>

      {/* ── la dirección que hay que darle al revendedor ───────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dirección de conexión</CardTitle>
          <CardDescription>
            Esto es lo que se le entrega a una OTA, junto con una llave de API de escritura.
            Quien hable OCTO se conecta sin que haya que programar nada más.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
            {typeof window !== "undefined" ? window.location.origin : ""}{data?.endpoint ?? "/api/octo/v1"}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Capacidades soportadas:</span>
            {(data?.capabilities ?? []).map((cap) => (
              <Badge key={cap} variant="secondary" className="font-mono text-xs">{cap}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── por revendedor ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por revendedor</CardTitle>
          <CardDescription>
            Las de prueba no se cuentan: toda OTA certifica la conexión contra el sistema real
            antes de abrir la venta, y esas reservas no son negocio.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {canales.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Cargando…" : "Todavía no ha entrado ninguna reserva por un canal externo."}
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Revendedor</th>
                  <th className="px-4 py-2 text-right font-medium">Entraron</th>
                  <th className="px-4 py-2 text-right font-medium">Retenidas</th>
                  <th className="px-4 py-2 text-right font-medium">Confirmadas</th>
                  <th className="px-4 py-2 text-right font-medium">Embarcadas</th>
                  <th className="px-4 py-2 text-right font-medium">Vencidas</th>
                  <th className="px-4 py-2 text-right font-medium">Canceladas</th>
                  <th className="px-4 py-2 text-right font-medium">Venta</th>
                  <th className="px-4 py-2 text-left font-medium">Última</th>
                </tr>
              </thead>
              <tbody>
                {canales.map((canal) => (
                  <tr key={canal.partnerId ?? "sin-socio"} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{canal.partnerName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(canal.bookings)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(canal.onHold)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(canal.confirmed)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(canal.redeemed)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {formatNumber(canal.expired)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                      {formatNumber(canal.cancelled)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(canal.revenue)}</td>
                    <td className="px-4 py-2 text-left text-muted-foreground">{fecha(canal.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── lo último que entró ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas reservas entrantes</CardTitle>
          <CardDescription>
            La referencia del revendedor es por la que pregunta la OTA cuando escribe
            «esta reserva no aparece».
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {reservas.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Cargando…" : "Sin reservas entrantes todavía."}
            </p>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Reserva</th>
                  <th className="px-4 py-2 text-left font-medium">Revendedor</th>
                  <th className="px-4 py-2 text-left font-medium">Su referencia</th>
                  <th className="px-4 py-2 text-left font-medium">Producto</th>
                  <th className="px-4 py-2 text-left font-medium">Viaje</th>
                  <th className="px-4 py-2 text-right font-medium">Pax</th>
                  <th className="px-4 py-2 text-right font-medium">Importe</th>
                  <th className="px-4 py-2 text-left font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {reservas.map((reserva) => {
                  const queda = reserva.status === "ON_HOLD" ? restante(reserva.holdUntil) : null;
                  void ahora; // el intervalo fuerza el recálculo del contador
                  return (
                    <tr key={reserva.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">
                        {reserva.reference || "—"}
                        {reserva.testMode && (
                          <Badge variant="outline" className="ml-2 text-[10px]">prueba</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">{reserva.partner || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {reserva.resellerReference || "—"}
                      </td>
                      <td className="px-4 py-2">{reserva.product || "—"}</td>
                      <td className="px-4 py-2">{fecha(reserva.travelDate)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatNumber(reserva.pax)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(reserva.total, reserva.currency)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className={ESTADO[reserva.status]?.tone}>
                          {ESTADO[reserva.status]?.label ?? reserva.status}
                        </Badge>
                        {queda && (
                          <span className="ml-2 text-xs text-muted-foreground">quedan {queda}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
