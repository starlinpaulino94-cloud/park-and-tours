"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SETTLEMENT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

/**
 * El estado de cuenta de una liquidación de proveedor.
 *
 * Es la pantalla del viernes: se ve lo que dice el manifiesto al lado de lo que
 * factura el proveedor, se anota su comprobante y se paga el neto. Las dos
 * columnas van juntas a propósito: con un solo total no se puede discutir "me
 * cobras 40 pax y yo llevé 37".
 */
interface StatementLine {
  _id: string;
  concept: string;
  cost_type?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  amount: number;
  confirmed_amount: number | null;
  variance: number;
  verdict: "pending" | "match" | "over" | "under";
  currency: string;
  status?: string | null;
  booking_number: string | null;
  departure_at: string | null;
  product_name: string | null;
}

interface StatementData {
  settlement: {
    _id: string; code?: string; status?: string; currency?: string;
    period_from?: string; period_to?: string;
    supplier_invoice_number?: string; supplier_invoice_ncf?: string; supplier_invoice_date?: string;
    dispute_reason?: string; paid_total?: number; net_total?: number; pending_total?: number;
    notes?: string;
  };
  supplier: {
    name?: string; tax_id?: string; tax_regime?: string;
    retention_isr_pct?: number; retention_itbis_pct?: number; tax_rate?: number;
    bank_name?: string; bank_account?: string;
  } | null;
  lines: StatementLine[];
  retentions: { base: number; tax: number; isr: number; itbis: number; total: number };
  totals: { services: number; confirmed: number; adjustments: number; retentions: number; net: number };
  disputed: number;
}

const VERDICT: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  match: { label: "Cuadra", tone: "success" },
  over: { label: "Cobra de más", tone: "danger" },
  under: { label: "Cobra de menos", tone: "warning" },
  pending: { label: "Sin facturar", tone: "neutral" },
};

