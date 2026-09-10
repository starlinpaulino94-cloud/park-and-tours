"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GIFT_CARD_STATUS, GIFT_MOVEMENT_TYPE } from "@/lib/labels-modules";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  giftCardBalance, giftCardBlocker, isGiftCardClosed, GIFT_CARD_BLOCK_MESSAGE,
} from "@/lib/gift-cards";

export interface GiftCardMovement {
  _id: string;
  movement_type?: string;
  amount?: number;
  balance_after?: number;
  moved_at?: string;
  notes?: string;
  user?: { name?: string } | string;
}

export interface GiftCard {
  _id: string;
  code?: string;
  status?: string;
  initial_amount?: number;
  balance?: number;
  currency?: string;
  issued_at?: string;
  expires_at?: string;
  recipient_name?: string;
  recipient_email?: string;
  message?: string;
  customer?: { first_name?: string; last_name?: string } | string;
  gift_card_movement?: GiftCardMovement[];
}

type Action = "redeem" | "refund" | "void";

const ACTION_LABEL: Record<Action, string> = {
  redeem: "Consumir saldo",
  refund: "Devolver saldo",
  void: "Anular tarjeta",
};

/**
 * Detalle de una gift card con su libro de movimientos.
 *
 * `gift_card_movement` existe desde la primera migración y nadie la escribía ni
 * la leía: la pantalla prometía "cada redención queda registrada como
 * movimiento" y solo mostraba un saldo que se editaba a mano. Aquí se cierra el
 * ciclo — consumir, devolver y anular pasan por su acción, y el historial
 * explica de dónde sale cada centavo del saldo actual.
 */
export function GiftCardDrawer({
  cardId, onClose, onChanged,
}: {
  cardId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<GiftCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    const res = await api.get<GiftCard>(`/api/erp/gift_card/${cardId}`);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo cargar la gift card");
      return;
    }
    setCard(res.data || null);
  }, [cardId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setAction(null); setAmount(""); setReason(""); }, [cardId]);

  const submit = async () => {
    if (!card || !action) return;
    const payload = action === "void"
      ? { reason }
      : action === "refund"
        ? { amount: Number(amount), reason }
        : { amount: Number(amount), notes: reason || undefined };

    setWorking(true);
    const res = await api.post(`/api/gift-cards/${card._id}/${action}`, payload);
    setWorking(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo aplicar el movimiento");
      return;
    }
    toast.success(ACTION_LABEL[action] + ": listo");
    setAction(null); setAmount(""); setReason("");
    await load();
    onChanged();
  };

  const balance = card ? giftCardBalance(card) : 0;
  const blocker = card ? giftCardBlocker(card) : null;
  const closed = card ? isGiftCardClosed(card) : false;
  const needsReason = action === "refund" || action === "void";
  const canSubmit = action === "void"
    ? reason.trim().length > 0
    : Number(amount) > 0 && (!needsReason || reason.trim().length > 0);

  return (
    <Sheet open={Boolean(cardId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="tf-num">{card?.code || "Gift card"}</SheetTitle>
          <SheetDescription>
            {card?.recipient_name || "Sin destinatario"}
            {card?.recipient_email ? ` · ${card.recipient_email}` : ""}
          </SheetDescription>
        </SheetHeader>

        {loading && !card && <p className="py-6 text-sm text-muted-foreground">Cargando…</p>}

        {card && (
          <div className="space-y-5 py-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Saldo disponible</p>
                  <p className="tf-num text-2xl font-semibold">{formatMoney(balance, card.currency || "usd")}</p>
                  <p className="text-xs text-muted-foreground">
                    Emitida por {formatMoney(card.initial_amount ?? 0, card.currency || "usd")}
                    {card.issued_at ? ` · ${formatDateTime(card.issued_at)}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge value={card.status} dict={GIFT_CARD_STATUS} />
                  {blocker
                    ? <Pill tone="danger"><Icon name="Ban" className="size-3" /> {GIFT_CARD_BLOCK_MESSAGE[blocker]}</Pill>
                    : <Pill tone="success"><Icon name="CircleCheck" className="size-3" /> Utilizable</Pill>}
                </div>
              </div>
              {card.expires_at && (
                <p className="mt-2 tf-num text-xs text-muted-foreground">Vence {formatDateTime(card.expires_at)}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={action === "redeem" ? "default" : "outline"}
                disabled={Boolean(blocker)}
                title={blocker ? GIFT_CARD_BLOCK_MESSAGE[blocker] : undefined}
                onClick={() => setAction(action === "redeem" ? null : "redeem")}>
                <Icon name="ScanLine" className="size-4" /> Consumir
              </Button>
              <Button size="sm" variant={action === "refund" ? "default" : "outline"}
                onClick={() => setAction(action === "refund" ? null : "refund")}>
                <Icon name="Undo2" className="size-4" /> Devolver
              </Button>
              <Button size="sm" variant={action === "void" ? "destructive" : "outline"}
                disabled={closed}
                title={closed ? "Esta gift card ya está cerrada" : undefined}
                onClick={() => setAction(action === "void" ? null : "void")}>
                <Icon name="Ban" className="size-4" /> Anular
              </Button>
            </div>

            {action && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-semibold">{ACTION_LABEL[action]}</p>
                {action !== "void" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="gc-amount" className="text-xs">
                      Importe en {(card.currency || "usd").toUpperCase()}
                      {action === "redeem" && ` (disponible ${balance})`}
                    </Label>
                    <Input id="gc-amount" type="number" min="0" step="0.01" className="tf-num"
                      value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="gc-reason" className="text-xs">
                    {needsReason ? "Motivo (obligatorio)" : "Nota (opcional)"}
                  </Label>
                  <Input id="gc-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder={action === "void" ? "Ej.: emitida por error" : "Ej.: pago de la orden ORD-2606-…"} />
                </div>
                {action === "void" && balance > 0 && (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Se extinguirá un saldo de {formatMoney(balance, card.currency || "usd")}.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAction(null)}>Cancelar</Button>
                  <Button size="sm" variant={action === "void" ? "destructive" : "default"}
                    disabled={working || !canSubmit} onClick={submit}>
                    {working ? "Aplicando…" : ACTION_LABEL[action]}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold">Movimientos</p>
              {(card.gift_card_movement || []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin movimientos registrados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(card.gift_card_movement || []).map((m) => (
                    <li key={m._id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <StatusBadge value={m.movement_type} dict={GIFT_MOVEMENT_TYPE} dot={false} />
                        {m.notes && <p className="mt-1 truncate text-muted-foreground">{m.notes}</p>}
                        <p className="tf-num text-muted-foreground">{formatDateTime(m.moved_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`tf-num font-semibold ${(m.amount ?? 0) < 0 ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                          {(m.amount ?? 0) < 0 ? "+" : "−"}{formatMoney(Math.abs(m.amount ?? 0), card.currency || "usd")}
                        </p>
                        <p className="tf-num text-muted-foreground">
                          saldo {formatMoney(m.balance_after ?? 0, card.currency || "usd")}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
