import { requireTenant } from "@/lib/tenant";
import { WorkspaceHub, type HubMetric } from "@/components/tf/workspace-hub";
import { workspaceBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

/**
 * Resumen de Comercial: reúne en una sola entrada lo que antes eran tres áreas
 * separadas (Ventas, Catálogo y Distribución), porque las tres responden a la
 * misma pregunta del negocio: cómo se genera el ingreso.
 */
export default async function ComercialHub() {
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
      products: { table: "product", filter: { status: "active" } },
      modalities: { table: "product_modality" },
      categories: { table: "product_category" },
      priceRules: { table: "price_rule", filter: { status: "active" } },
      costs: { table: "product_cost" },
      policies: { table: "cancellation_policy" },
      plans: { table: "membership_plan", filter: { status: "active" } },
      partners: { table: "partner", filter: { status: "active" } },
      allotments: { table: "allotment", filter: { status: "active" } },
      rules: { table: "commission_rule", filter: { status: "active" } },
      commissionsPending: { table: "commission", filter: { status: { in: ["pending", "approved"] } } },
      settlements: { table: "settlement", filter: { status: { in: ["pending", "approved", "partially_paid"] } } },
    }),
    sumMany(ctx.companyId, {
      soldToday: { table: "order", field: "total", filter: { order_date: today } },
      commissionOwed: { table: "commission", field: "amount", filter: { status: { in: ["pending", "approved"] } } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    // Ventas
    "/dashboard/pos": { value: plural(c.ordersToday, "venta hoy", "ventas hoy"), tone: c.ordersToday > 0 ? "good" : "neutral" },
    "/dashboard/reservas": { value: plural(c.bookingsPending, "reserva activa", "reservas activas") },
    "/dashboard/salidas": { value: plural(c.departuresToday, "salida hoy", "salidas hoy"), tone: c.departuresToday > 0 ? "good" : "neutral" },
    "/dashboard/ventas/tickets": { value: plural(c.ticketsActive, "ticket vigente", "tickets vigentes") },
    "/dashboard/ventas/cotizaciones": { value: plural(c.quotesOpen, "cotización abierta", "cotizaciones abiertas"), tone: c.quotesOpen > 0 ? "warn" : "neutral" },
    // Pipeline
    "/dashboard/crm": { value: plural(c.leadsOpen, "lead abierto", "leads abiertos") },
    "/dashboard/vendedores": { value: plural(c.sellers, "vendedor activo", "vendedores activos") },
    "/dashboard/promociones": { value: plural(c.promosActive, "promoción activa", "promociones activas") },
    // Catálogo
    "/dashboard/productos": { value: plural(c.products, "producto activo", "productos activos"), tone: c.products > 0 ? "good" : "warn" },
    "/dashboard/catalogo/modalidades": { value: plural(c.modalities, "modalidad", "modalidades") },
    "/dashboard/catalogo/categorias": { value: plural(c.categories, "categoría", "categorías") },
    "/dashboard/catalogo/precios": { value: plural(c.priceRules, "regla vigente", "reglas vigentes") },
    "/dashboard/catalogo/costos": { value: plural(c.costs, "costo cargado", "costos cargados"), tone: c.costs === 0 ? "warn" : "neutral" },
    "/dashboard/catalogo/politicas": { value: plural(c.policies, "política", "políticas") },
    "/dashboard/catalogo/membresias": { value: plural(c.plans, "plan activo", "planes activos") },
    // Distribución
    "/dashboard/partners": { value: plural(c.partners, "socio activo", "socios activos"), tone: c.partners > 0 ? "good" : "neutral" },
    "/dashboard/distribucion/allotments": { value: plural(c.allotments, "cupo asignado", "cupos asignados") },
    "/dashboard/distribucion/reglas": { value: plural(c.rules, "regla activa", "reglas activas"), tone: c.rules === 0 ? "warn" : "neutral" },
    "/dashboard/comisiones": { value: plural(c.commissionsPending, "por liquidar", "por liquidar"), tone: c.commissionsPending > 0 ? "warn" : "good" },
    "/dashboard/liquidaciones": { value: plural(c.settlements, "corte abierto", "cortes abiertos") },
    "/portal": { value: "Vista del socio" },
  };

  return (
    <WorkspaceHub
      workspace={workspaceBySlug("comercial")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Vendido hoy", value: formatCompactMoney(s.soldToday, currency), icon: "TrendingUp", tone: "primary", hint: `${c.ordersToday} transacciones` },
        { label: "Reservas activas", value: String(c.bookingsPending), icon: "CalendarCheck", hint: "Pendientes y confirmadas" },
        { label: "Pipeline abierto", value: String(c.quotesOpen + c.leadsOpen), icon: "Sparkles", tone: "amber", hint: "Cotizaciones + leads" },
        { label: "Comisión por pagar", value: formatCompactMoney(s.commissionOwed, currency), icon: "Percent", tone: "coral", hint: `${c.partners} socios activos` },
      ]}
    />
  );
}
