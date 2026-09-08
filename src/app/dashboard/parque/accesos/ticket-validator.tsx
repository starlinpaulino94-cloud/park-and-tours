"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TICKET_STATUS, TICKET_TYPE } from "@/lib/labels-modules";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  BLOCK_MESSAGE, FORCEABLE_BLOCKS, redeemBlocker, remainingEntries, type RedeemableTicket,
} from "@/lib/tickets";

export interface AccessTicket extends RedeemableTicket {
  _id: string;
  code?: string;
  wristband_code?: string;
  holder_name?: string;
  ticket_type?: string;
  price?: number;
  currency?: string;
  customer?: { first_name?: string; last_name?: string };
  product?: { name?: string };
}

const holderOf = (t: AccessTicket) =>
  t.holder_name
  || [t.customer?.first_name, t.customer?.last_name].filter(Boolean).join(" ").trim()
  || "Sin titular";

/**
 * Validación de pases en puerta.
 *
 * La pantalla prometía que "cada validación en puerta descuenta de aquí", pero
 * lo único que había era el formulario de alta: para registrar una entrada había
 * que editar `entries_used` a mano, y eso mismo permitía bajarlo otra vez. El
 * consumo ahora pasa por `POST /api/tickets/:id/redeem`, que decide el estado
 * resultante, rechaza lo que no se puede validar y lo deja auditado.
 *
 * El flujo es el del torniquete: se teclea o escanea el código, se ve de quién
 * es el pase y cuántas entradas le quedan, y se confirma. Un pase vencido se
 * puede forzar con rango de gestión y motivo; uno anulado, transferido o agotado
 * no, porque ahí no hay excepción que valga.
 */
export function TicketValidator({ onRedeemed }: { onRedeemed: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [ticket, setTicket] = useState<AccessTicket | null>(null);
  const [matches, setMatches] = useState<AccessTicket[]>([]);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setCode(""); setTicket(null); setMatches([]); setReason("");
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else reset();
  }, [open, reset]);

  const search = async () => {
    const term = code.trim();
    if (!term) return;
    setSearching(true);
    setTicket(null);
    setMatches([]);
    const res = await api.get<AccessTicket[]>(
      `/api/erp/access_ticket?q=${encodeURIComponent(term)}&limit=10&includeTotal=false`
    );
    setSearching(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo buscar el pase");
      return;
    }
    const found = res.data || [];
    // Un escaneo tiene que resolver a un pase exacto; si el término coincide
    // con varios (buscó por titular), se elige de la lista.
    const exact = found.filter(
      (t) => t.code?.toLowerCase() === term.toLowerCase() || t.wristband_code?.toLowerCase() === term.toLowerCase()
    );
    if (exact.length === 1) { setTicket(exact[0]); return; }
    if (found.length === 1) { setTicket(found[0]); return; }
    if (found.length === 0) { toast.error(`Ningún pase coincide con "${term}"`); return; }
    setMatches(found);
  };

  const redeem = async (force: boolean) => {
    if (!ticket) return;
    setWorking(true);
    const res = await api.post<{ status: string; remaining: number | null; forced: boolean }>(
      `/api/tickets/${ticket._id}/redeem`,
      force ? { force: true, reason } : {}
    );
    setWorking(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo validar el pase");
      return;
    }
    const left = res.data?.remaining;
    toast.success(
      left === null ? `Entrada registrada — pase sin límite de entradas`
        : `Entrada registrada — quedan ${formatNumber(left ?? 0)}`
    );
    onRedeemed();
    reset();
    inputRef.current?.focus();
  };

  const blocker = ticket ? redeemBlocker(ticket) : null;
  const forceable = blocker ? FORCEABLE_BLOCKS.has(blocker) : false;
  const remaining = ticket ? remainingEntries(ticket) : null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Icon name="ScanLine" className="size-4" /> Validar pase
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Validar pase en puerta</DialogTitle>
            <DialogDescription>
              Teclea o escanea el código del pase o de la pulsera. Cada validación descuenta una entrada.
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); search(); }}
          >
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Código del pase o de la pulsera"
              className="tf-num"
              autoComplete="off"
            />
            <Button type="submit" disabled={searching || !code.trim()}>
              {searching ? "Buscando…" : "Buscar"}
            </Button>
          </form>

          {matches.length > 0 && (
            <div className="space-y-1 rounded-lg border p-2">
              <p className="px-1 text-xs text-muted-foreground">
                {matches.length} pases coinciden. Elige el correcto:
              </p>
              {matches.map((m) => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => { setTicket(m); setMatches([]); }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="tf-num font-semibold">{m.code || m.wristband_code}</span>
                  <span className="truncate text-xs text-muted-foreground">{holderOf(m)}</span>
                  <StatusBadge value={m.status} dict={TICKET_STATUS} />
                </button>
              ))}
            </div>
          )}

          {ticket && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tf-num text-lg font-semibold">{ticket.code || ticket.wristband_code}</p>
                  <p className="truncate text-sm text-muted-foreground">{holderOf(ticket)}</p>
                  {ticket.product?.name && (
                    <p className="truncate text-xs text-muted-foreground">{ticket.product.name}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge value={ticket.status} dict={TICKET_STATUS} />
                  <StatusBadge value={ticket.ticket_type} dict={TICKET_TYPE} dot={false} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Entradas restantes</p>
                  <p className="tf-num text-base font-semibold">
                    {remaining === null ? "Ilimitadas" : formatNumber(remaining)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vigencia</p>
                  <p className="tf-num">
                    {ticket.valid_to ? `hasta ${formatDateTime(ticket.valid_to)}` : "sin vencimiento"}
                  </p>
                </div>
              </div>

              {blocker ? (
                <div className="space-y-2">
                  <Pill tone="danger">
                    <Icon name="Ban" className="size-3" /> {BLOCK_MESSAGE[blocker]}
                  </Pill>
                  {forceable ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="force-reason" className="text-xs">
                        Motivo para forzar la validación (requiere rango de gerencia)
                      </Label>
                      <Input
                        id="force-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Ej.: cortesía autorizada por gerencia"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Este bloqueo no se puede forzar. Emite un pase nuevo si procede.
                    </p>
                  )}
                </div>
              ) : (
                <Pill tone="success">
                  <Icon name="CircleCheck" className="size-3" /> Pase vigente
                </Pill>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
            {ticket && (blocker ? forceable : true) && (
              <Button
                onClick={() => redeem(Boolean(blocker))}
                disabled={working || (Boolean(blocker) && !reason.trim())}
              >
                {working ? "Registrando…" : blocker ? "Forzar y registrar entrada" : "Registrar entrada"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
