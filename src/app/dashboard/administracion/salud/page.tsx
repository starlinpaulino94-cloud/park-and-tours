"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { Icon } from "@/components/tf/icon";
import { Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HEALTH_LABEL, type HealthCheck, type HealthLevel } from "@/lib/system-health";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * ESTADO DEL SISTEMA, LA PANTALLA QUE `/api/health` DABA POR EXISTENTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS COSAS ESCRITAS Y NO LEÍDAS
 *
 * `healthReport()` comprueba la base, el enganche que emite las sesiones, si los
 * cinco trabajos nocturnos corrieron y si hay incidentes abiertos. `/api/health`
 * la devuelve **entera a una sesión de administrador**, y su propio comentario
 * dice por qué: «es quien va a mirar la pantalla de estado».
 *
 * Esa pantalla no existía. Todo lo que los crons escriben —diario de trabajos,
 * incidentes, cortes por empresa— no lo leía nadie. Es el mismo patrón que llevo
 * siete olas cerrando, con una vuelta de tuerca: aquí no faltaba la puerta de
 * salida sino **la de entrada**, la que permite mirar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Y LA REPARACIÓN MANUAL, QUE ERA EL HUECO DEL INVENTARIO
 *
 * `POST /api/maintenance/reconcile-drafts` revierte las ventas que un proceso
 * dejó a medias: sus plazas apartadas, su voucher escaneando como válido y su
 * comisión esperando que la próxima liquidación la pague. Su gemela de `cron`
 * corre sola cada día sobre todas las empresas — pero cuando alguien ve una plaza
 * bloqueada AHORA no va a esperar a mañana, y esa era la única vía y no la
 * llamaba nadie.
 *
 * Vive aquí, junto a la evidencia, y no en un menú cualquiera: la reparación sin
 * el diagnóstico es un botón que alguien pulsa a ver qué pasa.
 */

interface Informe {
  level: HealthLevel;
  checks: HealthCheck[];
  checked_at: string;
}

interface Reconciliacion {
  scanned: number;
  reverted: number;
  expiredApprovals: number;
}

const TONO: Record<HealthLevel, "success" | "warning" | "danger"> = {
  ok: "success", degraded: "warning", down: "danger",
};

const ICONO: Record<HealthLevel, string> = {
  ok: "CircleCheck", degraded: "TriangleAlert", down: "Ban",
};

/**
 * Las ventanas que se ofrecen, y por qué ninguna baja de cinco.
 *
 * La ruta tiene el suelo en cinco minutos: por debajo se revertirían ventas que
 * todavía se están escribiendo. Sesenta es lo que usa el cron, y es el valor
 * prudente; treinta es el de la ruta; ciento veinte, para limpiar después de una
 * caída conocida.
 */
const VENTANAS = ["30", "60", "120"] as const;

