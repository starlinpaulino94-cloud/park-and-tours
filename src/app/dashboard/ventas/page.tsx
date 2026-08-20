import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function VentasHub() {
  const ctx = await requireTenant();
  const today = todayRange();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      ordersToday: { table: "order", filter: { order_date: today } },
      bookingsPending: { table: "booking", filter: { status: { in: ["pending", "pending_payment", "confirmed", "partially_paid", "paid"] } } },
      departuresToday: { table: "departure", filter: { departure_at: today } },
      quotesOpen: { table: "quote", filter: { status: { in: ["draft", "sent", "negotiating"] } } },
      leadsOpen: { table: "lead", filter: { status: { in: ["new", "contacted", "interested", "quoted", "follow_up"] } } },
      ticketsActive: { table: "access_ticket", filter: { status: { in: ["issued", "active", "partially_used"] } } },
      promosActive: { table: "promotion", filter: { status: "active" } },
      sellers: { table: "seller", filter: { status: "active" } },
      checkinPending: { table: "booking", filter: { checkin_status: "pending" } },
    }),
    sumMany(ctx.companyId, {
      soldToday: { table: "order", field: "total", filter: { order_date: today } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/pos": { value: plural(c.ordersToday, "venta hoy", "ventas hoy"), tone: c.ordersToday > 0 ? "good" : "neutral" },
    "/dashboard/checkin": { value: plural(c.checkinPending, "por registrar", "por registrar"), tone: c.checkinPending > 0 ? "warn" : "good" },
    "/dashboard/ventas/tickets": { value: plural(c.ticketsActive, "ticket vigente", "tickets vigentes") },
    "/dashboard/reservas": { value: plural(c.bookingsPending, "reserva activa", "reservas activas") },
    "/dashboard/salidas": { value: plural(c.departuresToday, "salida hoy", "salidas hoy"), tone: c.departuresToday > 0 ? "good" : "neutral" },
    "/dashboard/ventas/cotizaciones": { value: plural(c.quotesOpen, "cotización abierta", "cotizaciones abiertas"), tone: c.quotesOpen > 0 ? "warn" : "neutral" },
    "/dashboard/crm": { value: plural(c.leadsOpen, "lead abierto", "leads abiertos") },
    "/dashboard/vendedores": { value: plural(c.sellers, "vendedor activo", "vendedores activos") },
    "/dashboard/promociones": { value: plural(c.promosActive, "promoción activa", "promociones activas") },
  };

  return (
    <DomainHub
      domain={domainBySlug("ventas")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Vendido hoy", value: formatCompactMoney(s.soldToday, currency), icon: "TrendingUp", tone: "primary", hint: `${c.ordersToday} transacciones` },
        { label: "Reservas activas", value: String(c.bookingsPending), icon: "CalendarCheck", hint: "Pendientes y confirmadas" },
        { label: "Salidas hoy", value: String(c.departuresToday), icon: "CalendarRange", hint: "Programadas para la fecha" },
        { label: "Pipeline abierto", value: String(c.quotesOpen + c.leadsOpen), icon: "Sparkles", tone: "amber", hint: "Cotizaciones + leads" },
      ]}
    />
  );
}
