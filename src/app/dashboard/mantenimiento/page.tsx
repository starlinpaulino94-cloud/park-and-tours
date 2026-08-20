import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, sumMany, inDays, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function MantenimientoHub() {
  const ctx = await requireTenant();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      assets: { table: "asset", filter: { status: "active" } },
      inService: { table: "asset", filter: { operational_status: "in_service" } },
      down: { table: "asset", filter: { operational_status: { in: ["out_of_service", "maintenance"] } } },
      blocking: { table: "asset", filter: { operational_status: "out_of_service", blocks_capacity: "yes" } },
      ordersOpen: { table: "work_order", filter: { status: { in: ["open", "assigned", "in_progress", "waiting_parts", "waiting_approval"] } } },
      ordersUrgent: { table: "work_order", filter: { priority: "urgent", status: { in: ["open", "assigned", "in_progress"] } } },
      plans: { table: "maintenance_plan", filter: { status: "active" } },
      plansDue: { table: "maintenance_plan", filter: { status: "active", next_due_at: { lte: inDays(7) } } },
      spares: { table: "inventory_item", filter: { item_type: "spare_part", status: "active" } },
    }),
    sumMany(ctx.companyId, {
      cost: { table: "work_order", field: "total_cost", filter: { status: { in: ["done", "verified"] } } },
      downtime: { table: "asset", field: "downtime_minutes_month" },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/mantenimiento/activos": { value: `${c.inService}/${c.assets} en servicio`, tone: c.down > 0 ? "warn" : "good" },
    "/dashboard/mantenimiento/fuera-de-servicio": { value: c.blocking > 0 ? plural(c.blocking, "bloquea cupos", "bloquean cupos") : "Sin bloqueos", tone: c.blocking > 0 ? "bad" : "good" },
    "/dashboard/mantenimiento/ordenes": { value: plural(c.ordersOpen, "orden abierta", "órdenes abiertas"), tone: c.ordersUrgent > 0 ? "bad" : c.ordersOpen > 0 ? "warn" : "good" },
    "/dashboard/mantenimiento/planes": { value: c.plansDue > 0 ? plural(c.plansDue, "por vencer", "por vencer") : plural(c.plans, "plan activo", "planes activos"), tone: c.plansDue > 0 ? "warn" : "neutral" },
    "/dashboard/mantenimiento/repuestos": { value: plural(c.spares, "repuesto", "repuestos") },
  };

  return (
    <DomainHub
      domain={domainBySlug("mantenimiento")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Activos en servicio", value: `${c.inService}/${c.assets}`, icon: "Cog", tone: "primary", hint: c.blocking > 0 ? `${c.blocking} bloquean venta` : "Sin impacto en cupos" },
        { label: "Órdenes abiertas", value: String(c.ordersOpen), icon: "Wrench", tone: c.ordersUrgent > 0 ? "coral" : "default", hint: `${c.ordersUrgent} urgentes` },
        { label: "Preventivos por vencer", value: String(c.plansDue), icon: "CalendarClock", tone: "amber", hint: "Próximos 7 días" },
        { label: "Costo de mantenimiento", value: formatCompactMoney(s.cost, currency), icon: "Receipt", hint: `${Math.round(s.downtime / 60)} h de downtime en el mes` },
      ]}
    />
  );
}
