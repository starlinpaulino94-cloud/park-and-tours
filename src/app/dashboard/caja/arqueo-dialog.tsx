"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/tf/status-badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { countTotal, denominationsFor, differenceOf, isCoin } from "@/lib/cash-close";

/**
 * El arqueo: la pantalla donde se cuenta el dinero.
 *
 * Dos decisiones que no son de estilo:
 *
 *  · **Se cuenta por denominación, no por total.** El cajero introduce cuántos
 *    billetes de cada valor tiene; el total lo calcula la pantalla. Escribir el
 *    total invita a copiar el esperado, que es exactamente lo que hacía la
 *    versión anterior —traía el esperado ya escrito en el campo—, y entonces la
 *    caja siempre cuadra y el arqueo no vale nada.
 *
 *  · **El conteo empieza a ciegas.** Mientras se cuenta no se ve lo esperado.
 *    Un cajero que ve el número al que tiene que llegar deja de contar y
 *    empieza a buscar ese número. Se puede revelar, y queda a un clic, pero la
 *    postura por defecto es la correcta.
 */

export interface ArqueoCurrency {
  currency: string;
  opening: number;
  sales: number;
  refunds: number;
  cash_sales: number;
  /** Lo que el vendedor se quedó de comisión en este turno (0083). */
  retained: number;
  cash_refunds: number;
  expenses: number;
  withdrawals: number;
  deposits: number;
  adjustments: number;
  card: number;
  transfer: number;
  other_methods: number;
  expected: number;
  counted: number | null;
  difference: number | null;
  breakdown: { denomination: number; quantity: number }[];
}

interface ArqueoPayload {
  session: { _id: string; code?: string; status?: string; currency?: string };
  tolerance: number;
  currencies: ArqueoCurrency[];
  card: { expected: number; batch: number | null; difference: number | null; reference: string | null };
}

