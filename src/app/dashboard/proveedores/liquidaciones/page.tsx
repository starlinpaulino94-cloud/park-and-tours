"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SETTLEMENT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, toDateInput } from "@/lib/format";
import { StatementDrawer } from "./statement-drawer";

interface Pending {
  _id: string;
  supplierId: string;
  name: string;
  currency: string;
  services: number;
  lines: number;
  oldest: string | null;
}

interface Settlement {
  _id: string; code?: string; status?: string; currency?: string;
  period_from?: string; period_to?: string;
  services_total?: number; confirmed_total?: number; retention_total?: number;
  net_total?: number; paid_total?: number; pending_total?: number;
  supplier_invoice_number?: string; supplier?: { name?: string } | string;
  beneficiary_name?: string;
}

const firstOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

/** Varias monedas se apilan con su símbolo; convertirlas sería inventar una tasa. */
function money(rows: { currency: string; amount: number }[]): string {
  const parts = rows.filter((row) => Math.abs(row.amount) > 0.009);
  if (parts.length === 0) return formatMoney(0);
  const byCurrency = new Map<string, number>();
  for (const row of parts) {
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
  }
  return [...byCurrency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, amount]) => formatMoney(amount, code))
    .join("  ·  ");
}

const supplierName = (settlement: Settlement): string => {
  const supplier = settlement.supplier;
  if (supplier && typeof supplier === "object") return supplier.name || "Proveedor";
  return settlement.beneficiary_name || "Proveedor";
};

