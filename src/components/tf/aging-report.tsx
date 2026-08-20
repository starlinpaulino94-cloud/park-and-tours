"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AGING_BUCKET, GENERIC_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
type Bucket = (typeof BUCKETS)[number];

interface Entity {
  key: string; label: string; type: string;
  total: number; documents: number; oldest_days: number;
  credit_limit?: number; credit_days?: number; over_limit?: boolean;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number;
}

interface Document {
  _id: string; document_number?: string; entity: string; entity_id: string;
  issue_date?: string; due_date?: string;
  amount: number; paid_amount: number; balance: number; currency: string;
  status?: string; bucket: Bucket; days_overdue: number;
}

interface AgingData {
  type: string;
  entities: Entity[];
  documents: Document[];
  totals: Record<Bucket, number> & { total: number };
  truncated: boolean;
}

const BUCKET_TONE: Record<Bucket, "success" | "info" | "warning" | "accent" | "danger"> = {
  current: "success", d1_30: "info", d31_60: "warning", d61_90: "accent", d90_plus: "danger",
};

/**
 * Shared aging screen for receivables and payables — same maths, different
 * direction of the money, so the two modules share one implementation.
 */
export function AgingReport({
  type, eyebrow, title, description, entityHeader, emptyTitle, emptyDescription,
}: {
  type: "receivable" | "payable";
  eyebrow: string;
  title: string;
  description: string;
  entityHeader: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const [data, setData] = useState<AgingData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<AgingData>(`/api/reports/aging?type=${type}`);
    setLoading(false);
    if (!res.ok) {
      console.error(`[aging:${type}] error cargando el informe:`, res.error);
      toast.error(res.error?.message || "No se pudo cargar la antigüedad de saldos");
      return;
    }
    setData(res.data || null);
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals;
  const currency = data?.documents?.[0]?.currency || "usd";
  const overdue = (totals?.total ?? 0) - (totals?.current ?? 0);
  const overLimit = (data?.entities || []).filter((e) => e.over_limit);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px] w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="primary" icon="Scale" label="Saldo total" value={formatMoney(totals?.total ?? 0, currency)}
              hint={`${formatNumber(data?.documents.length ?? 0)} documentos abiertos`} />
            <KpiCard icon="CircleCheck" label="Corriente" value={formatMoney(totals?.current ?? 0, currency)}
              hint="Todavía dentro del plazo acordado" />
            <KpiCard tone="coral" icon="TriangleAlert" label="Vencido" value={formatMoney(overdue, currency)}
              hint={`${(totals?.total ?? 0) > 0 ? ((overdue / (totals?.total ?? 1)) * 100).toFixed(0) : 0}% del saldo total`} />
            <KpiCard tone={overLimit.length > 0 ? "coral" : "default"} icon="ShieldAlert" label="Sobre el límite de crédito"
              value={formatNumber(overLimit.length)}
              hint={overLimit.length > 0 ? overLimit.map((e) => e.label).slice(0, 2).join(", ") : "Ningún partner excedido"} />
          </section>

          <section className="tf-card p-5">
            <h2 className="mb-4 font-display text-lg font-semibold">Distribución por antigüedad</h2>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {BUCKETS.map((b) => {
                const value = totals?.[b] ?? 0;
                const pct = (totals?.total ?? 0) > 0 ? (value / (totals?.total ?? 1)) * 100 : 0;
                return (
                  <div key={b} className="rounded-lg border border-border bg-muted/25 p-3">
                    <Pill tone={BUCKET_TONE[b]}>{AGING_BUCKET[b].label}</Pill>
                    <p className="mt-2 tf-num text-lg">{formatMoney(value, currency)}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{pct.toFixed(0)}% del total</p>
                  </div>
                );
              })}
            </div>
          </section>

          <Tabs defaultValue="entities">
            <TabsList>
              <TabsTrigger value="entities">Por {entityHeader.toLowerCase()}</TabsTrigger>
              <TabsTrigger value="documents">Documentos</TabsTrigger>
            </TabsList>

            <TabsContent value="entities" className="mt-5">
              <DataTable
                rows={(data?.entities || []).map((e) => ({ ...e, _id: e.key }))}
                emptyIcon="Scale"
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
                columns={[
                  {
                    key: "label", header: entityHeader,
                    render: (e: any) => (
                      <div>
                        <p className="font-semibold">{e.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(e.documents)} documento{e.documents === 1 ? "" : "s"}
                          {e.oldest_days > 0 ? ` · el más antiguo lleva ${e.oldest_days} días` : ""}
                        </p>
                      </div>
                    ),
                  },
                  ...BUCKETS.map((b) => ({
                    key: b, header: AGING_BUCKET[b].label, align: "right" as const,
                    hideOn: (b === "current" ? undefined : "lg") as "lg" | undefined,
                    render: (e: any) => (e[b] > 0 ? formatMoney(e[b], currency) : <span className="text-muted-foreground">—</span>),
                  })),
                  {
                    key: "total", header: "Saldo", align: "right",
                    render: (e: any) => (
                      <div>
                        <p className="font-semibold">{formatMoney(e.total, currency)}</p>
                        {e.over_limit && <Pill tone="danger" className="mt-1">Sobre el límite</Pill>}
                      </div>
                    ),
                  },
                ]}
              />
            </TabsContent>

            <TabsContent value="documents" className="mt-5">
              <DataTable
                rows={data?.documents || []}
                emptyIcon="FileText"
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
                columns={[
                  {
                    key: "document", header: "Documento",
                    render: (d: Document) => (
                      <div>
                        <p className="font-mono text-[12px] font-semibold">{d.document_number || "—"}</p>
                        <p className="text-xs text-muted-foreground">{d.entity}</p>
                      </div>
                    ),
                  },
                  { key: "issue", header: "Emisión", hideOn: "lg", render: (d: Document) => <span className="text-xs">{formatDate(d.issue_date)}</span> },
                  {
                    key: "due", header: "Vencimiento", hideOn: "sm",
                    render: (d: Document) => (
                      <div className="text-xs">
                        <p>{formatDate(d.due_date)}</p>
                        {d.days_overdue > 0 && (
                          <p className="font-semibold text-rose-700 dark:text-rose-400">{d.days_overdue} días de retraso</p>
                        )}
                      </div>
                    ),
                  },
                  { key: "amount", header: "Importe", align: "right", hideOn: "md", render: (d: Document) => formatMoney(d.amount, d.currency) },
                  { key: "paid", header: "Pagado", align: "right", hideOn: "lg", render: (d: Document) => formatMoney(d.paid_amount, d.currency) },
                  { key: "balance", header: "Saldo", align: "right",
                    render: (d: Document) => <span className="font-semibold">{formatMoney(d.balance, d.currency)}</span> },
                  { key: "bucket", header: "Tramo", align: "center", hideOn: "md",
                    render: (d: Document) => <Pill tone={BUCKET_TONE[d.bucket]}>{AGING_BUCKET[d.bucket].label}</Pill> },
                  { key: "status", header: "Estado", render: (d: Document) => <StatusBadge value={d.status} dict={GENERIC_STATUS} /> },
                ]}
              />
            </TabsContent>
          </Tabs>

          {data?.truncated && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Hay más de 1.000 documentos abiertos: el informe muestra los 1.000 con vencimiento más antiguo.
            </p>
          )}
        </>
      )}
    </div>
  );
}
