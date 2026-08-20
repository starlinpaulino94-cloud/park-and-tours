import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, sumMany, plural } from "@/lib/hub-stats";
import { formatCompactMoney } from "@/lib/format";

export default async function DistribucionHub() {
  const ctx = await requireTenant();
  const currency = ctx.company?.base_currency || "usd";

  const [c, s] = await Promise.all([
    countMany(ctx.companyId, {
      partners: { table: "partner", filter: { status: "active" } },
      allotments: { table: "allotment", filter: { status: "active" } },
      rules: { table: "commission_rule", filter: { status: "active" } },
      pending: { table: "commission", filter: { status: { in: ["pending", "approved"] } } },
      settlements: { table: "settlement", filter: { status: { in: ["pending", "approved", "partially_paid"] } } },
      integrations: { table: "integration", filter: { status: "connected" } },
    }),
    sumMany(ctx.companyId, {
      owed: { table: "commission", field: "amount", filter: { status: { in: ["pending", "approved"] } } },
    }),
  ]);

  const metrics: Record<string, HubMetric> = {
    "/dashboard/partners": { value: plural(c.partners, "socio activo", "socios activos"), tone: c.partners > 0 ? "good" : "neutral" },
    "/portal": { value: "Vista del socio" },
    "/dashboard/distribucion/allotments": { value: plural(c.allotments, "cupo asignado", "cupos asignados") },
    "/dashboard/distribucion/reglas": { value: plural(c.rules, "regla activa", "reglas activas"), tone: c.rules === 0 ? "warn" : "neutral" },
    "/dashboard/comisiones": { value: plural(c.pending, "por liquidar", "por liquidar"), tone: c.pending > 0 ? "warn" : "good" },
    "/dashboard/liquidaciones": { value: plural(c.settlements, "corte abierto", "cortes abiertos") },
  };

  return (
    <DomainHub
      domain={domainBySlug("distribucion")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Socios activos", value: String(c.partners), icon: "Handshake", tone: "primary" },
        { label: "Comisión por pagar", value: formatCompactMoney(s.owed, currency), icon: "Percent", tone: "amber", hint: `${c.pending} comisiones devengadas` },
        { label: "Cortes abiertos", value: String(c.settlements), icon: "FileSpreadsheet", hint: "En borrador, revisión o aprobados" },
        { label: "Integraciones", value: String(c.integrations), icon: "Plug", hint: "Canales conectados" },
      ]}
    />
  );
}