export default function SaludPage() {
  const [informe, setInforme] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ventana, setVentana] = useState<string>("60");
  const [reconciliando, setReconciliando] = useState(false);
  const [resultado, setResultado] = useState<Reconciliacion | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    /**
     * DOS COSAS QUE ESTA RUTA HACE DISTINTO, Y LAS DOS A PROPÓSITO.
     *
     * 1. **No usa la envoltura `{ ok, data }`.** Devuelve el informe en la raíz,
     *    porque quien la llama de verdad es un vigilante externo que solo sabe la
     *    URL y no va a desenvolver nada. Así que aquí el cuerpo ES el informe, y
     *    `res.ok` ni existe.
     * 2. **Contesta 503 cuando el sistema está caído**, y eso es una respuesta
     *    correcta, no un fallo de la petición: el cuerpo trae el informe igual.
     *    Tratar el 503 como error dejaría esta pantalla vacía justo cuando hay
     *    algo que mirar.
     *
     * Por eso se comprueba que venga `checks` en vez de mirar `ok`.
     */
    const cuerpo = await api.get<never>("/api/health") as unknown as Partial<Informe> & { error?: { message?: string } };
    setCargando(false);
    if (!Array.isArray(cuerpo.checks)) {
      setError(cuerpo.error?.message || "No se pudo leer el estado del sistema");
      return;
    }
    setError(null);
    setInforme(cuerpo as Informe);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const reconciliar = async () => {
    setReconciliando(true);
    const res = await api.post<Reconciliacion>("/api/maintenance/reconcile-drafts", {
      older_than_minutes: Number(ventana),
    });
    setReconciliando(false);
    if (!res.ok || !res.data) {
      toast.error(res.error?.message || "No se pudo reconciliar");
      return;
    }
    setResultado(res.data);
    toast.success(res.data.reverted > 0
      ? `${res.data.reverted} venta(s) a medias revertidas de ${res.data.scanned} revisadas`
      : `Ninguna venta a medias: ${res.data.scanned} borrador(es) revisados`);
    void cargar();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administración"
        title="Estado del sistema"
        description="Si la base responde, si se pueden emitir sesiones, si los trabajos de anoche corrieron y qué está fallando ahora mismo."
        actions={
          <Button variant="outline" onClick={cargar} disabled={cargando}>
            <Icon name="RefreshCw" className="mr-2 size-4" />
            {cargando ? "Comprobando…" : "Comprobar de nuevo"}
          </Button>
        }
      />

      {informe && (
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone={TONO[informe.level]}>
            <Icon name={ICONO[informe.level]} className="size-3.5" /> {HEALTH_LABEL[informe.level]}
          </Pill>
          <span className="tf-num text-xs text-muted-foreground">
            comprobado {formatDateTime(informe.checked_at)}
          </span>
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">No se pudo leer el estado</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ─────────────────────────── las comprobaciones ─────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Comprobaciones</CardTitle>
          <CardDescription>
            Lo peor primero, que es el orden en que se atienden. El estado del conjunto es el de su
            peor parte, nunca el promedio: una sola cosa rota basta para que el sistema no sirva.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {cargando && !informe && <p className="text-sm text-muted-foreground">Comprobando…</p>}
          {(informe?.checks ?? []).map((c) => (
            <div key={c.key} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Un «correcto» lentísimo también es una señal. */}
                {typeof c.ms === "number" && (
                  <span className="tf-num text-xs text-muted-foreground">{formatNumber(c.ms)} ms</span>
                )}
                <Pill tone={TONO[c.level]}>{HEALTH_LABEL[c.level]}</Pill>
              </div>
            </div>
          ))}
          {informe && informe.checks.length === 0 && (
            <p className="text-sm text-muted-foreground">El informe no trajo comprobaciones.</p>
          )}
        </CardContent>
      </Card>

      {/* ──────────────────── las ventas que se quedaron a medias ───────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ventas que se quedaron a medias</CardTitle>
          <CardDescription>
            Si un proceso muere durante una venta, la orden se queda en borrador con sus plazas
            apartadas, su voucher escaneando como válido y su comisión esperando que la próxima
            liquidación la pague. Esto las revierte. Se puede repetir sin riesgo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ventana">Borradores de más de</Label>
              <Select value={ventana} onValueChange={setVentana}>
                <SelectTrigger id="ventana" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENTANAS.map((v) => (
                    <SelectItem key={v} value={v}>{v} minutos</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={reconciliar} disabled={reconciliando}>
              {reconciliando ? "Reconciliando…" : "Reconciliar ahora"}
            </Button>
          </div>

          {/*
            Por qué no se ofrece una ventana más corta. Es la decisión que la
            gemela de `cron` dejó escrita: una saga normal tarda menos de un
            segundo, así que entre un segundo y una hora solo caben las que de
            verdad murieron. Prefiero que una venta huérfana viva una hora de más
            a revertir una viva.
          */}
          <p className="text-xs text-muted-foreground">
            No se ofrece menos de 30 minutos, y la ruta no acepta menos de 5: una venta que se está
            creando ahora mismo también está en borrador, y revertirla le suelta las plazas a alguien
            que está cobrando en el mostrador. El trabajo automático usa 60.
          </p>

          {resultado && (
            <div className="rounded-lg border p-3 text-sm">
              <p>
                <span className="tf-num font-semibold">{formatNumber(resultado.scanned)}</span> borrador(es)
                revisados ·{" "}
                <span className={`tf-num font-semibold ${resultado.reverted > 0 ? "text-destructive" : ""}`}>
                  {formatNumber(resultado.reverted)}
                </span>{" "}
                revertido(s)
                {resultado.expiredApprovals > 0 && (
                  <> · {formatNumber(resultado.expiredApprovals)} aprobación(es) caducada(s) puestas al día</>
                )}
              </p>
              {resultado.reverted > 0 && (
                // Cada reversión es la huella de un proceso que murió a mitad de
                // una venta: es un síntoma, no una limpieza rutinaria.
                <p className="mt-1 text-xs text-destructive">
                  Cada reversión significa que un proceso murió durante una venta. Queda en la
                  bitácora con severidad de aviso; si se repite, hay algo que mirar.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