export default function SupplierSettlementsPage() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statementFor, setStatementFor] = useState<string | null>(null);

  const [generating, setGenerating] = useState<Pending | null>(null);
  const [from, setFrom] = useState(toDateInput(firstOfMonth()));
  const [to, setTo] = useState(toDateInput(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    const [pendingRes, listRes] = await Promise.all([
      api.get<{ pending: Pending[] }>("/api/settlements/supplier"),
      api.get<Settlement[]>("/api/erp/settlement?limit=100&filter.beneficiary_type=supplier"),
    ]);
    setLoading(false);
    if (!pendingRes.ok) {
      console.error("[proveedores] error cargando lo pendiente:", pendingRes.error);
      toast.error(pendingRes.error?.message || "No se pudo cargar lo pendiente de liquidar");
    } else {
      setPending(pendingRes.data?.pending || []);
    }
    if (!listRes.ok) {
      console.error("[proveedores] error cargando las liquidaciones:", listRes.error);
    } else {
      setSettlements(listRes.data || []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!generating) return;
    if (!generating.supplierId) {
      toast.error("Este grupo no tiene proveedor asignado: corrige la tarifa en el catálogo del producto");
      return;
    }
    setBusy(true);
    const res = await api.post<{ settlement: Settlement; claimed: number; services: number }>(
      "/api/settlements/supplier",
      { supplier_id: generating.supplierId, period_from: from, period_to: to }
    );
    setBusy(false);
    if (!res.ok) {
      console.error("[proveedores] error generando la liquidación:", res.error);
      toast.error(res.error?.message || "No se pudo generar la liquidación");
      return;
    }
    toast.success(
      `Liquidación ${res.data?.settlement?.code} con ${formatNumber(res.data?.claimed ?? 0)} servicios`
    );
    setGenerating(null);
    setStatementFor(res.data?.settlement?._id ?? null);
    load();
  };

  const openSettlements = settlements.filter(
    (s) => !["paid", "void"].includes(s.status || "")
  );
  const disputed = settlements.filter((s) => s.status === "disputed");
  const withoutInvoice = openSettlements.filter((s) => !s.supplier_invoice_number);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Proveedores"
        title="Liquidaciones de servicios"
        description="Lo que se le debe a quien operó: el autobús, el almuerzo, la entrada, el guía. Se agrupa por período, se contrasta con su factura y se paga el neto tras retenciones."
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="amber" icon="Truck" label="Pendiente de liquidar"
              value={money(pending.map((p) => ({ currency: p.currency, amount: p.services })))}
              hint={`${formatNumber(pending.length)} proveedor${pending.length === 1 ? "" : "es"} con servicios operados`} />
            <KpiCard tone="primary" icon="FileSpreadsheet" label="Liquidado sin pagar"
              value={money(openSettlements.map((s) => ({
                currency: String(s.currency || "usd"), amount: s.pending_total ?? 0,
              })))}
              hint={`${formatNumber(openSettlements.length)} liquidaciones abiertas`} />
            <KpiCard tone={disputed.length > 0 ? "coral" : "default"} icon="Scale" label="En disputa"
              value={formatNumber(disputed.length)}
              hint="Lo facturado no cuadra con lo operado" />
            <KpiCard tone={withoutInvoice.length > 0 ? "amber" : "default"} icon="Receipt"
              label="Sin comprobante" value={formatNumber(withoutInvoice.length)}
              hint="Sin factura del proveedor no se puede pagar" />
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Servicios operados sin liquidar</h2>
            {pending.length === 0 ? (
              <div className="tf-card p-2">
                <EmptyState icon="Truck" title="No hay nada pendiente de liquidar"
                  description="Cuando se venda una excursión con tarifas de proveedor en el catálogo, aquí aparecerá lo que se le debe a cada uno." />
              </div>
            ) : (
              <DataTable
                rows={pending}
                columns={[
                  {
                    key: "name", header: "Proveedor",
                    render: (row: Pending) => (
                      <div>
                        <p className="font-semibold">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(row.lines)} servicio{row.lines === 1 ? "" : "s"}
                          {row.oldest ? ` · el más antiguo del ${formatDate(row.oldest)}` : ""}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "currency", header: "Moneda", align: "center", hideOn: "md",
                    render: (row: Pending) => <Pill tone="neutral">{row.currency.toUpperCase()}</Pill>,
                  },
                  {
                    key: "services", header: "Se le debe", align: "right",
                    render: (row: Pending) => (
                      <span className="tf-num font-semibold">{formatMoney(row.services, row.currency)}</span>
                    ),
                  },
                  {
                    key: "action", header: "", align: "right",
                    render: (row: Pending) => (
                      <Button size="sm" className="gap-1.5" disabled={!row.supplierId}
                        onClick={() => setGenerating(row)}>
                        <Icon name="FileSpreadsheet" className="size-4" /> Liquidar
                      </Button>
                    ),
                  },
                ]}
              />
            )}
            {pending.some((row) => !row.supplierId) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Hay servicios sin proveedor asignado: no se pueden pagar a nadie. Asigna el proveedor
                en la tarifa del producto (Catálogo → Costos) y vuelve a vender, o corrígelo antes de liquidar.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Liquidaciones emitidas</h2>
            <DataTable
              rows={settlements}
              emptyIcon="History"
              emptyTitle="Todavía no hay liquidaciones de proveedor"
              emptyDescription="Genera la primera desde la lista de servicios pendientes."
              columns={[
                {
                  key: "code", header: "Liquidación",
                  render: (s: Settlement) => (
                    <div>
                      <p className="font-semibold">{s.code}</p>
                      <p className="text-xs text-muted-foreground">{supplierName(s)}</p>
                    </div>
                  ),
                },
                {
                  key: "period", header: "Período", hideOn: "md",
                  render: (s: Settlement) => (
                    <span className="text-xs">
                      {formatDate(s.period_from)} — {formatDate(s.period_to)}
                    </span>
                  ),
                },
                {
                  key: "services", header: "Operado", align: "right", hideOn: "lg",
                  render: (s: Settlement) => formatMoney(s.services_total ?? 0, s.currency),
                },
                {
                  key: "confirmed", header: "Facturado", align: "right", hideOn: "lg",
                  render: (s: Settlement) =>
                    s.supplier_invoice_number
                      ? formatMoney(s.confirmed_total ?? 0, s.currency)
                      : <span className="text-xs text-muted-foreground">sin factura</span>,
                },
                {
                  key: "retention", header: "Retenido", align: "right", hideOn: "lg",
                  render: (s: Settlement) =>
                    (s.retention_total ?? 0) > 0 ? formatMoney(s.retention_total ?? 0, s.currency) : "—",
                },
                {
                  key: "net", header: "Neto", align: "right",
                  render: (s: Settlement) => (
                    <span className="tf-num font-semibold">{formatMoney(s.net_total ?? 0, s.currency)}</span>
                  ),
                },
                {
                  key: "status", header: "Estado",
                  render: (s: Settlement) => <StatusBadge value={s.status || "pending"} dict={SETTLEMENT_STATUS} />,
                },
                {
                  key: "open", header: "", align: "right",
                  render: (s: Settlement) => (
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStatementFor(s._id)}>
                      <Icon name="FileText" className="size-4" /> Ver
                    </Button>
                  ),
                },
              ]}
            />
          </section>
        </>
      )}

      <Dialog open={!!generating} onOpenChange={(v) => !v && setGenerating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liquidar a {generating?.name}</DialogTitle>
            <DialogDescription>
              Se agrupan los servicios cuya SALIDA cae en el período: al proveedor se le paga por lo que
              operó, no por lo que se vendió.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="period-from">Desde</Label>
                <Input id="period-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period-to">Hasta</Label>
                <Input id="period-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 px-4 py-3">
              <p className="text-xs text-muted-foreground">Pendiente total de este proveedor</p>
              <p className="tf-num text-xl">
                {formatMoney(generating?.services ?? 0, generating?.currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Lo que quede fuera del período seguirá pendiente para la próxima.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerating(null)}>Cancelar</Button>
            <Button onClick={generate} disabled={busy}>{busy ? "Generando…" : "Generar liquidación"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatementDrawer
        settlementId={statementFor}
        open={!!statementFor}
        onOpenChange={(v) => !v && setStatementFor(null)}
        onChanged={load}
      />
    </div>
  );
}
