"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * La tarjeta de MembeGo en Integraciones.
 *
 * MembeGo es la plataforma de membresías y fidelización del mismo dueño: sus
 * empresas del vertical de excursiones ven este sistema en su lanzador de
 * aplicaciones y entran por SSO, y sus webhooks empujan clientes, visitas,
 * compras y membresías hacia acá. Esta tarjeta enseña el estado real de esa
 * tubería —vínculo, gente que ha entrado, clientes sincronizados, últimos
 * eventos— y las llaves de paso (pausar, reanudar, desvincular).
 *
 * No es una fila más del CRUD de integraciones de abajo porque no es una
 * integración configurable por registro: es cableado de plataforma con su
 * propio secreto en el entorno y su propio estado en la base.
 */

interface LinkInfo {
  membego_company_id: string;
  status: string;
  linked_at: string;
  last_event_at: string | null;
  events_received: number;
}

interface StatusData {
  configured: boolean;
  link: LinkInfo | null;
  members: number;
  customers: number;
  recent: { event_id: string; tipo: string; status: string; received_at: string }[];
  failed: number;
}

const EVENT_LABELS: Record<string, string> = {
  "cliente.registrado": "Cliente registrado",
  "cliente.primera_visita": "Primera visita",
  "cliente.visita": "Visita",
  "cliente.compro_servicio": "Compra",
  "cliente.primera_compra": "Primera compra",
  "membresia.activada": "Membresía activada",
  "referido.convirtio": "Referido convertido",
};

const EVENT_STATUS: Record<string, { label: string; tone: "success" | "neutral" | "danger" }> = {
  processed: { label: "Procesado", tone: "success" },
  ignored: { label: "Ignorado", tone: "neutral" },
  failed: { label: "Fallido", tone: "danger" },
};

export function MembegoCard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<StatusData>("/api/membego/status");
    setLoading(false);
    if (res.ok && res.data) setData(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (action: "suspend" | "reactivate" | "unlink") => {
    if (action === "unlink" && !window.confirm(
      "¿Desvincular esta organización de MembeGo?\n\nLos clientes y eventos ya sincronizados se conservan, " +
      "pero el SSO y los webhooks dejarán de funcionar hasta que un administrador vuelva a entrar desde MembeGo."
    )) return;
    setBusy(true);
    const res = await api.post(`/api/membego/status`, { action });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo aplicar el cambio");
      return;
    }
    toast.success(
      action === "suspend" ? "Integración pausada: los eventos esperarán en la cola de MembeGo"
      : action === "reactivate" ? "Integración reactivada"
      : "Vínculo eliminado; los datos sincronizados se conservan"
    );
    load();
  };

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/membego/webhook` : "/api/membego/webhook";

  if (loading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // Sin permiso de admin o sin respuesta: la tarjeta no aporta nada, el CRUD
  // general de abajo sigue disponible.
  if (!data) return null;

  const link = data.link;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Icon name="Handshake" className="h-5 w-5 text-primary" />
              MembeGo — membresías y fidelización
            </CardTitle>
            <CardDescription>
              Tu plataforma de membresías. El equipo entra por SSO desde su lanzador de
              aplicaciones y los clientes, visitas, compras y membresías llegan solos por webhook.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!data.configured ? (
              <Pill tone="neutral">Sin configurar</Pill>
            ) : !link ? (
              <Pill tone="neutral">Sin vincular</Pill>
            ) : link.status === "active" ? (
              <Pill tone="success">Conectado</Pill>
            ) : (
              <Pill tone="warning">Pausado</Pill>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.configured && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Falta el secreto compartido</p>
            <p>
              Registra este sistema en MembeGo (manifiesto <code className="rounded bg-muted px-1">park-and-tours</code>,
              vertical de excursiones) y guarda el secreto que imprime como la variable de entorno{" "}
              <code className="rounded bg-muted px-1">MEMBEGO_SECRETO</code> de esta aplicación. Sin él, el SSO y el
              webhook rechazan todo.
            </p>
          </div>
        )}

        {data.configured && !link && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Listo para vincular</p>
            <p>
              El vínculo lo crea el primer inicio de sesión: un administrador de la empresa en MembeGo abre{" "}
              <span className="font-medium">Park &amp; Tours</span> desde el lanzador de aplicaciones, y si su correo
              es dueño o administrador de esta organización, la conexión queda hecha. Los webhooks de MembeGo
              reintentan cada hora, así que los eventos previos al vínculo llegan solos después.
            </p>
            <p>
              URL del webhook: <code className="rounded bg-muted px-1">{webhookUrl}</code>
            </p>
          </div>
        )}

        {link && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Empresa en MembeGo</p>
                <p className="mt-1 truncate font-mono text-xs" title={link.membego_company_id}>{link.membego_company_id}</p>
                <p className="mt-1 text-xs text-muted-foreground">desde {formatDateTime(link.linked_at)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Equipo por SSO</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data.members)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Clientes sincronizados</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data.customers)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Eventos recibidos</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(link.events_received)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {link.last_event_at ? `último ${formatDateTime(link.last_event_at)}` : "ninguno todavía"}
                </p>
              </div>
            </div>

            {data.failed > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <span className="font-medium">{formatNumber(data.failed)} evento(s) fallidos.</span>{" "}
                El payload íntegro quedó guardado; revisa el registro del servidor para repararlos.
              </div>
            )}

            {data.recent.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Últimos eventos</div>
                <ul className="divide-y">
                  {data.recent.map((ev) => {
                    const st = EVENT_STATUS[ev.status] || { label: ev.status, tone: "neutral" as const };
                    return (
                      <li key={ev.event_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="truncate">{EVENT_LABELS[ev.tipo] || ev.tipo}</span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-xs text-muted-foreground">{formatDateTime(ev.received_at)}</span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {link.status === "active" ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act("suspend")}>
                  <Icon name="PauseCircle" className="mr-1.5 h-4 w-4" /> Pausar
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act("reactivate")}>
                  <Icon name="PlayCircle" className="mr-1.5 h-4 w-4" /> Reanudar
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} className="text-destructive" onClick={() => act("unlink")}>
                <Icon name="Unlink" className="mr-1.5 h-4 w-4" /> Desvincular
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
