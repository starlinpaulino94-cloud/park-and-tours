"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ACTIVITY_TYPE, LEAD_SOURCE, LEAD_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";

export interface CrmActivity {
  _id: string; activity_type?: string; subject?: string; notes?: string;
  due_at?: string; done_at?: string; status?: string; user?: any; createdAt?: string;
}
export interface Lead {
  _id: string; name?: string; email?: string; phone?: string; whatsapp?: string;
  source?: string; status?: string; estimated_value?: number; currency?: string;
  pax?: number; travel_date?: string; next_action_at?: string;
  lost_reason?: string; notes?: string;
  customer?: any; seller?: any; product?: any; partner?: any;
  crm_activity?: CrmActivity[];
}

export const overdueAction = (l: Lead) =>
  Boolean(l.next_action_at && new Date(l.next_action_at).getTime() < Date.now());

const ICON_BY_TYPE: Record<string, string> = {
  call: "Phone", whatsapp: "MessageCircle", email: "Mail", sms: "MessageSquare",
  note: "StickyNote", task: "SquareCheck", meeting: "Users",
};

const EMPTY_FORM = { activity_type: "call", subject: "", notes: "", due_at: "" };

/**
 * Detalle del lead con su bitácora.
 *
 * `crm_activity` ya venía expandida por el recurso `lead` y ninguna pantalla la
 * usaba: el CRM prometía "actividades y seguimiento" y solo ofrecía una ficha.
 * Aquí se cierra el ciclo — registrar el contacto, cerrarlo y dejar agendada la
 * próxima acción, que es de donde sale la cola de trabajo del vendedor.
 */
