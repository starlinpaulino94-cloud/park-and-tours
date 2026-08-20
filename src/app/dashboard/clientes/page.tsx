import { requireTenant } from "@/lib/tenant";
import { WorkspaceHub, type HubMetric } from "@/components/tf/workspace-hub";
import { workspaceBySlug } from "@/lib/nav";
import { countMany, sumMany, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function ClientesHub() {
  const ctx = await requireTenant();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      customers: { table: "customer" },
      memberships: { table: "membership", filter: { status: "active" } },
      casesOpen: { table: "guest_case", filter: { status: { in: ["open", "in_progress", "waiting_customer", "escalated"] } } },
      casesUrgent: { table: "guest_case", filter: { priority: "urgent", status: { in: ["open", "in_progress", "escalated"] } } },
      giftCards: { table: "gift_card", filter: { status: { in: ["active", "partially_used"] } } },
      vouchers: { table: "voucher", filter: { status: "valid" } },
    }),
    sumMany(ctx.companyId, {
      liability: { table: "gift_card", field: "balance", filter: { status: { in: ["active", "partially_used"] } } },
      spend: { table: "customer", field: "total_spent" },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/clientes/directorio": { value: plural(c.customers, "cliente", "clientes"), tone: c.customers > 0 ? "good" : "neutral" },
    "/dashboard/clientes/membresias": { value: plural(c.memberships, "membresía activa", "membresías activas") },
    "/dashboard/clientes/casos": { value: plural(c.casesOpen, "caso abierto", "casos abiertos"), tone: c.casesUrgent > 0 ? "bad" : c.casesOpen > 0 ? "warn" : "good" },
    "/dashboard/clientes/gift-cards": { value: formatCompactMoney(s.liability, currency) + " en saldo", tone: "neutral" },
    "/dashboard/clientes/vouchers": { value: plural(c.vouchers, "voucher válido", "vouchers válidos") },
  };

  return (
    <WorkspaceHub
      workspace={workspaceBySlug("clientes")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Clientes registrados", value: String(c.customers), icon: "Users", tone: "primary" },
        { label: "Gasto histórico", value: formatCompactMoney(s.spend, currency), icon: "TrendingUp", hint: "Suma del gasto por cliente" },
        { label: "Casos abiertos", value: String(c.casesOpen), icon: "Headset", tone: c.casesUrgent > 0 ? "coral" : "default", hint: `${c.casesUrgent} urgentes` },
        { label: "Pasivo en gift cards", value: formatCompactMoney(s.liability, currency), icon: "Gift", tone: "amber", hint: `${c.giftCards} tarjetas con saldo` },
      ]}
    />
  );
}
