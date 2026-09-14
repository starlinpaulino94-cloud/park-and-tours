"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { optionsFrom } from "@/components/tf/options";
import { QUOTE_STATUS, QUOTE_TYPE, QUOTE_LINE_TYPE } from "@/lib/labels-modules";
import { CHANNEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import {
  optionBreakdown, headerTotals, depositDue, lineGross, lineTotal,
  isExpired, sendBlocker, decideBlocker, convertBlocker, reviseBlocker, BLOCK_MESSAGE,
} from "@/lib/quotes";

/* ------------------------------------------------------------------ tipos */

export interface QuoteLine {
  _id: string;
  description?: string;
  quantity?: number; unit_price?: number; unit_cost?: number;
  discount_percent?: number; line_total?: number;
  line_type?: string; is_optional?: boolean; sort_order?: number;
  service_date?: string;
  adults?: number; children?: number; infants?: number;
  option_id?: string | null; option?: any;
  product?: any; supplier?: any; notes?: string;
}

export interface QuoteOption {
  _id: string;
  name?: string; description?: string; sort_order?: number;
  is_recommended?: boolean; is_selected?: boolean;
  total?: number;
}

export interface Quote {
  _id: string; code?: string; title?: string; status?: string; quote_type?: string;
  version?: number; revision_of?: any; revision_reason?: string; superseded_at?: string;
  issued_at?: string; valid_until?: string; event_date?: string; sent_at?: string;
  decided_at?: string; follow_up_at?: string; sent_count?: number;
  pax?: number; subtotal?: number; discount?: number; tax?: number; tax_percent?: number;
  total?: number; cost_total?: number; margin_amount?: number; margin_percent?: number | null;
  currency?: string;
  deposit_type?: string; deposit_percent?: number; deposit_amount?: number;
  deposit_due_date?: string; balance_due_date?: string;
  contact_name?: string; contact_email?: string; contact_phone?: string; company_name?: string;
  terms?: string; notes?: string; internal_notes?: string;
  inclusions?: string; exclusions?: string; cancellation_policy?: string; payment_terms?: string;
  rejection_reason?: string; accepted_by?: string;
  customer?: any; partner?: any; seller?: any; order?: any; lead?: any;
  quote_line?: QuoteLine[];
  quote_option?: QuoteOption[];
}

const EMPTY_LINE = {
  description: "", quantity: "1", unit_price: "", unit_cost: "", discount_percent: "",
  line_type: "service", is_optional: false, option: "__common",
  adults: "", children: "", infants: "", service_date: "", product: "__none",
};
type LineDraft = typeof EMPTY_LINE;

const personName = (v: any) =>
  !v || typeof v !== "object" ? "" : [v.first_name, v.last_name].filter(Boolean).join(" ") || v.commercial_name || v.name || "";

export const customerName = (q?: Quote | null) => {
  const c = q && typeof q.customer === "object" ? q.customer : null;
  return (c && (personName(c) || c.commercial_name)) || q?.company_name || q?.contact_name || "Sin cliente";
};

const lineOptionId = (l: QuoteLine): string | null =>
  l.option_id ?? (typeof l.option === "object" && l.option ? l.option._id : (l.option as string)) ?? null;

/* ------------------------------------------------------------------ cajón */

/**
 * El documento completo de una cotización.
 *
 * La pantalla anterior enseñaba una cabecera y una lista de líneas sueltas: no
 * había forma de ofrecer alternativas, ni de pedir un anticipo, ni de enviarla,
 * ni de registrar la respuesta del cliente, ni de convertirla en la reserva que
 * se le prometió. Todo eso ocurre aquí, y cada acción pasa por su ruta del
 * servidor, que es la que recalcula el total y deja la huella en auditoría.
 */
export function QuoteDrawer({
  quote, loading, onClose, onChanged, onEdit,
}: {
  quote: Quote | null;
  loading: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (q: Quote) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<LineDraft>(EMPTY_LINE);
  const [editing, setEditing] = useState<string | null>(null);
  const [products, setProducts] = useState<{ value: string; label: string }[]>([]);
  const [dialog, setDialog] = useState<null | "send" | "decide" | "convert" | "revise" | "option">(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [force, setForce] = useState(false);

  const currency = quote?.currency || "usd";
  const lines = useMemo(() => quote?.quote_line ?? [], [quote]);
  const options = useMemo(() => quote?.quote_option ?? [], [quote]);

  // Los totales se recalculan en el servidor, pero también aquí: así el desglose
  // que se está editando responde al instante en vez de esperar una recarga.
  const normalised = useMemo(
    () => lines.map((l) => ({ ...l, option_id: lineOptionId(l) })),
    [lines]
  );
  const breakdown = useMemo(
    () => optionBreakdown(options as any, normalised, quote?.tax_percent),
    [options, normalised, quote?.tax_percent]
  );
  const totals = useMemo(
    () => headerTotals(options as any, normalised, quote?.tax_percent, quote?.tax),
    [options, normalised, quote?.tax_percent, quote?.tax]
  );
  const money = useMemo(() => depositDue(quote || {}, totals.total), [quote, totals.total]);

  useEffect(() => {
    if (!quote) return;
    let cancelled = false;
    api.get<any[]>("/api/erp/product?limit=300&filter.status=active").then((res) => {
      if (cancelled || !res.ok) return;
      setProducts((res.data || []).map((p) => ({ value: p._id, label: p.name })));
    });
    return () => { cancelled = true; };
  }, [quote?._id]);

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: any }>) => {
      setBusy(true);
      const res = await fn();
      setBusy(false);
      if (!res.ok) {
        console.error(`[cotizaciones] ${label}:`, res.error);
        toast.error(res.error?.message || `No se pudo ${label}`);
        return false;
      }
      onChanged();
      return true;
    },
    [onChanged]
  );

  if (!quote) return null;

  const closed = quote.status === "converted" || quote.status === "superseded" ||
    quote.status === "accepted" || quote.status === "rejected" || quote.status === "expired";

  const blockers = {
    send: sendBlocker(quote, normalised),
    decide: decideBlocker(quote),
    convert: convertBlocker(
      quote,
      normalised.map((l) => ({
        product: typeof l.product === "object" ? l.product?._id : l.product,
        option_id: l.option_id, is_optional: l.is_optional,
      })),
      options as any
    ),
    revise: reviseBlocker(quote),
  };

  /* ---------------------------------------------------------- acciones */

  const addLine = async () => {
    const quantity = Number(line.quantity) || 0;
    if (!line.description.trim() && line.product === "__none") {
      toast.error("La línea necesita un concepto o un producto del catálogo");
      return;
    }
    if (quantity <= 0) { toast.error("La cantidad tiene que ser mayor que cero"); return; }
    const okDone = await run("añadir la línea", () =>
      api.post(`/api/quotes/${quote._id}/lines`, {
        description: line.description.trim() || undefined,
        quantity,
        unit_price: Number(line.unit_price) || 0,
        unit_cost: line.unit_cost === "" ? undefined : Number(line.unit_cost) || 0,
        discount_percent: Number(line.discount_percent) || 0,
        line_type: line.line_type,
        is_optional: line.is_optional,
        option: line.option === "__common" ? undefined : line.option,
        adults: line.adults === "" ? undefined : Number(line.adults),
        children: line.children === "" ? undefined : Number(line.children),
        infants: line.infants === "" ? undefined : Number(line.infants),
        service_date: line.service_date || undefined,
        product: line.product === "__none" ? undefined : line.product,
      })
    );
    if (okDone) setLine({ ...EMPTY_LINE, option: line.option, line_type: line.line_type });
  };

  const patchLine = (lineId: string, patch: Record<string, unknown>) =>
    run("guardar la línea", () => api.put(`/api/quotes/${quote._id}/lines/${lineId}`, patch));

  const removeLine = (lineId: string) =>
    run("eliminar la línea", () => api.delete(`/api/quotes/${quote._id}/lines/${lineId}`));

  const patchOption = (optionId: string, patch: Record<string, unknown>) =>
    run("guardar la alternativa", () => api.put(`/api/quotes/${quote._id}/options/${optionId}`, patch));

  const removeOption = (optionId: string) =>
    run("retirar la alternativa", () => api.delete(`/api/quotes/${quote._id}/options/${optionId}`));

  const openDialog = (which: typeof dialog, initial: Record<string, string> = {}) => {
    setForm(initial);
    setForce(false);
    setDialog(which);
  };

  const submitDialog = async () => {
    if (dialog === "send") {
      if (await run("enviar la cotización", () =>
        api.post(`/api/quotes/${quote._id}/send`, { follow_up_at: form.follow_up_at || undefined })
      )) { toast.success("Cotización marcada como enviada"); setDialog(null); }
    } else if (dialog === "decide") {
      if (await run("registrar la respuesta", () =>
        api.post(`/api/quotes/${quote._id}/decide`, {
          decision: form.decision, reason: form.reason, accepted_by: form.accepted_by,
          follow_up_at: form.follow_up_at || undefined, force,
        })
      )) { toast.success("Respuesta registrada"); setDialog(null); }
    } else if (dialog === "convert") {
      setBusy(true);
      const res = await api.post<any>(`/api/quotes/${quote._id}/convert`, { channel: form.channel || "direct" });
      setBusy(false);
      if (!res.ok) { toast.error(res.error?.message || "No se pudo convertir en reserva"); return; }
      const stranded = res.data?.not_carried?.length || 0;
      toast.success(
        `Orden ${res.data?.order?.order_number} creada con ${res.data?.bookings} reserva(s)` +
        (stranded > 0 ? ` · ${stranded} concepto(s) sin producto quedaron anotados en la orden` : "")
      );
      setDialog(null);
      onChanged();
    } else if (dialog === "revise") {
      if (await run("abrir la revisión", () =>
        api.post(`/api/quotes/${quote._id}/revise`, { reason: form.reason, valid_until: form.valid_until || undefined })
      )) { toast.success("Revisión abierta: es la versión viva a partir de ahora"); setDialog(null); onClose(); }
    } else if (dialog === "option") {
      if (await run("añadir la alternativa", () =>
        api.post(`/api/quotes/${quote._id}/options`, { name: form.name, description: form.description })
      )) { setDialog(null); }
    }
  };

  /* ------------------------------------------------------------ pintado */

  const groups: { key: string; title: string; subtitle?: string; option?: QuoteOption; lines: QuoteLine[] }[] = [
    {
      key: "__common",
      title: options.length > 0 ? "Líneas comunes" : "Desglose",
      subtitle: options.length > 0 ? "Entran en el precio de todas las alternativas" : undefined,
      lines: normalised.filter((l) => !l.option_id),
    },
    ...options.map((o) => ({
      key: o._id,
      title: o.name || "Alternativa",
      subtitle: o.description,
      option: o,
      lines: normalised.filter((l) => l.option_id === o._id),
    })),
  ];

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle className="tf-num text-base">
              {quote.code}
              {(quote.version ?? 1) > 1 && <span className="ml-2 text-xs text-muted-foreground">versión {quote.version}</span>}
            </SheetTitle>
            <SheetDescription>{quote.title || customerName(quote)}</SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4 pb-10">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={quote.status} dict={QUOTE_STATUS} />
              <StatusBadge value={quote.quote_type} dict={QUOTE_TYPE} dot={false} />
              {isExpired(quote) && quote.status !== "converted" && <Pill tone="danger">Vencida</Pill>}
              {(quote.sent_count ?? 0) > 1 && <Pill tone="info">{quote.sent_count} envíos</Pill>}
              {loading && <Icon name="LoaderCircle" className="size-4 animate-spin text-muted-foreground" />}
            </div>

            {/* ---- botonera: cada acción dice por qué no se puede ---- */}
            <section className="flex flex-wrap gap-2">
              <ActionButton
                icon="Send" label="Enviar al cliente" blocker={blockers.send && BLOCK_MESSAGE[blockers.send]}
                disabled={busy} onClick={() => openDialog("send")} primary
              />
              <ActionButton
                icon="Mail" label="Registrar respuesta"
                blocker={blockers.decide && blockers.decide !== "expired" ? BLOCK_MESSAGE[blockers.decide] : null}
                disabled={busy} onClick={() => openDialog("decide", { decision: "accepted" })}
              />
              <ActionButton
                icon="ShoppingCart" label="Convertir en reserva"
                blocker={blockers.convert && BLOCK_MESSAGE[blockers.convert]}
                disabled={busy} onClick={() => openDialog("convert", { channel: "direct" })}
              />
              <ActionButton
                icon="Copy" label="Abrir revisión"
                blocker={blockers.revise && BLOCK_MESSAGE[blockers.revise]}
                disabled={busy} onClick={() => openDialog("revise")}
              />
              {/* La propuesta en PDF: el desglose y las alternativas no caben
                  en el cuerpo de un correo, y son lo que decide la venta. */}
              <a href={`/api/quotes/${quote._id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Icon name="Download" className="size-4" /> Descargar PDF
                </Button>
              </a>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => onEdit(quote)}>
                <Icon name="Pencil" className="size-4" /> Editar documento
              </Button>
            </section>

            {/* ---- ficha comercial ---- */}
            <section className="tf-card divide-y divide-border">
              <Row label="Contacto" value={[quote.contact_name, quote.company_name].filter(Boolean).join(" · ") || "—"} />
              <Row label="Correo / teléfono" value={[quote.contact_email, quote.contact_phone].filter(Boolean).join(" · ") || "—"} />
              <Row label="Cliente" value={customerName(quote)} />
              <Row label="Vendedor" value={personName(quote.seller) || "—"} />
              <Row label="Emitida" value={quote.issued_at ? formatDate(quote.issued_at) : "—"} />
              <Row label="Enviada" value={quote.sent_at ? formatDate(quote.sent_at) : "Todavía no"} />
              <Row label="Vigente hasta" value={quote.valid_until ? formatDate(quote.valid_until) : "Sin plazo"} />
              <Row label="Fecha del viaje" value={quote.event_date ? formatDate(quote.event_date) : "—"} />
              <Row label="Pasajeros" value={formatNumber(quote.pax ?? 0)} />
              <Row label="Próximo seguimiento" value={quote.follow_up_at ? formatDate(quote.follow_up_at) : "Sin programar"} />
              {quote.accepted_by && <Row label="Aceptada por" value={quote.accepted_by} />}
              {typeof quote.order === "object" && quote.order && (
                <Row label="Orden generada" value={quote.order.order_number || "—"} mono />
              )}
              {typeof quote.revision_of === "object" && quote.revision_of && (
                <Row label="Revisión de" value={quote.revision_of.code || "—"} mono />
              )}
              {quote.revision_reason && <Row label="Motivo de la revisión" value={quote.revision_reason} />}
            </section>

            {/* ---- dinero ---- */}
            <section className="tf-card divide-y divide-border">
              <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Desglose económico
              </p>
              <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
              <Row label="Descuento" value={`− ${formatMoney(totals.discount, currency)}`} />
              <Row
                label={quote.tax_percent ? `Impuesto (${formatPercent(quote.tax_percent)})` : "Impuesto"}
                value={formatMoney(totals.tax, currency)}
              />
              <Row label="Total" value={formatMoney(totals.total, currency)} strong />
              {quote.deposit_type && quote.deposit_type !== "none" && (
                <>
                  <Row
                    label={`Anticipo${quote.deposit_due_date ? ` · antes del ${formatDate(quote.deposit_due_date)}` : ""}`}
                    value={formatMoney(money.deposit, currency)}
                  />
                  <Row
                    label={`Saldo${quote.balance_due_date ? ` · antes del ${formatDate(quote.balance_due_date)}` : ""}`}
                    value={formatMoney(money.balance, currency)}
                  />
                </>
              )}
              <Row label="Coste estimado" value={formatMoney(totals.cost_total, currency)} />
              <Row
                label="Margen"
                value={totals.margin_percent === null
                  ? "Sin calcular"
                  : `${formatMoney(totals.margin_amount, currency)} · ${formatPercent(totals.margin_percent)}`}
              />
            </section>

            {/* ---- alternativas ---- */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold">
                  Alternativas ({options.length})
                </h3>
                {!closed && (
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={busy}
                    onClick={() => openDialog("option", { name: "", description: "" })}>
                    <Icon name="Plus" className="size-4" /> Añadir alternativa
                  </Button>
                )}
              </div>
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  La propuesta tiene un solo precio. Añade alternativas para ofrecerle al cliente
                  dos o tres versiones —otro hotel, con guía o sin guía— y que escoja una.
                </p>
              ) : (
                <ul className="tf-card divide-y divide-border">
                  {breakdown.map((o) => (
                    <li key={o.option_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {o.name}
                          {o.is_selected && <Pill tone="success">Escogida</Pill>}
                          {o.is_recommended && !o.is_selected && <Pill tone="info">Recomendada</Pill>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(o.total, currency)} · margen{" "}
                          {o.margin_percent === null ? "—" : formatPercent(o.margin_percent)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant={o.is_selected ? "default" : "outline"} size="sm" disabled={busy}
                          onClick={() => patchOption(o.option_id, { is_selected: !o.is_selected })}>
                          {o.is_selected ? "Escogida" : "Marcar escogida"}
                        </Button>
                        {!closed && (
                          <>
                            <Button variant="ghost" size="sm" disabled={busy} aria-label="Recomendar"
                              onClick={() => patchOption(o.option_id, { is_recommended: !o.is_recommended })}>
                              <Icon name="Star" className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" disabled={busy} aria-label="Retirar alternativa"
                              onClick={() => removeOption(o.option_id)}>
                              <Icon name="Trash2" className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- líneas, agrupadas por alternativa ---- */}
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div>
                  <h3 className="font-display text-sm font-semibold">
                    {group.title} ({group.lines.length})
                  </h3>
                  {group.subtitle && <p className="text-xs text-muted-foreground">{group.subtitle}</p>}
                </div>
                {group.lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin líneas todavía.</p>
                ) : (
                  <ul className="tf-card divide-y divide-border">
                    {group.lines.map((l) => (
                      <LineRow
                        key={l._id} line={l} currency={currency} busy={busy} editable={!closed}
                        editing={editing === l._id}
                        onEdit={() => setEditing(editing === l._id ? null : l._id)}
                        onSave={async (patch) => { if (await patchLine(l._id, patch)) setEditing(null); }}
                        onRemove={() => removeLine(l._id)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* ---- alta de línea ---- */}
            {!closed && (
              <section className="tf-card space-y-3 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Añadir línea
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ql-desc">Concepto</Label>
                    <Input id="ql-desc" placeholder="Traslado aeropuerto — hotel (ida y vuelta)"
                      value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ql-product">Producto del catálogo</Label>
                    <Select value={line.product} onValueChange={(v) => setLine({ ...line, product: v })}>
                      <SelectTrigger id="ql-product"><SelectValue placeholder="Sin producto" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sin producto (concepto libre)</SelectItem>
                        {products.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Solo las líneas con producto se convierten en reserva.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ql-type">Tipo de servicio</Label>
                    <Select value={line.line_type} onValueChange={(v) => setLine({ ...line, line_type: v })}>
                      <SelectTrigger id="ql-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {optionsFrom(QUOTE_LINE_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {options.length > 0 && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="ql-option">¿A qué alternativa pertenece?</Label>
                      <Select value={line.option} onValueChange={(v) => setLine({ ...line, option: v })}>
                        <SelectTrigger id="ql-option"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__common">Común a todas</SelectItem>
                          {options.map((o) => <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  <NumberField id="ql-qty" label="Cantidad" value={line.quantity}
                    onChange={(v) => setLine({ ...line, quantity: v })} />
                  <NumberField id="ql-price" label="Precio unitario" value={line.unit_price} step="0.01"
                    onChange={(v) => setLine({ ...line, unit_price: v })} />
                  <NumberField id="ql-cost" label="Coste unitario" value={line.unit_cost} step="0.01"
                    onChange={(v) => setLine({ ...line, unit_cost: v })} help="Lo que paga la empresa: de aquí sale el margen." />
                  <NumberField id="ql-disc" label="Descuento %" value={line.discount_percent} step="0.01"
                    onChange={(v) => setLine({ ...line, discount_percent: v })} />
                </div>

                <div className="grid gap-2 sm:grid-cols-4">
                  <NumberField id="ql-ad" label="Adultos" value={line.adults} onChange={(v) => setLine({ ...line, adults: v })} />
                  <NumberField id="ql-ch" label="Niños" value={line.children} onChange={(v) => setLine({ ...line, children: v })} />
                  <NumberField id="ql-in" label="Bebés" value={line.infants} onChange={(v) => setLine({ ...line, infants: v })} />
                  <div className="space-y-1.5">
                    <Label htmlFor="ql-date">Fecha del servicio</Label>
                    <Input id="ql-date" type="date" value={line.service_date}
                      onChange={(e) => setLine({ ...line, service_date: e.target.value })} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox id="ql-optional" checked={line.is_optional}
                      onCheckedChange={(v) => setLine({ ...line, is_optional: v === true })} />
                    <span>Extra opcional (se ofrece pero no suma al total)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="tf-num text-sm font-semibold">
                      {formatMoney(lineTotal({
                        quantity: Number(line.quantity) || 0,
                        unit_price: Number(line.unit_price) || 0,
                        discount_percent: Number(line.discount_percent) || 0,
                      }), currency)}
                    </span>
                    <Button size="sm" disabled={busy} onClick={addLine}>
                      <Icon name="Plus" className="size-4" /> Añadir
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {/* ---- el documento que lee el cliente ---- */}
            <section className="tf-card space-y-3 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Condiciones de la propuesta
              </p>
              <Block label="Qué incluye" value={quote.inclusions} />
              <Block label="Qué no incluye" value={quote.exclusions} />
              <Block label="Política de cancelación" value={quote.cancellation_policy} />
              <Block label="Forma de pago" value={quote.payment_terms} />
              <Block label="Otras condiciones" value={quote.terms} />
              <Block label="Notas para el cliente" value={quote.notes} />
              <Block label="Notas internas" value={quote.internal_notes} internal />
              {quote.rejection_reason && (
                <p className="text-sm text-rose-700 dark:text-rose-400">
                  <span className="text-muted-foreground">Motivo del rechazo: </span>{quote.rejection_reason}
                </p>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---- diálogos de acción ---- */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog === "send" && "Enviar al cliente"}
              {dialog === "decide" && "Registrar la respuesta del cliente"}
              {dialog === "convert" && "Convertir en reserva"}
              {dialog === "revise" && "Abrir una revisión"}
              {dialog === "option" && "Nueva alternativa"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "send" && `Se enviará por ${formatMoney(totals.total, currency)}, vigente hasta ${quote.valid_until ? formatDate(quote.valid_until) : "—"}.`}
              {dialog === "decide" && "Aceptar compromete a la empresa con este precio; un rechazo necesita motivo."}
              {dialog === "convert" && "Se creará la orden con el precio pactado, no con el del catálogo."}
              {dialog === "revise" && "Copia el documento entero en una versión nueva y deja esta como reemplazada."}
              {dialog === "option" && "Otra versión de la misma propuesta, entre las que el cliente escoge."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {dialog === "send" && (
              <DateField id="d-follow" label="Próximo seguimiento" value={form.follow_up_at}
                onChange={(v) => setForm({ ...form, follow_up_at: v })} />
            )}

            {dialog === "decide" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="d-decision">Respuesta</Label>
                  <Select value={form.decision} onValueChange={(v) => setForm({ ...form, decision: v })}>
                    <SelectTrigger id="d-decision"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accepted">Aceptada</SelectItem>
                      <SelectItem value="negotiating">En negociación</SelectItem>
                      <SelectItem value="rejected">Rechazada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.decision === "accepted" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="d-by">Quién aceptó</Label>
                    <Input id="d-by" placeholder="Nombre de quien confirmó del lado del cliente"
                      value={form.accepted_by || ""} onChange={(e) => setForm({ ...form, accepted_by: e.target.value })} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="d-reason">
                    Motivo {form.decision === "rejected" && <span className="text-destructive">*</span>}
                  </Label>
                  <Textarea id="d-reason" rows={2}
                    placeholder={form.decision === "rejected" ? "Precio, fechas, se fue con otro operador…" : "Opcional"}
                    value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
                {blockers.decide === "expired" && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                    <Checkbox id="d-force" checked={force} onCheckedChange={(v) => setForce(v === true)} />
                    <span>
                      La propuesta venció el {formatDate(quote.valid_until)}. Mantener el precio es una
                      excepción: necesita rango de gestión, motivo, y queda auditada.
                    </span>
                  </label>
                )}
              </>
            )}

            {dialog === "convert" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="d-channel">Canal de venta</Label>
                  <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                    <SelectTrigger id="d-channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {optionsFrom(CHANNEL).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  Se reservará {formatMoney(totals.total, currency)}
                  {totals.option_id ? ` de la alternativa escogida` : ""}. Las líneas sin producto del
                  catálogo no se pueden reservar y quedarán anotadas en la orden.
                </p>
              </>
            )}

            {dialog === "revise" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="d-rev-reason">Qué cambia en esta ronda</Label>
                  <Textarea id="d-rev-reason" rows={2} placeholder="El cliente pidió bajar a 3 noches y quitar el almuerzo"
                    value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
                <DateField id="d-rev-valid" label="Nueva vigencia" value={form.valid_until}
                  onChange={(v) => setForm({ ...form, valid_until: v })} />
              </>
            )}

            {dialog === "option" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="d-opt-name">Nombre</Label>
                  <Input id="d-opt-name" placeholder="Hotel 5* todo incluido"
                    value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="d-opt-desc">Descripción</Label>
                  <Textarea id="d-opt-desc" rows={2}
                    value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button onClick={submitDialog} disabled={busy}>{busy ? "Guardando…" : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------ auxiliares */

function ActionButton({
  icon, label, blocker, disabled, onClick, primary,
}: {
  icon: string; label: string; blocker: string | null | false;
  disabled: boolean; onClick: () => void; primary?: boolean;
}) {
  return (
    <Button
      variant={primary && !blocker ? "default" : "outline"}
      size="sm"
      className="gap-1.5"
      disabled={disabled || Boolean(blocker)}
      title={blocker || undefined}
      onClick={onClick}
    >
      <Icon name={icon as never} className="size-4" /> {label}
    </Button>
  );
}

function LineRow({
  line, currency, busy, editable, editing, onEdit, onSave, onRemove,
}: {
  line: QuoteLine; currency: string; busy: boolean; editable: boolean; editing: boolean;
  onEdit: () => void; onSave: (patch: Record<string, unknown>) => void; onRemove: () => void;
}) {
  const [draft, setDraft] = useState({
    description: line.description || "",
    quantity: String(line.quantity ?? 1),
    unit_price: String(line.unit_price ?? 0),
    unit_cost: line.unit_cost === null || line.unit_cost === undefined ? "" : String(line.unit_cost),
    discount_percent: String(line.discount_percent ?? 0),
  });

  if (editing) {
    return (
      <li className="space-y-2 px-4 py-3">
        <Input value={draft.description} placeholder="Concepto"
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <div className="grid gap-2 sm:grid-cols-4">
          <NumberField id={`e-q-${line._id}`} label="Cantidad" value={draft.quantity}
            onChange={(v) => setDraft({ ...draft, quantity: v })} />
          <NumberField id={`e-p-${line._id}`} label="Precio" value={draft.unit_price} step="0.01"
            onChange={(v) => setDraft({ ...draft, unit_price: v })} />
          <NumberField id={`e-c-${line._id}`} label="Coste" value={draft.unit_cost} step="0.01"
            onChange={(v) => setDraft({ ...draft, unit_cost: v })} />
          <NumberField id={`e-d-${line._id}`} label="% dto." value={draft.discount_percent} step="0.01"
            onChange={(v) => setDraft({ ...draft, discount_percent: v })} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>Cancelar</Button>
          <Button size="sm" disabled={busy} onClick={() => onSave({
            description: draft.description,
            quantity: Number(draft.quantity) || 0,
            unit_price: Number(draft.unit_price) || 0,
            unit_cost: draft.unit_cost === "" ? null : Number(draft.unit_cost) || 0,
            discount_percent: Number(draft.discount_percent) || 0,
          })}>Guardar</Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">
            {line.description || (typeof line.product === "object" && line.product ? line.product.name : "Línea")}
          </span>
          {line.line_type && <StatusBadge value={line.line_type} dict={QUOTE_LINE_TYPE} dot={false} />}
          {line.is_optional && <Pill tone="warning">Opcional</Pill>}
          {typeof line.product === "object" && line.product && <Pill tone="info">Reservable</Pill>}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatNumber(line.quantity ?? 0)} × {formatMoney(line.unit_price ?? 0, currency)}
          {line.discount_percent ? ` · −${formatPercent(line.discount_percent)}` : ""}
          {line.unit_cost ? ` · coste ${formatMoney(line.unit_cost, currency)}` : ""}
          {line.service_date ? ` · ${formatDate(line.service_date)}` : ""}
          {(line.adults || line.children || line.infants)
            ? ` · ${line.adults || 0}A ${line.children || 0}N ${line.infants || 0}B` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={`tf-num font-semibold ${line.is_optional ? "text-muted-foreground" : ""}`}>
          {formatMoney(line.is_optional ? lineGross(line) : (line.line_total ?? 0), currency)}
        </span>
        {editable && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} aria-label="Editar línea" onClick={onEdit}>
              <Icon name="Pencil" className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} aria-label="Eliminar línea" onClick={onRemove}>
              <Icon name="Trash2" className="size-4" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function NumberField({
  id, label, value, onChange, step = "1", help,
}: { id: string; label: string; value: string; onChange: (v: string) => void; step?: string; help?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12px]">{label}</Label>
      <Input id={id} type="number" min="0" step={step} className="tf-num"
        value={value} onChange={(e) => onChange(e.target.value)} />
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={`tf-num text-right text-sm ${strong ? "text-base font-semibold" : ""} ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Block({ label, value, internal }: { label: string; value?: string; internal?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[12px] font-semibold text-muted-foreground">
        {label}{internal && <span className="ml-1 font-normal">(no sale en el documento del cliente)</span>}
      </p>
      <p className="whitespace-pre-line text-sm">{value}</p>
    </div>
  );
}