export function LeadDrawer({
  leadId, onClose, onChanged,
}: {
  leadId: string | null;
  onClose: () => void;
  /** Se llama cuando cambia algo que el listado debe reflejar. */
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    const res = await api.get<Lead>(`/api/erp/lead/${leadId}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[crm] error cargando el lead:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el lead");
      return;
    }
    setLead(res.data || null);
  }, [leadId]);

  useEffect(() => {
    if (!leadId) { setLead(null); setForm(EMPTY_FORM); return; }
    void load();
  }, [leadId, load]);

  const activities = (lead?.crm_activity || []).slice().sort((a, b) => {
    const av = a.due_at || a.done_at || a.createdAt || "";
    const bv = b.due_at || b.done_at || b.createdAt || "";
    return bv.localeCompare(av);
  });
  const pending = activities.filter((a) => a.status === "pending");

  const logActivity = async () => {
    if (!lead) return;
    if (!form.subject.trim()) { toast.error("Describe brevemente el contacto"); return; }
    setBusy(true);

    // Con fecha futura es un compromiso pendiente; sin fecha es un contacto ya
    // ocurrido, así que se registra como hecho en el momento.
    const scheduled = Boolean(form.due_at);
    const res = await api.post("/api/erp/crm_activity", {
      lead: lead._id,
      customer: typeof lead.customer === "object" && lead.customer ? lead.customer._id : lead.customer || null,
      activity_type: form.activity_type,
      subject: form.subject.trim(),
      notes: form.notes.trim() || null,
      due_at: form.due_at || null,
      done_at: scheduled ? null : new Date().toISOString(),
      status: scheduled ? "pending" : "done",
    });
    if (!res.ok) {
      setBusy(false);
      console.error("[crm] error registrando la actividad:", res.error);
      toast.error(res.error?.message || "No se pudo registrar la actividad");
      return;
    }

    // Agendar mueve también la próxima acción del lead: es el campo del que se
    // alimenta la cola de seguimiento, y dejarlo desincronizado la vacía.
    if (scheduled) {
      const upd = await api.put(`/api/erp/lead/${lead._id}`, { next_action_at: form.due_at });
      if (!upd.ok) console.error("[crm] no se pudo actualizar la próxima acción:", upd.error);
    }

    setBusy(false);
    setForm(EMPTY_FORM);
    toast.success(scheduled ? "Actividad agendada" : "Contacto registrado");
    await load();
    onChanged();
  };

  const completeActivity = async (activity: CrmActivity) => {
    setBusy(true);
    const res = await api.put(`/api/erp/crm_activity/${activity._id}`, {
      status: "done", done_at: new Date().toISOString(),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cerrar la actividad");
      return;
    }
    toast.success("Actividad completada");
    await load();
    onChanged();
  };

  const contact = [lead?.email, lead?.phone, lead?.whatsapp].filter(Boolean).join(" · ");

  return (
    <Sheet open={!!leadId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{lead?.name || "Lead"}</SheetTitle>
          <SheetDescription>{contact || "Sin datos de contacto"}</SheetDescription>
        </SheetHeader>

        {lead && (
          <div className="space-y-5 px-4 pb-8">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={lead.status} dict={LEAD_STATUS} />
              {lead.source && <StatusBadge value={lead.source} dict={LEAD_SOURCE} dot={false} />}
              {overdueAction(lead) && <Pill tone="danger">Seguimiento vencido</Pill>}
              {loading && <Icon name="LoaderCircle" className="size-4 animate-spin text-muted-foreground" />}
            </div>

            <section className="tf-card divide-y divide-border">
              <Row label="Próxima acción"
                value={lead.next_action_at ? formatDateTime(lead.next_action_at) : "Sin agendar"}
                tone={overdueAction(lead) ? "danger" : !lead.next_action_at ? "warning" : undefined} />
              <Row label="Valor estimado"
                value={lead.estimated_value != null
                  ? formatMoney(lead.estimated_value, lead.currency || "usd")
                  : "Sin estimar"} />
              <Row label="Pasajeros" value={formatNumber(lead.pax ?? 0)} />
              <Row label="Viaje previsto" value={lead.travel_date ? formatDate(lead.travel_date) : "—"} />
              <Row label="Interés" value={typeof lead.product === "object" && lead.product ? lead.product.name : "—"} />
              <Row label="Vendedor" value={typeof lead.seller === "object" && lead.seller
                ? [lead.seller.first_name, lead.seller.last_name].filter(Boolean).join(" ") : "Sin asignar"} />
              {lead.status === "lost" && <Row label="Motivo de pérdida" value={lead.lost_reason || "Sin registrar"} />}
            </section>

            {lead.notes && (
              <section className="tf-card p-4">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{lead.notes}</p>
              </section>
            )}

            {/* ---- registrar contacto o agendar seguimiento ---------------- */}
            <section className="tf-card space-y-3 p-4">
              <h3 className="font-display text-sm font-semibold">Registrar actividad</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={form.activity_type} onValueChange={(v) => setForm((f) => ({ ...f, activity_type: v }))}>
                    <SelectTrigger aria-label="Tipo de actividad"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {optionsFrom(ACTIVITY_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Agendar para (opcional)</Label>
                  <Input type="datetime-local" value={form.due_at}
                    onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Asunto</Label>
                <Input value={form.subject} maxLength={200} placeholder="Llamada de seguimiento, envío de cotización…"
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notas (opcional)</Label>
                <Textarea rows={2} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <p className="text-xs text-muted-foreground">
                {form.due_at
                  ? "Queda pendiente y actualiza la próxima acción del lead."
                  : "Sin fecha se guarda como contacto ya realizado."}
              </p>
              <Button className="w-full gap-1.5" onClick={logActivity} disabled={busy}>
                <Icon name="Plus" className="size-4" aria-hidden />
                {busy ? "Guardando…" : form.due_at ? "Agendar seguimiento" : "Registrar contacto"}
              </Button>
            </section>

            {/* ---- bitácora ------------------------------------------------ */}
            <section className="space-y-2">
              <h3 className="font-display text-sm font-semibold">
                Bitácora {activities.length > 0 && <span className="text-muted-foreground">({activities.length})</span>}
                {pending.length > 0 && <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">· {pending.length} pendiente{pending.length === 1 ? "" : "s"}</span>}
              </h3>
              {activities.length === 0 ? (
                <p className="tf-card px-4 py-6 text-center text-sm text-muted-foreground">
                  Todavía no hay contactos registrados con este lead.
                </p>
              ) : (
                <ul className="tf-card divide-y divide-border">
                  {activities.map((a) => {
                    const isPending = a.status === "pending";
                    const late = isPending && Boolean(a.due_at && new Date(a.due_at).getTime() < Date.now());
                    return (
                      <li key={a._id} className="flex items-start gap-3 px-4 py-2.5">
                        <span className={cn("mt-0.5 shrink-0", late ? "text-destructive" : "text-muted-foreground")}>
                          <Icon name={ICON_BY_TYPE[a.activity_type || "note"] || "StickyNote"} className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{a.subject || ACTIVITY_TYPE[a.activity_type || ""]?.label || "Actividad"}</p>
                          {a.notes && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{a.notes}</p>}
                          <p className={cn("mt-0.5 text-[11px]", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                            {isPending
                              ? `${late ? "Vencida" : "Pendiente"}${a.due_at ? ` · ${formatDateTime(a.due_at)}` : ""}`
                              : `Hecha${a.done_at ? ` · ${formatDateTime(a.done_at)}` : ""}`}
                            {typeof a.user === "object" && a.user?.name ? ` · ${a.user.name}` : ""}
                          </p>
                        </div>
                        {isPending && (
                          <Button variant="outline" size="sm" className="h-8 shrink-0 px-2"
                            onClick={() => completeActivity(a)} disabled={busy}
                            aria-label={`Marcar como hecha: ${a.subject || "actividad"}`}>
                            <Icon name="Check" className="size-3.5" aria-hidden />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm",
        tone === "danger" && "font-semibold text-destructive",
        tone === "warning" && "font-semibold text-amber-700 dark:text-amber-400")}>
        {value}
      </span>
    </div>
  );
}
