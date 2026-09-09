"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DELIVERY_CHANNEL, GIFT_CARD_STATUS } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { giftCardBalance, isGiftCardClosed, isGiftCardExpired } from "@/lib/gift-cards";
import { GiftCardDrawer, type GiftCard } from "./gift-card-drawer";

const EMPTY = {
  amount: "", currency: "usd", recipient_name: "", recipient_email: "",
  expires_at: "", delivery_channel: "email", message: "",
};

export default function GiftCardsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [working, setWorking] = useState(false);

  const reload = () => setReloadKey((k) => k + 1);

  const issue = async () => {
    setWorking(true);
    const res = await api.post<{ code: string }>("/api/gift-cards", {
      amount: Number(form.amount),
      currency: form.currency,
      recipient_name: form.recipient_name || undefined,
      recipient_email: form.recipient_email || undefined,
      expires_at: form.expires_at || undefined,
      delivery_channel: form.delivery_channel,
      message: form.message || undefined,
    });
    setWorking(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo emitir la gift card");
      return;
    }
    toast.success(`Gift card ${res.data?.code} emitida`);
    setIssuing(false);
    setForm(EMPTY);
    reload();
  };

  return (
    <>
      <ResourcePage
        key={reloadKey}
        resource="gift_card"
        eyebrow="Clientes"
        title="Gift cards"
        description="Tarjetas de regalo con su saldo vigente. Emitir, consumir, devolver y anular pasan por su acción, y cada movimiento queda registrado."
        searchPlaceholder="Buscar por código, destinatario o correo…"
        emptyIcon="Gift"
        emptyTitle="Sin gift cards emitidas"
        emptyDescription="Emite una tarjeta para que el saldo nazca con su movimiento de emisión."
        initialSort="-issued_at"
        // El alta pasa por `/api/gift-cards`, que es donde nace el saldo: el
        // formulario genérico ya no puede inventarlo.
        canWrite={false}
        extraActions={
          <Button onClick={() => setIssuing(true)}>
            <Icon name="Gift" className="size-4" /> Emitir gift card
          </Button>
        }
        onRowClick={(row: GiftCard) => setOpenId(row._id)}
        filters={[{ name: "status", label: "Estado", options: optionsFrom(GIFT_CARD_STATUS) }]}
        renderSummary={(rows: GiftCard[], total) => {
          const live = rows.filter((c) => !isGiftCardClosed(c) && !isGiftCardExpired(c));
          const outstanding = live.reduce((sum, c) => sum + giftCardBalance(c), 0);
          const currency = live[0]?.currency || rows[0]?.currency || "usd";
          const mixed = new Set(live.map((c) => c.currency || "usd")).size > 1;
          return (
            <p className="text-xs text-muted-foreground">
              {formatNumber(total)} tarjetas ·{" "}
              <span className="font-semibold">
                {mixed ? "saldo vivo en varias monedas" : `${formatMoney(outstanding, currency)} de saldo vivo`}
              </span>{" "}
              en {formatNumber(live.length)} activas (en esta página)
            </p>
          );
        }}
        columns={[
          {
            key: "code", header: "Tarjeta",
            render: (c: GiftCard) => (
              <div>
                <p className="tf-num font-semibold">{c.code || "—"}</p>
                <p className="text-xs text-muted-foreground">{c.recipient_name || c.recipient_email || "Sin destinatario"}</p>
              </div>
            ),
          },
          { key: "initial", header: "Emitida", align: "right", hideOn: "md",
            render: (c: GiftCard) => formatMoney(c.initial_amount ?? 0, c.currency || "usd") },
          { key: "balance", header: "Saldo", align: "right",
            render: (c: GiftCard) => {
              const balance = giftCardBalance(c);
              return (
                <span className={balance > 0 && !isGiftCardClosed(c) ? "tf-num font-semibold" : "tf-num text-muted-foreground"}>
                  {formatMoney(balance, c.currency || "usd")}
                </span>
              );
            } },
          { key: "real", header: "Vigencia", hideOn: "md",
            render: (c: GiftCard) =>
              isGiftCardClosed(c) ? <Pill tone="neutral">Cerrada</Pill>
                : isGiftCardExpired(c) ? <Pill tone="danger">Vencida</Pill>
                : <Pill tone="success">Vigente</Pill> },
          { key: "expires", header: "Vence", hideOn: "lg",
            render: (c: GiftCard) => <span className="tf-num text-xs">{c.expires_at ? formatDate(c.expires_at) : "—"}</span> },
          { key: "status", header: "Estado", render: (c: GiftCard) => <StatusBadge value={c.status} dict={GIFT_CARD_STATUS} /> },
        ]}
        fields={[]}
      />

      <GiftCardDrawer cardId={openId} onClose={() => setOpenId(null)} onChanged={reload} />

      <Dialog open={issuing} onOpenChange={(o) => { if (!o) { setIssuing(false); setForm(EMPTY); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Emitir gift card</DialogTitle>
            <DialogDescription>
              El saldo nace igual al importe emitido y queda registrado como movimiento de emisión.
              El código se genera solo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-amount">Importe</Label>
              <Input id="gc-new-amount" type="number" min="0" step="0.01" className="tf-num"
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-currency">Moneda</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger id="gc-new-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-name">Destinatario</Label>
              <Input id="gc-new-name" value={form.recipient_name}
                onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-email">Correo</Label>
              <Input id="gc-new-email" type="email" value={form.recipient_email}
                onChange={(e) => setForm({ ...form, recipient_email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-expires">Vence</Label>
              <Input id="gc-new-expires" type="date" value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-new-channel">Entrega</Label>
              <Select value={form.delivery_channel} onValueChange={(v) => setForm({ ...form, delivery_channel: v })}>
                <SelectTrigger id="gc-new-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(DELIVERY_CHANNEL).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="gc-new-message">Mensaje</Label>
              <Input id="gc-new-message" value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIssuing(false); setForm(EMPTY); }}>Cancelar</Button>
            <Button onClick={issue} disabled={working || !(Number(form.amount) > 0)}>
              {working ? "Emitiendo…" : "Emitir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
