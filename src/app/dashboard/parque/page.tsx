import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, sumMany, todayRange, plural } from "@/lib/hub-stats";

export default async function ParqueHub() {
  const ctx = await requireTenant();
  const today = todayRange();

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      attractions: { table: "attraction", filter: { status: "active" } },
      open: { table: "attraction", filter: { operational_status: "open" } },
      down: { table: "attraction", filter: { operational_status: { in: ["paused", "closed", "maintenance", "weather_hold"] } } },
      logsToday: { table: "attraction_log", filter: { logged_at: today } },
      zones: { table: "zone", filter: { status: "active" } },
      tickets: { table: "access_ticket", filter: { status: { in: ["issued", "active", "partially_used"] } } },
      incidentsOpen: { table: "incident", filter: { status: { in: ["open", "investigating", "action_required", "escalated"] } } },
      actionsPending: { table: "incident_action", filter: { status: { in: ["pending", "in_progress"] } } },
      waivers: { table: "waiver", filter: { status: "signed" } },
      templates: { table: "waiver_template", filter: { status: "active" } },
      inspectionsToday: { table: "inspection", filter: { performed_at: today } },
      checklists: { table: "inspection_template", filter: { status: "active" } },
      failedInspections: { table: "inspection", filter: { result: "fail" } },
    }),
    sumMany(ctx.companyId, {
      guests: { table: "attraction", field: "guests_today" },
      occupancy: { table: "zone", field: "current_occupancy" },
      capacity: { table: "zone", field: "max_capacity" },
    }),
  ]);

  const occupancyPct = s.capacity > 0 ? Math.round((s.occupancy / s.capacity) * 100) : 0;

  const metrics: Record<string, HubMetric> = {
    "/dashboard/parque/control": { value: `${c.open}/${c.attractions} operando`, tone: c.down > 0 ? "warn" : "good" },
    "/dashboard/parque/atracciones": { value: plural(c.attractions, "atracción", "atracciones") },
    "/dashboard/parque/bitacora": { value: plural(c.logsToday, "evento hoy", "eventos hoy") },
    "/dashboard/parque/zonas": { value: `${occupancyPct}% de aforo`, tone: occupancyPct > 85 ? "bad" : occupancyPct > 65 ? "warn" : "good" },
    "/dashboard/parque/accesos": { value: plural(c.tickets, "pase vigente", "pases vigentes") },
    "/dashboard/parque/incidentes": { value: plural(c.incidentsOpen, "abierto", "abiertos"), tone: c.incidentsOpen > 0 ? "bad" : "good" },
    "/dashboard/parque/acciones": { value: plural(c.actionsPending, "pendiente", "pendientes"), tone: c.actionsPending > 0 ? "warn" : "good" },
    "/dashboard/parque/waivers": { value: plural(c.waivers, "firmado", "firmados") },
    "/dashboard/parque/waivers-plantillas": { value: plural(c.templates, "plantilla activa", "plantillas activas"), tone: c.templates === 0 ? "warn" : "neutral" },
    "/dashboard/parque/inspecciones": { value: c.failedInspections > 0 ? plural(c.failedInspections, "con fallo", "con fallo") : plural(c.inspectionsToday, "hoy", "hoy"), tone: c.failedInspections > 0 ? "bad" : "good" },
    "/dashboard/parque/checklists": { value: plural(c.checklists, "checklist activo", "checklists activos") },
  };

  return (
    <DomainHub
      domain={domainBySlug("parque")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Atracciones operando", value: `${c.open}/${c.attractions}`, icon: "FerrisWheel", tone: "primary", hint: c.down > 0 ? `${c.down} fuera de servicio` : "Todo operativo" },
        { label: "Visitantes hoy", value: String(s.guests), icon: "Users", hint: "Suma de conteos por atracción" },
        { label: "Aforo ocupado", value: `${occupancyPct}%`, icon: "Map", tone: occupancyPct > 85 ? "coral" : "default", hint: `${s.occupancy} de ${s.capacity} personas` },
        { label: "Incidentes abiertos", value: String(c.incidentsOpen), icon: "TriangleAlert", tone: c.incidentsOpen > 0 ? "coral" : "default", hint: `${c.actionsPending} acciones pendientes` },
      ]}
    />
  );
}
