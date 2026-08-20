import { requireTenant } from "@/lib/tenant";
import { WorkspaceHub, type HubMetric } from "@/components/tf/workspace-hub";
import { workspaceBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function FinanzasHub() {
  const ctx = await requireTenant();
  const today = todayRange();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      sessionsOpen: { table: "cash_session", filter: { status: "open" } },
      paymentsToday: { table: "payment", filter: { paid_at: today } },
      registers: { table: "cash_register", filter: { status: "active" } },
      receivablesOpen: { table: "receivable", filter: { status: { in: ["pending", "partially_paid", "overdue"] } } },
      overdue: { table: "receivable", filter: { status: "overdue" } },
      invoicesIssued: { table: "invoice", filter: { status: { in: ["issued", "sent", "partially_paid", "overdue"] } } },
      payablesOpen: { table: "payable", filter: { status: { in: ["pending", "partially_paid", "overdue"] } } },
      expensesToday: { table: "expense", filter: { expense_date: today } },
      accounts: { table: "ledger_account", filter: { status: "active" } },
      entries: { table: "ledger_entry" },
      taxProfiles: { table: "tax_profile", filter: { status: "active" } },
      rates: { table: "currency_rate" },
    }),
    sumMany(ctx.companyId, {
      collectedToday: { table: "payment", field: "amount", filter: { paid_at: today } },
      receivable: { table: "receivable", field: "balance", filter: { status: { in: ["pending", "partially_paid", "overdue"] } } },
      payable: { table: "payable", field: "balance", filter: { status: { in: ["pending", "partially_paid", "overdue"] } } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/caja": { value: c.sessionsOpen > 0 ? plural(c.sessionsOpen, "turno abierto", "turnos abiertos") : "Sin turnos abiertos", tone: c.sessionsOpen > 0 ? "warn" : "good" },
    "/dashboard/pagos": { value: plural(c.paymentsToday, "cobro hoy", "cobros hoy"), tone: c.paymentsToday > 0 ? "good" : "neutral" },
    "/dashboard/finanzas/cajas": { value: plural(c.registers, "caja activa", "cajas activas") },
    "/dashboard/cobros": { value: c.overdue > 0 ? plural(c.overdue, "vencida", "vencidas") : plural(c.receivablesOpen, "por cobrar", "por cobrar"), tone: c.overdue > 0 ? "bad" : "neutral" },
    "/dashboard/finanzas/facturas": { value: plural(c.invoicesIssued, "factura emitida", "facturas emitidas") },
    "/dashboard/deudas": { value: plural(c.payablesOpen, "por pagar", "por pagar"), tone: c.payablesOpen > 0 ? "warn" : "good" },
    "/dashboard/gastos": { value: plural(c.expensesToday, "gasto hoy", "gastos hoy") },
    "/dashboard/finanzas/cuentas": { value: plural(c.accounts, "cuenta", "cuentas"), tone: c.accounts === 0 ? "warn" : "neutral" },
    "/dashboard/finanzas/diario": { value: plural(c.entries, "asiento", "asientos") },
    "/dashboard/finanzas/fiscal": { value: plural(c.taxProfiles, "perfil activo", "perfiles activos"), tone: c.taxProfiles === 0 ? "warn" : "neutral" },
    "/dashboard/finanzas/divisas": { value: plural(c.rates, "tasa registrada", "tasas registradas") },
  };

  return (
    <WorkspaceHub
      workspace={workspaceBySlug("finanzas")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Cobrado hoy", value: formatCompactMoney(s.collectedToday, currency), icon: "Wallet", tone: "primary", hint: `${c.paymentsToday} pagos` },
        { label: "Por cobrar", value: formatCompactMoney(s.receivable, currency), icon: "ArrowDownToLine", tone: c.overdue > 0 ? "coral" : "default", hint: `${c.overdue} documentos vencidos` },
        { label: "Por pagar", value: formatCompactMoney(s.payable, currency), icon: "ArrowUpFromLine", tone: "amber", hint: `${c.payablesOpen} obligaciones abiertas` },
        { label: "Asientos contables", value: String(c.entries), icon: "Scale", hint: `${c.accounts} cuentas en el plan` },
      ]}
    />
  );
}
