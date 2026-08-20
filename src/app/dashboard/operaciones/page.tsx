import { requireTenant } from "@/lib/tenant";
import { WorkspaceHub, type HubMetric } from "@/components/tf/workspace-hub";
import { workspaceBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";

export default async function OperacionesHub() {
  const ctx = await requireTenant();
  const today = todayRange();

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      departuresToday: { table: "departure", filter: { departure_at: today } },
      pickupsToday: { table: "pickup", filter: { pickup_time: today } },
      routes: { table: "pickup_route", filter: { status: "active" } },
      vehicles: { table: "vehicle", filter: { status: "active" } },
      resources: { table: "departure_resource", filter: { status: { in: ["planned", "confirmed"] } } },
      staff: { table: "staff", filter: { status: "active" } },
      checkinPending: { table: "booking", filter: { checkin_status: "pending" } },
      assetsDown: { table: "asset", filter: { operational_status: { in: ["maintenance", "out_of_service"] } } },
      workOrdersOpen: { table: "work_order", filter: { status: { in: ["open", "assigned", "in_progress", "waiting_parts", "waiting_approval"] } } },
      plans: { table: "maintenance_plan", filter: { status: "active" } },
      spares: { table: "inventory_item", filter: { item_type: "spare_part", status: "active" } },
      assets: { table: "asset", filter: { status: "active" } },
    }),
    sumMany(ctx.companyId, {
      paxToday: { table: "departure", field: "booked_pax", filter: { departure_at: today } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/operaciones/despacho": { value: plural(c.departuresToday, "salida hoy", "salidas hoy"), tone: c.departuresToday > 0 ? "good" : "neutral" },
    "/dashboard/pickups": { value: plural(c.pickupsToday, "recogida hoy", "recogidas hoy"), tone: c.pickupsToday > 0 ? "warn" : "neutral" },
    "/dashboard/operaciones/rutas": { value: plural(c.routes, "ruta activa", "rutas activas") },
    "/dashboard/transporte": { value: plural(c.vehicles, "vehículo disponible", "vehículos disponibles") },
    "/dashboard/operaciones/recursos": { value: plural(c.resources, "asignación", "asignaciones") },
    "/dashboard/checkin": { value: plural(c.checkinPending, "por registrar", "por registrar"), tone: c.checkinPending > 0 ? "warn" : "good" },
    // Mantenimiento: vive aquí porque sostiene tanto la flota como las instalaciones.
    "/dashboard/mantenimiento/activos": { value: plural(c.assets, "activo registrado", "activos registrados") },
    "/dashboard/mantenimiento/fuera-de-servicio": { value: plural(c.assetsDown, "activo caído", "activos caídos"), tone: c.assetsDown > 0 ? "bad" : "good" },
    "/dashboard/mantenimiento/ordenes": { value: plural(c.workOrdersOpen, "orden abierta", "órdenes abiertas"), tone: c.workOrdersOpen > 0 ? "warn" : "good" },
    "/dashboard/mantenimiento/planes": { value: plural(c.plans, "plan activo", "planes activos") },
    "/dashboard/mantenimiento/repuestos": { value: plural(c.spares, "repuesto", "repuestos") },
  };

  return (
    <WorkspaceHub
      workspace={workspaceBySlug("operaciones")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Salidas hoy", value: String(c.departuresToday), icon: "Radar", tone: "primary" },
        { label: "Pasajeros hoy", value: String(s.paxToday), icon: "Users", hint: "Cupos vendidos en las salidas de hoy" },
        { label: "Recogidas hoy", value: String(c.pickupsToday), icon: "MapPin", tone: "amber" },
        { label: "Activos caídos", value: String(c.assetsDown), icon: "OctagonX", tone: c.assetsDown > 0 ? "coral" : "default", hint: `${c.vehicles} vehículos en servicio · ${c.staff} personas activas` },
      ]}
    />
  );
}
