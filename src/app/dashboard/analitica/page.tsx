import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, sumMany, plural } from "@/lib/hub-stats";
import { formatCompactMoney, formatPercent } from "@/lib/format";

export default async function AnaliticaHub() {
  const ctx = await requireTenant();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      bookings: { table: "booking", filter: { status: { in: ["confirmed", "paid", "partially_paid", "checked_in", "completed"] } } },
      products: { table: "product", filter: { status: "active" } },
    }),
    sumMany(ctx.companyId, {
      gross: { table: "booking", field: "gross_amount", filter: { status: { in: ["confirmed", "paid", "partially_paid", "checked_in", "completed"] } } },
      cost: { table: "booking", field: "cost_amount", filter: { status: { in: ["confirmed", "paid", "partially_paid", "checked_in", "completed"] } } },
      margin: { table: "booking", field: "margin_amount", filter: { status: { in: ["confirmed", "paid", "partially_paid", "checked_in", "completed"] } } },
    }),
  ]);

  const marginPct = s.gross > 0 ? (s.margin / s.gross) * 100 : 0;

  const metrics: Record<string, HubMetric> = {
    "/dashboard/rentabilidad": { value: `${formatPercent(marginPct)} de margen`, tone: marginPct >= 30 ? "good" : marginPct > 0 ? "warn" : "neutral" },
    "/dashboard/analitica/reportes": { value: "15 reportes listos" },
  };

  return (
    <DomainHub
      domain={domainBySlug("analitica")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Venta bruta", value: formatCompactMoney(s.gross, currency), icon: "TrendingUp", tone: "primary", hint: `${c.bookings} reservas contabilizadas` },
        { label: "Costo directo", value: formatCompactMoney(s.cost, currency), icon: "Calculator", hint: "Costos cargados en las reservas" },
        { label: "Margen", value: formatCompactMoney(s.margin, currency), icon: "Percent", tone: "amber", hint: `${formatPercent(marginPct)} sobre la venta` },
        { label: "Productos vivos", value: String(c.products), icon: "Ticket", hint: "Catálogo activo analizado" },
      ]}
    />
  );
}
