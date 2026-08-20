import { requireTenant } from "@/lib/tenant";
import { DomainHub, type HubMetric } from "@/components/tf/domain-hub";
import { domainBySlug } from "@/lib/nav";
import { countMany, todayRange, inDays, plural } from "@/lib/hub-stats";

export default async function EquipoHub() {
  const ctx = await requireTenant();
  const today = todayRange();

  const c = await countMany(ctx.companyId, {
    staff: { table: "staff", filter: { status: "active" } },
    certs: { table: "certification", filter: { status: "valid" } },
    certsExpiring: { table: "certification", filter: { expires_at: { lte: inDays(30) }, status: { in: ["valid", "expiring"] } } },
    certsBlocking: { table: "certification", filter: { status: "expired", blocks_assignment: "yes" } },
    shiftsToday: { table: "shift", filter: { shift_date: today } },
    shiftsUnconfirmed: { table: "shift", filter: { shift_date: today, status: { in: ["planned", "published"] } } },
    attendanceToday: { table: "attendance", filter: { attendance_date: today } },
    absentToday: { table: "attendance", filter: { attendance_date: today, status: { in: ["absent", "late"] } } },
    docs: { table: "document", filter: { status: "published" } },
    docsPendingAck: { table: "document", filter: { status: "published", requires_ack: "yes" } },
    acks: { table: "document_ack" },
  });

  const metrics: Record<string, HubMetric> = {
    "/dashboard/personal": { value: plural(c.staff, "persona activa", "personas activas"), tone: c.staff > 0 ? "good" : "neutral" },
    "/dashboard/equipo/certificaciones": { value: c.certsBlocking > 0 ? plural(c.certsBlocking, "vencida bloquea", "vencidas bloquean") : plural(c.certsExpiring, "por vencer", "por vencer"), tone: c.certsBlocking > 0 ? "bad" : c.certsExpiring > 0 ? "warn" : "good" },
    "/dashboard/equipo/turnos": { value: plural(c.shiftsToday, "turno hoy", "turnos hoy"), tone: c.shiftsUnconfirmed > 0 ? "warn" : "good" },
    "/dashboard/equipo/asistencia": { value: c.absentToday > 0 ? plural(c.absentToday, "ausencia o retraso", "ausencias o retrasos") : plural(c.attendanceToday, "marcaje hoy", "marcajes hoy"), tone: c.absentToday > 0 ? "warn" : "good" },
    "/dashboard/equipo/documentos": { value: plural(c.docs, "documento publicado", "documentos publicados") },
    "/dashboard/equipo/acuses": { value: plural(c.acks, "acuse", "acuses") },
  };

  return (
    <DomainHub
      domain={domainBySlug("equipo")!}
      role={ctx.role}
      modules={ctx.company?.modules_enabled}
      companyType={ctx.company?.company_type}
      metrics={metrics}
      kpis={[
        { label: "Personal activo", value: String(c.staff), icon: "IdCard", tone: "primary" },
        { label: "Turnos hoy", value: String(c.shiftsToday), icon: "BriefcaseBusiness", hint: `${c.shiftsUnconfirmed} sin confirmar` },
        { label: "Certificaciones por vencer", value: String(c.certsExpiring), icon: "Award", tone: c.certsBlocking > 0 ? "coral" : "amber", hint: "Próximos 30 días" },
        { label: "Documentos obligatorios", value: String(c.docsPendingAck), icon: "FolderOpen", hint: `${c.acks} acuses registrados` },
      ]}
    />
  );
}
