"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { optionsFrom } from "@/components/tf/options";
import { MESSAGE_CHANNEL, MESSAGE_STATUS, MESSAGE_TEMPLATE_KEY } from "@/lib/labels-modules";
import { formatDateTime, formatNumber } from "@/lib/format";

interface Message {
  _id: string;
  channel?: string; template_key?: string; language?: string; status?: string;
  to_address?: string; to_name?: string; subject?: string; body?: string;
  scheduled_at?: string; sent_at?: string; attempts?: number; last_error?: string;
  provider?: string; provider_message_id?: string;
  customer?: any; booking?: any; quote?: any;
  createdAt?: string;
}

interface Channels { email: boolean; whatsapp: boolean; sms: boolean }

const PAGE_SIZE = 50;

/**
 * La bandeja de salida: todo lo que se le ha dicho a un cliente.
 *
 * Antes no se le decía nada desde el sistema — las confirmaciones y los
 * recordatorios salían del WhatsApp personal de quien atendiera— y por eso
 * "¿se le avisó?" no tenía respuesta. Aquí cada aviso deja constancia de a quién
 * fue, por qué canal, cuándo salió y, si no salió, por qué: que es justo lo que
 * hace falta para arreglarlo y reintentarlo.
 */
export default function CommunicationsPage() {
  const [rows, setRows] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * ENVIAR UN MENSAJE SUELTO.
   *
   * La pantalla listaba la cola de mensajes y no ofrecía forma de poner uno.
   * Todo lo que había salía de un disparador —confirmar una reserva, recordar un
   * saldo— o del cron nocturno, así que escribirle a un cliente por una razón que
   * el sistema no prevé era imposible desde aquí.
   */
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ key: "booking_confirmation", channel: "email", to: "", to_name: "" });
  const [sending, setSending] = useState(false);

  const send = async () => {
    const destino = draft.to.trim();
    if (!destino) { toast.error("Falta a quién enviarlo"); return; }
    setSending(true);
    const res = await api.post("/api/messages", {
      key: draft.key,
      channel: draft.channel,
      // El contacto viaja en la clave del canal elegido: el servidor decide por
      // dónde sale según lo que reciba, no según lo que diga el formulario.
      to: draft.channel === "email" ? { email: destino }
        : draft.channel === "whatsapp" ? { whatsapp: destino }
        : { phone: destino },
      to_name: draft.to_name.trim() || undefined,
      deliver_now: true,
    });
    setSending(false);
    if (!res.ok) {
      console.error("[comunicaciones] no se pudo encolar el mensaje:", res.error);
      toast.error(res.error?.message || "No se pudo enviar el mensaje");
      return;
    }
    toast.success("Mensaje encolado");
    setComposing(false);
    setDraft({ key: "booking_confirmation", channel: "email", to: "", to_name: "" });
    void load();
  };
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all");
  const [channelFilter, setChannelFilter] = useState("__all");
  const [keyFilter, setKeyFilter] = useState("__all");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Message | null>(null);
  const [retryTo, setRetryTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "__all") params.set("status", statusFilter);
    if (channelFilter !== "__all") params.set("channel", channelFilter);
    if (keyFilter !== "__all") params.set("template_key", keyFilter);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    const res = await api.get<Message[]>(`/api/messages?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[comunicaciones] error cargando la bandeja:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la bandeja de salida");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
    setChannels((res as { channels?: Channels }).channels ?? null);
  }, [statusFilter, channelFilter, keyFilter, page]);

  useEffect(() => { load(); }, [load]);

  const act = async (message: Message, action: "retry" | "cancel") => {
    setBusy(true);
    const res = await api.post(`/api/messages/${message._id}`, {
      action,
      ...(action === "retry" && retryTo.trim() ? { to_address: retryTo.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo completar la acción");
      return;
    }
    toast.success(action === "retry" ? "Mensaje reencolado" : "Mensaje cancelado");
    setDetail(null);
    setRetryTo("");
    void load();
  };

  const queued = rows.filter((r) => r.status === "queued").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const sent = rows.filter((r) => r.status === "sent").length;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  // Un canal sin credenciales no pierde los avisos: se quedan en cola. Pero hay
  // que decirlo, porque si no parece que el sistema simplemente no manda.
  const offline = useMemo(
    () => (channels ? (["email", "whatsapp"] as const).filter((c) => !channels[c]) : []),
    [channels]
  );

  return (
    <div className="space-y-6">

      <Dialog open={composing} onOpenChange={setComposing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo mensaje</DialogTitle>
            <DialogDescription>
              Sale con una plantilla de la empresa, igual que los automáticos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="msg-key">Plantilla</Label>
              <Select value={draft.key} onValueChange={(v) => setDraft((d) => ({ ...d, key: v }))}>
                <SelectTrigger id="msg-key"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(MESSAGE_TEMPLATE_KEY).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="msg-channel">Canal</Label>
              <Select value={draft.channel} onValueChange={(v) => setDraft((d) => ({ ...d, channel: v }))}>
                <SelectTrigger id="msg-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(MESSAGE_CHANNEL).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="msg-to">
                {draft.channel === "email" ? "Correo" : draft.channel === "whatsapp" ? "WhatsApp" : "Teléfono"}
              </Label>
              <Input
                id="msg-to"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                placeholder={draft.channel === "email" ? "cliente@correo.com" : "+1 809 555 0101"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="msg-name">A nombre de</Label>
              <Input
                id="msg-name"
                value={draft.to_name}
                onChange={(e) => setDraft((d) => ({ ...d, to_name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposing(false)}>Cancelar</Button>
            <Button onClick={send} disabled={sending}>{sending ? "Enviando…" : "Enviar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="Comunicaciones"
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setComposing(true)}>
              <Icon name="Plus" className="size-4" /> Nuevo mensaje
            </Button>
            <Link href="/dashboard/clientes/comunicaciones/plantillas">
              <Button variant="outline" className="gap-1.5">
                <Icon name="FileText" className="size-4" /> Plantillas
              </Button>
            </Link>
          </>
        }
      />

      {offline.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" />
          <span>
            {offline.map((c) => MESSAGE_CHANNEL[c]?.label).join(" y ")}{" "}
            {offline.length === 1 ? "no tiene" : "no tienen"} proveedor configurado en el entorno, así que los
            avisos de {offline.length === 1 ? "ese canal" : "esos canales"} se quedan en cola.
            No se pierde ninguno: en cuanto haya credenciales, salen solos.
          </span>
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="amber" icon="Clock" label="En cola" value={formatNumber(queued)}
          hint="Esperando su turno o su hora · en esta página" />
        <KpiCard tone="ink" icon="CircleCheck" label="Entregados" value={formatNumber(sent)}
          hint="Confirmados por el proveedor" />
        <KpiCard tone="primary" icon="TriangleAlert" label="Fallidos" value={formatNumber(failed)}
          hint={failed > 0 ? "Corrige el dato y reintenta desde el detalle" : "Nada que reintentar"}
          definition="Un mensaje falla por un dato del cliente (sin correo, teléfono inválido) o por un rechazo del proveedor." />
        <KpiCard icon="Mail" label="Total" value={formatNumber(total)}
          hint="Mensajes registrados con los filtros actuales" />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(MESSAGE_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Canal: todos</SelectItem>
            {optionsFrom(MESSAGE_CHANNEL).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={keyFilter} onValueChange={(v) => { setKeyFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Aviso: todos</SelectItem>
            {optionsFrom(MESSAGE_TEMPLATE_KEY).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={(row: Message) => { setDetail(row); setRetryTo(row.to_address || ""); }}
        emptyIcon="Mail"
        emptyTitle="Todavía no se ha escrito a nadie"
        emptyDescription="Las confirmaciones, los recordatorios de la víspera y los recibos aparecen aquí en cuanto haya una venta."
        columns={[
          {
            key: "to", header: "Destinatario",
            render: (row: Message) => (
              <div>
                <p className="truncate text-sm font-medium">{row.to_name || row.to_address}</p>
                <p className="truncate text-xs text-muted-foreground">{row.to_address}</p>
              </div>
            ),
          },
          { key: "template_key", header: "Aviso",
            render: (row: Message) => <StatusBadge value={row.template_key} dict={MESSAGE_TEMPLATE_KEY} dot={false} /> },
          { key: "channel", header: "Canal", hideOn: "sm",
            render: (row: Message) => <StatusBadge value={row.channel} dict={MESSAGE_CHANNEL} dot={false} /> },
          {
            key: "when", header: "Cuándo", hideOn: "md",
            render: (row: Message) => (
              <div className="text-xs">
                <p className="tf-num">{formatDateTime(row.sent_at || row.scheduled_at)}</p>
                <p className="text-muted-foreground">{row.sent_at ? "Entregado" : "Programado"}</p>
              </div>
            ),
          },
          {
            key: "status", header: "Estado",
            render: (row: Message) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge value={row.status} dict={MESSAGE_STATUS} />
                {(row.attempts ?? 0) > 1 && <Pill tone="neutral">{row.attempts} intentos</Pill>}
              </div>
            ),
          },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {formatNumber(total)} mensaje{total === 1 ? "" : "s"} · página {page + 1} de {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-base">
              {MESSAGE_TEMPLATE_KEY[detail?.template_key || ""]?.label || "Mensaje"}
            </SheetTitle>
            <SheetDescription>{detail?.to_name || detail?.to_address}</SheetDescription>
          </SheetHeader>

          {detail && (
            <div className="space-y-4 px-4 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={detail.status} dict={MESSAGE_STATUS} />
                <StatusBadge value={detail.channel} dict={MESSAGE_CHANNEL} dot={false} />
                {detail.language && <Pill tone="neutral">{detail.language}</Pill>}
              </div>

              {detail.last_error && (
                <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  {detail.last_error}
                </p>
              )}

              <section className="tf-card divide-y divide-border">
                <Row label="Para" value={detail.to_address || "—"} />
                <Row label="Programado" value={formatDateTime(detail.scheduled_at)} />
                <Row label="Entregado" value={detail.sent_at ? formatDateTime(detail.sent_at) : "Todavía no"} />
                <Row label="Intentos" value={String(detail.attempts ?? 0)} />
                {detail.provider && <Row label="Proveedor" value={detail.provider} />}
                {detail.provider_message_id && <Row label="Referencia" value={detail.provider_message_id} mono />}
                {typeof detail.booking === "object" && detail.booking && (
                  <Row label="Reserva" value={detail.booking.booking_number || "—"} mono />
                )}
                {typeof detail.quote === "object" && detail.quote && (
                  <Row label="Cotización" value={detail.quote.code || "—"} mono />
                )}
              </section>

              {/* El texto tal y como salió: es lo que hay que poder enseñarle al
                  cliente cuando dice que no le llegó o que decía otra cosa. */}
              <section className="tf-card space-y-2 p-4">
                {detail.subject && <p className="text-sm font-semibold">{detail.subject}</p>}
                <p className="whitespace-pre-line text-sm text-muted-foreground">{detail.body}</p>
              </section>

              {detail.status !== "sent" && (
                <section className="space-y-2">
                  <label htmlFor="retry-to" className="text-[12px] font-semibold">
                    Reintentar hacia
                  </label>
                  <Input id="retry-to" value={retryTo} onChange={(e) => setRetryTo(e.target.value)}
                    placeholder="correo o teléfono" />
                  <p className="text-[11px] text-muted-foreground">
                    Si el fallo fue por un dato del cliente, corrígelo en su ficha y reintenta:
                    el texto ya está compuesto y no hay que reescribirlo.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => act(detail, "retry")}>
                      <Icon name="RefreshCw" className="size-4" /> Reintentar ahora
                    </Button>
                    {detail.status === "queued" && (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => act(detail, "cancel")}>
                        Cancelar envío
                      </Button>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm ${mono ? "font-mono text-[12px]" : ""}`}>{value}</span>
    </div>
  );
}
