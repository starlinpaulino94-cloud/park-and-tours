import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
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
      unassigned: { table: "departure", filter: { departure_at: today, status: "available" } },
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
    "/dashboard/personal": { value: plural(c.staff, "persona activa", "personas activas") },
  };

  return (
    <DomainHub
      domain={domainBySlug("operaciones")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Salidas hoy", value: String(c.departuresToday), icon: "Radar", tone: "primary" },
        { label: "Pasajeros hoy", value: String(s.paxToday), icon: "Users", hint: "Cupos vendidos en las salidas de hoy" },
        { label: "Recogidas hoy", value: String(c.pickupsToday), icon: "MapPin", tone: "amber" },
        { label: "Flota disponible", value: String(c.vehicles), icon: "Bus", hint: "Vehículos en servicio" },
      ]}
    />
  );
}
