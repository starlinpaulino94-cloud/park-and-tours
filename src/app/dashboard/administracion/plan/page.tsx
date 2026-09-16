"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SUBSCRIPTION_STATUS } from "@/lib/labels-modules";
import { MODULE_LABEL } from "@/lib/labels";
import { formatNumber, formatDate } from "@/lib/format";
import type { PlanStatus, LimitMetric } from "@/lib/plan";

/**
 * TU PLAN Y USO.
 *
 * Existe por una razón concreta: desde 0042 el plan BLOQUEA. Un límite que
 * rechaza una venta sin que nadie pueda ver cuánto le quedaba es peor que no
 * tener límite —convierte una decisión comercial en un error de sistema, y cada
 * tope en una llamada a soporte—. Aquí se ve venir.
 *
 * Los números salen de `planStatusFor`, que usa el MISMO `limitCheck` que las
 * guardas de la API. Dos cálculos para la misma pregunta es cómo se llega a una
 * pantalla que promete un usuario que la API rechaza.
 */

const METRIC_INFO: Record<LimitMetric, { label: string; help: string; icon: string }> = {
  max_users: {
    label: "Usuarios",
    help: "Cuentas activas e invitaciones sin aceptar. Desactivar una libera su plaza.",
    icon: "Users",
  },
  max_bookings_month: {
    label: "Reservas este mes",
    help: "Creadas desde el día 1. Vuelve a cero al empezar el mes.",
    icon: "CalendarCheck",
  },
  max_products: {
    label: "Productos",
    help: "Los de tu catálogo que no están inactivos.",
    icon: "Package",
  },
  max_storage_mb: {
    label: "Almacenamiento",
    help: "Fotos, documentos y adjuntos que has subido.",
    icon: "Boxes",
  },
};

const fmt = (metric: LimitMetric, value: number): string =>
  metric === "max_storage_mb" ? `${formatNumber(value, value < 10 ? 1 : 0)} MB` : formatNumber(value);

/** La barra del medidor. Ámbar al 80 %, roja al tope: el color avisa antes que el número. */
function Medidor({ percent, warn, full }: { percent: number | null; warn: boolean; full: boolean }) {
  if (percent === null) return null;
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div
        className={
          full ? "h-full rounded-full bg-rose-500"
          : warn ? "h-full rounded-full bg-amber-500"
          : "h-full rounded-full bg-emerald-500"
        }
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );
}

export default function PlanPage() {
  const [data, setData] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api.get<PlanStatus>("/api/plan");
    setLoading(false);
    if (res.ok && res.data) setData(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Administración" title="Tu plan y uso" />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No se pudo cargar la información de tu plan. Vuelve a intentarlo en un momento.
        </CardContent></Card>
      </div>
    );
  }

  const { plan, subscription, limits, modules, usage } = data;
  const incluidos = modules.filter((m) => m.enabled);
  const fuera = modules.filter((m) => !m.enabled);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title="Tu plan y uso"
        description="Qué incluye tu plan, cuánto llevas usado y qué pasa cuando se llena."
      />

      {/* ── El estado, arriba: es lo que decide si hoy se puede trabajar ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-lg">{plan?.name || "Sin plan asignado"}</CardTitle>
              <CardDescription>
                {plan
                  ? subscription.status === "trial" && subscription.trialDaysLeft !== null
                    ? subscription.trialDaysLeft >= 0
                      ? `Te quedan ${subscription.trialDaysLeft} día(s) de prueba.`
                      : "Tu periodo de prueba terminó."
                    : subscription.status === "past_due" && subscription.graceDaysLeft !== null
                      ? subscription.graceDaysLeft > 0
                        ? `No pudimos cobrar tu suscripción. Tienes ${subscription.graceDaysLeft} día(s) para actualizar tu método de pago.`
                        : "No pudimos cobrar tu suscripción."
                      : "Tu suscripción está al día."
                  : "Tu empresa no tiene plan asignado, así que no se aplica ningún límite."}
              </CardDescription>
            </div>
            {subscription.status !== "unknown" && (
              <StatusBadge value={subscription.status} dict={SUBSCRIPTION_STATUS} />
            )}
          </div>
        </CardHeader>

        {!subscription.canWrite && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/40">
              <p className="flex items-center gap-2 font-medium text-rose-900 dark:text-rose-200">
                <Icon name="OctagonX" className="h-4 w-4 shrink-0" />
                No puedes registrar operaciones nuevas
              </p>
              {/* El mensaje que promete lo que de verdad pasa: se pierde la
                  escritura, no el acceso. Es la política del sistema, no un
                  consuelo redactado en la pantalla. */}
              <p className="mt-1 text-rose-800 dark:text-rose-200/90">
                Consultar, imprimir y exportar todo lo que ya registraste sigue funcionando.
                Tus datos no se tocan.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Los medidores ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {limits.map((limit) => {
          const info = METRIC_INFO[limit.metric];
          const full = limit.limit !== null && !limit.allowed;
          return (
            <Card key={limit.metric}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon name={info.icon} className="h-3.5 w-3.5" />
                    {info.label}
                  </p>
                  {full ? <Pill tone="danger">Lleno</Pill>
                    : limit.warn ? <Pill tone="warning">Casi lleno</Pill> : null}
                </div>

                <p className="mt-2 text-xl font-semibold tabular-nums">
                  {fmt(limit.metric, limit.used)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {limit.limit === null ? "· sin límite" : `de ${fmt(limit.metric, limit.limit)}`}
                  </span>
                </p>

                <Medidor percent={limit.percent} warn={limit.warn} full={full} />

                <p className="mt-2 text-xs text-muted-foreground">
                  {full
                    ? "Sube de plan o libera espacio para seguir creando."
                    : limit.remaining !== null
                      ? `Te caben ${fmt(limit.metric, limit.remaining)} más.`
                      : info.help}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Los módulos: lo que entra y lo que no ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Módulos</CardTitle>
          <CardDescription>
            Los que no están incluidos se pueden ver, pero no registrar nada nuevo: lo que
            ya guardaste con un plan anterior sigue ahí y se puede exportar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Incluidos ({incluidos.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {incluidos.map((m) => (
                <Pill key={m.key} tone="success">{MODULE_LABEL[m.key] || m.key}</Pill>
              ))}
            </div>
          </div>

          {fuera.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                No incluidos ({fuera.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {fuera.map((m) => (
                  <Pill key={m.key} tone="neutral">{MODULE_LABEL[m.key] || m.key}</Pill>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Cómo cambiar de plan ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">¿Necesitas más?</CardTitle>
          <CardDescription>
            Escríbenos y subimos tu plan el mismo día. Nada de lo que ya registraste se
            pierde ni se mueve al cambiar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/dashboard/perfil">
              <Icon name="Mail" className="mr-1.5 h-4 w-4" /> Contactar
            </a>
          </Button>
          {usage.bookingsThisMonth > 0 && (
            <span className="text-xs text-muted-foreground">
              Este mes llevas {formatNumber(usage.bookingsThisMonth)} reserva(s) registradas.
            </span>
          )}
        </CardContent>
      </Card>

      {subscription.status === "trial" && subscription.trialDaysLeft !== null && subscription.trialDaysLeft >= 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Tu prueba termina el {formatDate(new Date(Date.now() + subscription.trialDaysLeft * 86_400_000).toISOString())}.
        </p>
      )}
    </div>
  );
}