export function StatementDrawer({
  settlementId, open, onOpenChange, onChanged,
}: {
  settlementId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [invoice, setInvoice] = useState("");
  const [ncf, setNcf] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [adjustments, setAdjustments] = useState("");
  const [tolerance, setTolerance] = useState("0");
  const [acceptVariance, setAcceptVariance] = useState(false);
  const [payAmount, setPayAmount] = useState("");

  const load = useCallback(async () => {
    if (!settlementId) return;
    setLoading(true);
    const res = await api.get<StatementData>(`/api/settlements/${settlementId}/statement`);
    setLoading(false);
    if (!res.ok) {
      console.error("[proveedores] no se pudo cargar el estado de cuenta:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el estado de cuenta");
      return;
    }
    setData(res.data || null);
    const settlement = res.data?.settlement;
    setInvoice(settlement?.supplier_invoice_number || "");
    setNcf(settlement?.supplier_invoice_ncf || "");
    setInvoiceDate((settlement?.supplier_invoice_date || "").slice(0, 10));
    setInvoiceTotal(String(res.data?.totals.services ?? ""));
    setAdjustments("");
    setAcceptVariance(false);
    setPayAmount("");
    setConfirming(false);
  }, [settlementId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const confirm = async () => {
    if (!settlementId) return;
    if (!invoice.trim()) {
      toast.error("Indica el número de la factura del proveedor");
      return;
    }
    setBusy(true);
    const res = await api.post<{ status: string; disputed: number }>(
      `/api/settlements/${settlementId}/confirm`,
      {
        invoice_number: invoice.trim(),
        invoice_ncf: ncf.trim() || undefined,
        invoice_date: invoiceDate || undefined,
        confirmed_total: invoiceTotal === "" ? undefined : Number(invoiceTotal),
        adjustments_total: adjustments === "" ? undefined : Number(adjustments),
        tolerance: Number(tolerance) || 0,
        accept_variance: acceptVariance,
      }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[proveedores] no se pudo conciliar:", res.error);
      toast.error(res.error?.message || "No se pudo registrar la factura");
      return;
    }
    toast.success(
      res.data?.status === "disputed"
        ? `Registrada con ${formatNumber(res.data?.disputed ?? 0)} discrepancia(s): queda en disputa`
        : "Factura registrada y liquidación aprobada"
    );
    await load();
    onChanged();
  };

  const pay = async () => {
    if (!settlementId) return;
    setBusy(true);
    const res = await api.post<{ status: string; outstanding: number }>(
      `/api/settlements/${settlementId}/pay`,
      payAmount === "" ? {} : { amount: Number(payAmount) }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[proveedores] no se pudo pagar:", res.error);
      toast.error(res.error?.message || "No se pudo registrar el pago");
      return;
    }
    toast.success(
      res.data?.status === "paid"
        ? "Liquidación pagada"
        : `Abono registrado · quedan ${formatMoney(res.data?.outstanding ?? 0, data?.settlement.currency)}`
    );
    await load();
    onChanged();
  };

  const settlement = data?.settlement;
  const currency = settlement?.currency;
  const anyConfirmed = (data?.lines || []).some((line) => line.confirmed_amount !== null);
  const outstanding = Math.max(0, (data?.totals.net ?? 0) - (settlement?.paid_total ?? 0));
  const payable = !!settlement && !["paid", "void", "disputed"].includes(settlement.status || "")
    && !!settlement.supplier_invoice_number && outstanding > 0.009;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="tf-num text-base">
            {data?.supplier?.name || "Proveedor"} {settlement?.code ? `· ${settlement.code}` : ""}
          </SheetTitle>
          <SheetDescription>
            {settlement?.period_from && settlement?.period_to
              ? `Servicios operados del ${formatDate(settlement.period_from)} al ${formatDate(settlement.period_to)}.`
              : "Servicios operados del período."}
          </SheetDescription>
        </SheetHeader>

        {loading || !data ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={settlement?.status || "pending"} dict={SETTLEMENT_STATUS} />
              {data.disputed > 0 && (
                <Pill tone="danger">{formatNumber(data.disputed)} no cuadran</Pill>
              )}
              {!settlement?.supplier_invoice_number && <Pill tone="warning">Sin comprobante</Pill>}
              <Button variant="outline" size="sm" className="ml-auto gap-1.5" asChild>
                <a href={`/api/settlements/${settlementId}/statement/pdf`} target="_blank" rel="noopener noreferrer">
                  <Icon name="Printer" className="size-4" /> Estado de cuenta
                </a>
              </Button>
            </div>

            <section className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 px-4 py-3 sm:grid-cols-4">
              <Figure label="Operado" value={formatMoney(data.totals.services, currency)} />
              <Figure label="Facturado"
                value={anyConfirmed ? formatMoney(data.totals.confirmed, currency) : "—"} />
              <Figure label="Retenciones" value={formatMoney(data.totals.retentions, currency)} />
              <Figure label="Neto a pagar" value={formatMoney(data.totals.net, currency)} strong />
            </section>

            {data.totals.retentions > 0 && (
              <p className="text-xs text-muted-foreground">
                Base imponible {formatMoney(data.retentions.base, currency)} · ITBIS facturado{" "}
                {formatMoney(data.retentions.tax, currency)} · ISR {formatNumber(data.retentions.isr)}{" "}
                retenido al {data.supplier?.retention_isr_pct ?? "—"}% · ITBIS retenido{" "}
                {formatMoney(data.retentions.itbis, currency)}
              </p>
            )}

            <section className="space-y-2">
              <h3 className="font-display text-base font-semibold">
                Servicios · {formatNumber(data.lines.length)}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left">Fecha</th>
                      <th className="py-2 text-left">Reserva</th>
                      <th className="py-2 text-left">Concepto</th>
                      <th className="py-2 text-right">Operado</th>
                      <th className="py-2 text-right">Facturado</th>
                      <th className="py-2 text-left">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line) => (
                      <tr key={line._id} className="border-b last:border-0">
                        <td className="py-2 text-xs">
                          {line.departure_at ? formatDate(line.departure_at) : "—"}
                        </td>
                        <td className="py-2 text-xs">{line.booking_number || "—"}</td>
                        <td className="py-2">
                          <p>{line.concept}</p>
                          {line.product_name && (
                            <p className="text-xs text-muted-foreground">{line.product_name}</p>
                          )}
                        </td>
                        <td className="tf-num py-2 text-right">{formatMoney(line.amount, line.currency)}</td>
                        <td className="tf-num py-2 text-right">
                          {line.confirmed_amount !== null
                            ? formatMoney(line.confirmed_amount, line.currency)
                            : "—"}
                        </td>
                        <td className="py-2">
                          <Pill tone={VERDICT[line.verdict]?.tone || "neutral"}>
                            {VERDICT[line.verdict]?.label || line.verdict}
                            {line.verdict !== "match" && line.verdict !== "pending"
                              ? ` ${formatMoney(line.variance, line.currency)}`
                              : ""}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {settlement?.dispute_reason && (
              <p className="rounded-lg bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-400">
                {settlement.dispute_reason}
              </p>
            )}

            {confirming ? (
              <section className="space-y-4 rounded-xl border p-4">
                <h3 className="font-display text-base font-semibold">La factura del proveedor</h3>
                <p className="text-xs text-muted-foreground">
                  El gasto se sostiene ante la DGII con su comprobante. Si el total facturado no cuadra con
                  lo operado, la liquidación queda en disputa hasta que alguien la acepte.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="invoice">Número de factura</Label>
                    <Input id="invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ncf">NCF</Label>
                    <Input id="ncf" value={ncf} onChange={(e) => setNcf(e.target.value)}
                      placeholder="B0100000123" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invoice-date">Fecha</Label>
                    <Input id="invoice-date" type="date" value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invoice-total">Total facturado</Label>
                    <Input id="invoice-total" type="number" step="0.01" value={invoiceTotal}
                      onChange={(e) => setInvoiceTotal(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="adjustments">Ajustes acordados</Label>
                    <Input id="adjustments" type="number" step="0.01" value={adjustments}
                      onChange={(e) => setAdjustments(e.target.value)}
                      placeholder="Negativo para descontar" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tolerance">Tolerancia</Label>
                    <Input id="tolerance" type="number" step="0.01" value={tolerance}
                      onChange={(e) => setTolerance(e.target.value)} />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    id="accept-variance" type="checkbox" className="mt-0.5"
                    checked={acceptVariance} onChange={(e) => setAcceptVariance(e.target.checked)}
                  />
                  <span>
                    Acepto la diferencia y autorizo el pago aunque no cuadre con lo operado.
                    Queda registrado en la auditoría.
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setConfirming(false)}>Cancelar</Button>
                  <Button onClick={confirm} disabled={busy}>
                    {busy ? "Registrando…" : "Registrar la factura"}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="gap-1.5" onClick={() => setConfirming(true)}
                  disabled={settlement?.status === "paid" || settlement?.status === "void"}>
                  <Icon name="Receipt" className="size-4" />
                  {settlement?.supplier_invoice_number ? "Corregir la factura" : "Registrar la factura"}
                </Button>
                {payable && (
                  <>
                    <Input
                      id="pay-amount" type="number" step="0.01" className="h-9 w-40"
                      value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                      placeholder={`Todo: ${formatMoney(outstanding, currency)}`}
                    />
                    <Button className="gap-1.5" onClick={pay} disabled={busy}>
                      <Icon name="Banknote" className="size-4" />
                      {busy ? "Pagando…" : "Pagar"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {(settlement?.paid_total ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Pagado {formatMoney(settlement?.paid_total ?? 0, currency)} de{" "}
                {formatMoney(data.totals.net, currency)}
                {outstanding > 0.009 ? ` · quedan ${formatMoney(outstanding, currency)}` : " · saldada"}
              </p>
            )}

            {data.supplier?.bank_account && (
              <p className="text-xs text-muted-foreground">
                Transferir a {data.supplier.bank_name || "su banco"} · {data.supplier.bank_account}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
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
