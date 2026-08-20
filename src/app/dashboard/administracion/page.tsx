import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, todayRange, plural } from "@/lib/hub-stats";

export default async function AdministracionHub() {
  const ctx = await requireTenant();
  const today = todayRange();

  const c = await countMany(ctx.companyId, {
    branches: { table: "branch", filter: { status: "active" } },
    hotels: { table: "hotel", filter: { status: "active" } },
    approvalsPending: { table: "approval_request", filter: { status: "pending" } },
    auditToday: { table: "audit_log", filter: { occurred_at: today } },
    integrations: { table: "integration", filter: { status: "connected" } },
    integrationsError: { table: "integration", filter: { status: "error" } },
  });

  const metrics: Record<string, HubMetric> = {
    "/dashboard/configuracion": { value: ctx.company?.name || "Empresa" },
    "/dashboard/administracion/sucursales": { value: plural(c.branches, "sucursal", "sucursales") },
    "/dashboard/administracion/hoteles": { value: plural(c.hotels, "hotel", "hoteles") },
    "/dashboard/administracion/aprobaciones": { value: plural(c.approvalsPending, "pendiente", "pendientes"), tone: c.approvalsPending > 0 ? "warn" : "good" },
    "/dashboard/auditoria": { value: plural(c.auditToday, "evento hoy", "eventos hoy") },
    "/dashboard/administracion/integraciones": { value: c.integrationsError > 0 ? plural(c.integrationsError, "con error", "con error") : plural(c.integrations, "conectada", "conectadas"), tone: c.integrationsError > 0 ? "bad" : "good" },
  };

  return (
    <DomainHub
      domain={domainBySlug("administracion")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Aprobaciones pendientes", value: String(c.approvalsPending), icon: "UserCheck", tone: c.approvalsPending > 0 ? "coral" : "primary", hint: "Acciones que esperan autorización" },
        { label: "Sucursales", value: String(c.branches), icon: "Building2", hint: `${c.hotels} hoteles registrados` },
        { label: "Integraciones activas", value: String(c.integrations), icon: "Plug", tone: c.integrationsError > 0 ? "coral" : "default", hint: c.integrationsError > 0 ? `${c.integrationsError} con error` : "Todas sincronizando" },
        { label: "Eventos auditados hoy", value: String(c.auditToday), icon: "ShieldCheck", hint: "Trazabilidad del día" },
      ]}
    />
  );
}
