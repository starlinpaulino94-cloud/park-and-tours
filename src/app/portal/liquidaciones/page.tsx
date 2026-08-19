"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { COMMISSION_STATUS, GENERIC_STATUS, SETTLEMENT_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { Commission, Receivable, Settlement } from "@/lib/types";

export default function PortalSettlementsPage() {
  const { isStaff, partnerId } = usePortal();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Settlement | null>(null);

  const scope = useMemo(() => (isStaff && partnerId ? `&filter.partner=${partnerId}` : ""), [isStaff, partnerId]);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, r] = await Promise.all([
      api.get<Commission[]>(`/api/erp/commission?limit=300&sort=-generated_at&filter.beneficiary_type=partner${scope}`),
      api.get<Settlement[]>(`/api/erp/settlement?limit=100&sort=-issued_at&filter.beneficiary_type=partner${scope}`),
      api.get<Receivable[]>(`/api/erp/receivable?limit=200&sort=due_date${scope}`),
    ]);
    setLoading(false);

    if (!c.ok) { console.error("[portal/liquidaciones] comisiones:", c.error); toast.error(c.error?.message || "No se pudieron cargar las comisiones"); }
    if (!s.ok) { console.error("[portal/liquidaciones] liquidaciones:", s.error); toast.error(s.error?.message || "No se pudieron cargar las liquidaciones"); }
    if (!r.ok) { console.error("[portal/liquidaciones] estado de cuenta:", r.error); }

    setCommissions(c.data || []);
    setSettlements(s.data || []);
    setReceivables(r.data || []);
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const currency = commissions[0]?.currency || settlements[0]?.currency || "usd";
  const money = (n?: number | null) => formatMoney(n ?? 0, currency);

  const earned = commissions.reduce((s, c) => s + (c.amount ?? 0), 0);
  const pendingCommission = commissions
    .filter((c) => ["pending", "approved"].includes(c.status || ""))
    .reduce((s, c) => s + (c.amount ?? 0), 0);
  const paidCommission = commissions.filter((c) => c.status === "paid").reduce((s, c) => s + (c.amount ?? 0), 0);
  const outstanding = receivables
    .filter((r) => !["paid", "written_off"].includes(r.status || ""))
    .reduce((s, r) => s + (r.balance ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portal B2B"
        title="Comisiones y estados de cuenta"
        description="Cada comisión conserva el cálculo con el que se generó: aunque cambien las tarifas, lo ya devengado no se recalcula."
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="primary" icon="Percent" label="Comisión total" value={money(earned)}
          hint={`${formatNumber(commissions.length)} comisiones generadas`} />
        <KpiCard tone="amber" icon="Hourglass" label="Pendiente de liquidar" value={money(pendingCommission)} />
        <KpiCard icon="CircleCheck" label="Ya liquidado" value={money(paidCommission)} />
        <KpiCard tone={outstanding > 0 ? "coral" : "default"} icon="Wallet" label="Saldo con el operador" value={money(outstanding)}
          hint={outstanding > 0 ? "Documentos pendientes de pago" : "Sin deuda pendiente"} />
      </div>

      <Tabs defaultValue="settlements">
        <TabsList>
          <TabsTrigger value="settlements">Liquidaciones</TabsTrigger>
          <TabsTrigger value="commissions">Comisiones</TabsTrigger>
          <TabsTrigger value="account">Estado de cuenta</TabsTrigger>
        </TabsList>

        <TabsContent value="settlements" className="mt-5">
          <DataTable
            rows={settlements}
            loading={loading}
            onRowClick={(s) => setDetail(s)}
            emptyIcon="FileSpreadsheet"
            emptyTitle="Todavía no hay liquidaciones"
            emptyDescription="El operador genera las liquidaciones por período. Cuando exista una, aparecerá aquí con su detalle."
            columns={[
              { key: "code", header: "Liquidación", render: (s: any) => (
                <div>
                  <p className="font-mono text-xs font-semibold">{s.code || "—"}</p>
                  <p className="text-xs text-muted-foreground">Emitida {formatDate(s.issued_at)}</p>
                </div>
              ) },
              { key: "period", header: "Período", hideOn: "md",
                render: (s: any) => `${formatDate(s.period_from)} – ${formatDate(s.period_to)}` },
              { key: "sales", header: "Ventas", align: "right", hideOn: "lg",
                render: (s: any) => formatMoney(s.sales_total ?? 0, s.currency) },
              { key: "commission", header: "Comisión", align: "right",
                render: (s: any) => <span className="font-semibold">{formatMoney(s.commission_total ?? 0, s.currency)}</span> },
              { key: "paid", header: "Pagado", align: "right", hideOn: "md",
                render: (s: any) => formatMoney(s.paid_total ?? 0, s.currency) },
              { key: "pending", header: "Pendiente", align: "right",
                render: (s: any) => (s.pending_total ?? 0) > 0.009
                  ? <span className="font-semibold text-amber-600 dark:text-amber-400">{formatMoney(s.pending_total, s.currency)}</span>
                  : <span className="text-muted-foreground">—</span> },
              { key: "status", header: "Estado", render: (s: any) => <StatusBadge value={s.status} dict={SETTLEMENT_STATUS} /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="commissions" className="mt-5">
          <DataTable
            rows={commissions}
            loading={loading}
            emptyIcon="Percent"
            emptyTitle="Todavía no has generado comisiones"
            emptyDescription="Las comisiones se calculan automáticamente al confirmarse cada reserva de tu red."
            columns={[
              { key: "booking", header: "Reserva", render: (c: any) => (
                <div>
                  <p className="font-mono text-xs font-semibold">
                    {typeof c.booking === "object" && c.booking ? c.booking.booking_number : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {typeof c.booking === "object" && c.booking && typeof c.booking.product === "object" && c.booking.product
                      ? c.booking.product.name
                      : c.beneficiary_name || "—"}
                  </p>
                </div>
              ) },
              { key: "generated", header: "Generada", hideOn: "md", render: (c: any) => formatDate(c.generated_at) },
              { key: "base", header: "Base", align: "right", hideOn: "lg",
                render: (c: any) => formatMoney(c.base_amount ?? 0, c.currency) },
              { key: "pct", header: "%", align: "right", hideOn: "sm",
                render: (c: any) => (c.percentage != null ? formatPercent(c.percentage, 1) : "—") },
              { key: "amount", header: "Comisión", align: "right",
                render: (c: any) => <span className="font-semibold">{formatMoney(c.amount ?? 0, c.currency)}</span> },
              { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={COMMISSION_STATUS} /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="account" className="mt-5">
          <DataTable
            rows={receivables}
            loading={loading}
            emptyIcon="FileText"
            emptyTitle="No tienes documentos en tu cuenta"
            emptyDescription="Aquí verás las facturas y saldos que el operador tenga abiertos contigo."
            columns={[
              { key: "doc", header: "Documento", render: (r: any) => (
                <div>
                  <p className="font-mono text-xs font-semibold">{r.document_number || "—"}</p>
                  <p className="text-xs text-muted-foreground">Emitido {formatDate(r.issue_date)}</p>
                </div>
              ) },
              { key: "due", header: "Vencimiento", hideOn: "md", render: (r: any) => formatDate(r.due_date) },
              { key: "amount", header: "Importe", align: "right", render: (r: any) => formatMoney(r.amount ?? 0, r.currency) },
              { key: "paid", header: "Pagado", align: "right", hideOn: "lg", render: (r: any) => formatMoney(r.paid_amount ?? 0, r.currency) },
              { key: "balance", header: "Saldo", align: "right",
                render: (r: any) => <span className="font-semibold">{formatMoney(r.balance ?? 0, r.currency)}</span> },
              { key: "status", header: "Estado", render: (r: any) => <StatusBadge value={r.status} dict={GENERIC_STATUS} /> },
            ]}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-md">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">Liquidación {detail.code}</SheetTitle>
                <SheetDescription>
                  Período {formatDate(detail.period_from)} – {formatDate(detail.period_to)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-8">
                <StatusBadge value={detail.status} dict={SETTLEMENT_STATUS} />
                <ul className="tf-card space-y-1.5 p-4 text-sm">
                  <li className="flex justify-between gap-3"><span className="text-muted-foreground">Ventas del período</span>
                    <span className="tabular-nums">{formatMoney(detail.sales_total, detail.currency)}</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted-foreground">Cancelaciones</span>
                    <span className="tabular-nums">− {formatMoney(detail.cancellations_total, detail.currency)}</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted-foreground">Base comisionable</span>
                    <span className="tabular-nums">{formatMoney(detail.base_total, detail.currency)}</span></li>
                  <li className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
                    <span>Comisión</span><span className="tabular-nums">{formatMoney(detail.commission_total, detail.currency)}</span></li>
                  <li className="flex justify-between gap-3"><span className="text-muted-foreground">Pagado</span>
                    <span className="tabular-nums">{formatMoney(detail.paid_total, detail.currency)}</span></li>
                  <li className="flex justify-between gap-3 font-semibold"><span>Pendiente</span>
                    <span className="tabular-nums">{formatMoney(detail.pending_total, detail.currency)}</span></li>
                </ul>
                {detail.notes && <p className="text-sm text-muted-foreground">{detail.notes}</p>}
                <p className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Si no estás de acuerdo con alguna cifra, contacta con tu gestor: el operador puede marcar la
                  liquidación en disputa sin alterar las comisiones ya devengadas.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {!loading && settlements.length === 0 && commissions.length === 0 && receivables.length === 0 && (
        <EmptyState icon="FileSpreadsheet" title="Tu cuenta todavía no tiene movimientos"
          description="En cuanto vendas tu primera excursión verás aquí la comisión generada y su liquidación." />
      )}
    </div>
  );
}
