"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { KpiCard } from "@/components/tf/kpi-card";
import { EXPENSE_METHOD, GENERIC_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";

const EXPENSE_STATUS = ["pending", "approved", "paid", "rejected"];

export default function ExpensesPage() {
  return (
    <ResourcePage
      resource="expense"
      eyebrow="Finanzas"
      title="Gastos operativos"
      description="Combustible, peajes, entradas, comidas y cualquier salida de dinero que reduzca el margen real de la operación."
      createLabel="Nuevo gasto"
      searchPlaceholder="Buscar por concepto…"
      emptyIcon="Receipt"
      emptyTitle="Todavía no hay gastos registrados"
      emptyDescription="Registra los gastos del día para que el margen del panel refleje la realidad."
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, EXPENSE_STATUS) },
        { name: "payment_method", label: "Método", options: optionsFrom(EXPENSE_METHOD) },
      ]}
      renderSummary={(rows) => {
        const total = rows.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
        const pending = rows.filter((e: any) => e.status === "pending");
        const paid = rows.filter((e: any) => e.status === "paid");
        const currency = (rows[0] as any)?.currency || "usd";
        return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard tone="primary" icon="Receipt" label="Total en pantalla" value={formatMoney(total, currency)}
              hint={`${formatNumber(rows.length)} gastos`} />
            <KpiCard tone="amber" icon="Clock" label="Pendientes de aprobar"
              value={formatMoney(pending.reduce((s: number, e: any) => s + (e.amount ?? 0), 0), currency)}
              hint={`${formatNumber(pending.length)} gastos`} />
            <KpiCard icon="CheckCheck" label="Pagados"
              value={formatMoney(paid.reduce((s: number, e: any) => s + (e.amount ?? 0), 0), currency)}
              hint={`${formatNumber(paid.length)} gastos`} />
            <KpiCard icon="Calculator" label="Gasto medio"
              value={formatMoney(rows.length ? total / rows.length : 0, currency)}
              hint="Sobre los registros mostrados" />
          </div>
        );
      }}
      columns={[
        {
          key: "concept", header: "Concepto",
          render: (e: any) => (
            <div>
              <p className="font-semibold">{e.concept || "Sin concepto"}</p>
              <p className="text-xs text-muted-foreground">
                {typeof e.category === "object" && e.category ? e.category.name : "Sin categoría"}
                {typeof e.supplier === "object" && e.supplier ? ` · ${e.supplier.name}` : ""}
              </p>
            </div>
          ),
        },
        { key: "branch", header: "Sucursal", hideOn: "lg",
          render: (e: any) => (typeof e.branch === "object" && e.branch ? e.branch.name : "—") },
        { key: "date", header: "Fecha", hideOn: "sm", render: (e: any) => formatDate(e.expense_date) },
        { key: "method", header: "Método", hideOn: "md",
          render: (e: any) => <StatusBadge value={e.payment_method} dict={EXPENSE_METHOD} dot={false} /> },
        { key: "amount", header: "Importe", align: "right",
          render: (e: any) => <span className="font-semibold">{formatMoney(e.amount ?? 0, e.currency)}</span> },
        { key: "status", header: "Estado", render: (e: any) => <StatusBadge value={e.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "concept", label: "Concepto", required: true, span: 2 },
        { name: "category", label: "Categoría", type: "reference", resource: "expense_category" },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "amount", label: "Importe", type: "number", required: true },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "expense_date", label: "Fecha del gasto", type: "date" },
        { name: "payment_method", label: "Método de pago", type: "select", defaultValue: "cash", options: optionsFrom(EXPENSE_METHOD) },
        { name: "status", label: "Estado", type: "select", defaultValue: "pending", options: optionsFrom(GENERIC_STATUS, EXPENSE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