export function ArqueoDialog({
  sessionId, open, onOpenChange, onClosed,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [payload, setPayload] = useState<ArqueoPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blind, setBlind] = useState(true);

  /** { dop: { "2000": 3, "100": 12 } } — se teclea como texto para no pelear con el 0. */
  const [counts, setCounts] = useState<Record<string, Record<string, string>>>({});
  const [cardBatch, setCardBatch] = useState("");
  const [cardReference, setCardReference] = useState("");
  const [depositReference, setDepositReference] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    const res = await api.get<ArqueoPayload>(`/api/cash/sessions/${sessionId}/arqueo`);
    setLoading(false);
    if (!res.ok) {
      console.error("[arqueo] no se pudo cargar:", res.error);
      toast.error(res.error?.message || "No se pudo preparar el arqueo");
      return;
    }
    setPayload(res.data || null);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    setBlind(true);
    setCounts({});
    setCardBatch("");
    setCardReference("");
    setDepositReference("");
    setReason("");
    setNotes("");
    load();
  }, [open, load]);

  const setQuantity = (currency: string, denomination: number, value: string) => {
    setCounts((prev) => ({
      ...prev,
      [currency]: { ...(prev[currency] || {}), [String(denomination)]: value.replace(/[^\d]/g, "") },
    }));
  };

  /** Lo contado en cada moneda, en vivo, con la misma aritmética que el servidor. */
  const countedByCurrency = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of payload?.currencies || []) {
      const lines = Object.entries(counts[row.currency] || {}).map(([denomination, quantity]) => ({
        denomination: Number(denomination),
        quantity: Number(quantity) || 0,
      }));
      out[row.currency] = countTotal(lines);
    }
    return out;
  }, [counts, payload]);

  const anyDifference = useMemo(() => {
    if (!payload) return false;
    const tolerance = payload.tolerance || 0;
    return payload.currencies.some(
      (row) => Math.abs(differenceOf(row.expected, countedByCurrency[row.currency] ?? 0)) > tolerance + 0.009
    );
  }, [payload, countedByCurrency]);

  const submit = async () => {
    if (!payload || !sessionId) return;
    if (anyDifference && reason.trim() === "") {
      toast.error("Explica la diferencia antes de cerrar");
      return;
    }
    setBusy(true);
    const res = await api.post<{ status: string; requires_approval: boolean }>(
      `/api/cash/sessions/${sessionId}/close`,
      {
        counts: payload.currencies.map((row) => ({
          currency: row.currency,
          breakdown: Object.entries(counts[row.currency] || {})
            .map(([denomination, quantity]) => ({
              denomination: Number(denomination),
              quantity: Number(quantity) || 0,
            }))
            .filter((line) => line.quantity > 0),
        })),
        card_batch_total: cardBatch === "" ? undefined : Number(cardBatch),
        card_batch_reference: cardReference || undefined,
        deposit_reference: depositReference || undefined,
        difference_reason: reason || undefined,
        notes: notes || undefined,
      }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[arqueo] no se pudo cerrar:", res.error);
      toast.error(res.error?.message || "No se pudo cerrar la caja");
      return;
    }
    toast.success(
      res.data?.requires_approval
        ? "Caja cerrada. El descuadre queda esperando revisión de un supervisor."
        : "Caja cerrada y cuadrada"
    );
    onOpenChange(false);
    onClosed();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Arqueo de caja {payload?.session.code ? `· ${payload.session.code}` : ""}</DialogTitle>
          <DialogDescription>
            Cuenta el efectivo por denominación. El total lo calcula el sistema, y la diferencia queda
            registrada con nombre y hora.
          </DialogDescription>
        </DialogHeader>

        {loading || !payload ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                {blind
                  ? "Conteo a ciegas: cuenta primero, compara después."
                  : "Estás viendo el efectivo esperado mientras cuentas."}
              </p>
              <Button type="button" variant="outline" size="sm" className="gap-1.5"
                onClick={() => setBlind((v) => !v)}>
                <Icon name="Eye" className="size-4" />
                {blind ? "Ver esperado" : "Ocultar esperado"}
              </Button>
            </div>

            {payload.currencies.map((row) => {
              const counted = countedByCurrency[row.currency] ?? 0;
              const difference = differenceOf(row.expected, counted);
              const balanced = Math.abs(difference) <= (payload.tolerance || 0) + 0.009;
              const denominations = denominationsFor(row.currency);

              return (
                <section key={row.currency} className="space-y-3 rounded-xl border p-4">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-base font-semibold">
                      {row.currency.toUpperCase()}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Fondo {formatMoney(row.opening, row.currency)}
                      {" · "}Cobros en efectivo {formatMoney(row.cash_sales, row.currency)}
                      {/**
                        * Lo retenido, DELANTE y con su nombre.
                        *
                        * Sale del cajón igual que un retiro, pero no es un
                        * retiro: es lo que el vendedor se quedó y no tiene que
                        * entregar. Sin esta línea, el arqueo le dice que
                        * entregue de más y el descuadre acaba a su nombre.
                        */}
                      {row.retained ? (
                        <>
                          {" · "}
                          <span className="text-amber-600 dark:text-amber-400">
                            Comisión retenida {formatMoney(row.retained, row.currency)}
                          </span>
                        </>
                      ) : null}
                      {row.expenses ? ` · Gastos ${formatMoney(row.expenses, row.currency)}` : ""}
                      {row.withdrawals ? ` · Retiros ${formatMoney(row.withdrawals, row.currency)}` : ""}
                    </p>
                  </header>

                  <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {denominations.map((denomination) => {
                      const quantity = counts[row.currency]?.[String(denomination)] ?? "";
                      const subtotal = (Number(quantity) || 0) * denomination;
                      return (
                        <div key={denomination} className="flex items-center gap-2">
                          <span className="tf-num w-24 shrink-0 text-right text-sm text-muted-foreground">
                            {isCoin(row.currency, denomination) ? "◦" : "▮"} {formatMoney(denomination, row.currency)}
                          </span>
                          <Input
                            id={`count-${row.currency}-${denomination}`}
                            inputMode="numeric"
                            className="h-8 w-20 text-right"
                            value={quantity}
                            placeholder="0"
                            onChange={(e) => setQuantity(row.currency, denomination, e.target.value)}
                          />
                          <span className="tf-num flex-1 text-right text-sm">
                            {subtotal > 0 ? formatMoney(subtotal, row.currency) : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid gap-2 rounded-lg bg-muted/50 px-4 py-3 sm:grid-cols-3">
                    <Figure label="Contado" value={formatMoney(counted, row.currency)} strong />
                    <Figure
                      label="Esperado"
                      value={blind ? "—" : formatMoney(row.expected, row.currency)}
                    />
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Diferencia</p>
                      {blind ? (
                        <p className="tf-num">—</p>
                      ) : balanced ? (
                        <Pill tone="success">Cuadrada</Pill>
                      ) : (
                        <Pill tone={difference > 0 ? "warning" : "danger"} className="tf-num">
                          {formatMoney(difference, row.currency)}
                        </Pill>
                      )}
                    </div>
                  </div>

                  {(row.card || row.transfer || row.other_methods) ? (
                    <p className="text-xs text-muted-foreground">
                      No entra al cajón:
                      {row.card ? ` tarjeta ${formatMoney(row.card, row.currency)}` : ""}
                      {row.transfer ? ` · transferencia ${formatMoney(row.transfer, row.currency)}` : ""}
                      {row.other_methods ? ` · cheque y crédito ${formatMoney(row.other_methods, row.currency)}` : ""}
                    </p>
                  ) : null}
                </section>
              );
            })}

            {payload.card.expected !== 0 && (
              <section className="space-y-3 rounded-xl border p-4">
                <h3 className="font-display text-base font-semibold">Cierre de lote del datáfono</h3>
                <p className="text-xs text-muted-foreground">
                  El sistema registró {formatMoney(payload.card.expected, payload.session.currency)} en tarjeta.
                  Si el lote del banco dice otra cosa, ese dinero no llega.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="card-batch">Total del lote</Label>
                    <Input id="card-batch" type="number" step="0.01" value={cardBatch}
                      onChange={(e) => setCardBatch(e.target.value)} placeholder="Según el comprobante del POS" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="card-reference">Referencia del lote</Label>
                    <Input id="card-reference" value={cardReference}
                      onChange={(e) => setCardReference(e.target.value)} placeholder="Nº de lote / terminal" />
                  </div>
                </div>
                {cardBatch !== "" && Math.abs(Number(cardBatch) - payload.card.expected) > 0.009 && (
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                    El lote difiere en {formatMoney(Number(cardBatch) - payload.card.expected, payload.session.currency)}.
                  </p>
                )}
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="deposit-reference">Depósito o bóveda</Label>
                <Input id="deposit-reference" value={depositReference}
                  onChange={(e) => setDepositReference(e.target.value)}
                  placeholder="Nº de depósito, sobre, bóveda…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="close-notes">Observaciones</Label>
                <Input id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            {!blind && anyDifference && (
              <div className="space-y-1.5">
                <Label htmlFor="difference-reason">Justificación de la diferencia</Label>
                <Textarea id="difference-reason" rows={3} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Qué pasó: un vuelto mal dado, un cobro sin registrar, un billete falso…" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Este cierre queda esperando la revisión de un supervisor.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {blind ? (
            <Button onClick={() => setBlind(false)} disabled={loading || !payload}>
              Comparar con lo esperado
            </Button>
          ) : (
            <Button onClick={submit} disabled={busy || loading || !payload}>
              {busy ? "Cerrando…" : "Cerrar caja"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? "tf-num text-lg font-semibold" : "tf-num"}>{value}</p>
    </div>
  );
}

