"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/tf/status-badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatMoney } from "@/lib/format";

/**
 * La revisión del descuadre.
 *
 * Un arqueo que no cuadra no lo cierra quien lo contó: lo mira otra persona y
 * decide. Aprobar acepta la diferencia y la manda a la contabilidad —el
 * faltante es una pérdida, el sobrante un ingreso—; devolver para recuento
 * reabre la caja y borra el conteo, porque un arqueo que no se puede repetir
 * obliga a aceptar el primero.
 */
export interface ReviewSession {
  _id: string;
  code?: string;
  currency?: string;
  closed_at?: string;
  difference?: number;
  difference_reason?: string;
  difference_by_currency?: Record<string, number>;
  user?: { name?: string; email?: string } | string;
  closed_by?: { name?: string; email?: string } | string;
}

const nameOf = (value: unknown): string => {
  if (!value || typeof value !== "object") return "—";
  const person = value as { name?: string; email?: string };
  return person.name || person.email || "—";
};

export function RevisionDialog({
  session, open, onOpenChange, onResolved,
}: {
  session: ReviewSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNotes("");
    setReason(session?.difference_reason || "");
  }, [open, session]);

  const resolve = async (decision: "approve" | "recount") => {
    if (!session) return;
    setBusy(true);
    const res = await api.post(`/api/cash/sessions/${session._id}/review`, {
      decision,
      approval_notes: notes || undefined,
      difference_reason: reason || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[arqueo] no se pudo resolver la revisión:", res.error);
      toast.error(res.error?.message || "No se pudo registrar la revisión");
      return;
    }
    toast.success(decision === "approve" ? "Arqueo conciliado" : "Caja reabierta para recuento");
    onOpenChange(false);
    onResolved();
  };

  const differences = Object.entries(session?.difference_by_currency || {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar el arqueo {session?.code ? `· ${session.code}` : ""}</DialogTitle>
          <DialogDescription>
            Cerrada por {nameOf(session?.closed_by ?? session?.user)}
            {session?.closed_at ? ` el ${formatDateTime(session.closed_at)}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg bg-muted/50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diferencias</p>
            {differences.length === 0 ? (
              <p className="tf-num">{formatMoney(session?.difference ?? 0, session?.currency)}</p>
            ) : (
              <ul className="space-y-1">
                {differences.map(([currency, amount]) => (
                  <li key={currency} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{currency.toUpperCase()}</span>
                    {Math.abs(amount) < 0.01 ? (
                      <Pill tone="success">Cuadrada</Pill>
                    ) : (
                      <Pill tone={amount > 0 ? "warning" : "danger"} className="tf-num">
                        {formatMoney(amount, currency)}
                      </Pill>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-reason">Justificación del cajero</Label>
            <Textarea id="review-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Sin justificación" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-notes">Nota de la revisión</Label>
            <Textarea id="review-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Qué se comprobó, qué se decidió…" />
          </div>

          <p className="text-xs text-muted-foreground">
            Al aprobar, el faltante se contabiliza como pérdida y el sobrante como ingreso.
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="outline" disabled={busy} onClick={() => resolve("recount")}>
            Devolver para recuento
          </Button>
          <Button disabled={busy} onClick={() => resolve("approve")}>
            {busy ? "Guardando…" : "Aprobar el arqueo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
