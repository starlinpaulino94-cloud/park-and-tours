"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/labels";

const SEVERITY: Record<string, { label: string; tone: Tone; icon: string }> = {
  info: { label: "Informativo", tone: "info", icon: "Info" },
  warning: { label: "Advertencia", tone: "warning", icon: "TriangleAlert" },
  critical: { label: "Crítico", tone: "danger", icon: "ShieldAlert" },
};

/** Human wording for the actions the domain services write to the audit trail. */
const ACTION_LABEL: Record<string, string> = {
  order_created: "Venta creada",
  booking_cancelled: "Reserva cancelada",
  booking_checked_in: "Check-in realizado",
  booking_partial_checkin: "Check-in parcial",
  booking_no_show: "No-show registrado",
  payment_registered: "Cobro registrado",
  refund_registered: "Reembolso registrado",
  cash_session_opened: "Caja abierta",
  cash_session_closed: "Caja cerrada",
  settlement_generated: "Liquidación generada",
  record_deleted: "Registro eliminado",
  company_updated: "Empresa actualizada",
  capacity_override: "Cupo excedido con autorización",
  impersonation_started: "Suplantación iniciada",
  impersonation_stopped: "Suplantación finalizada",
};

export default function AuditPage() {
  return (
    <ResourcePage
      resource="audit_log"
      eyebrow="Sistema"
      title="Auditoría"
      description="Quién hizo qué, cuándo y desde dónde. Los registros de auditoría no se pueden editar ni borrar."
      searchPlaceholder="Buscar por acción, descripción o entidad…"
      emptyIcon="ShieldCheck"
      emptyTitle="Sin eventos registrados"
      emptyDescription="Cada venta, cobro, cancelación y cambio de configuración quedará registrado aquí."
      canWrite={false}
      filters={[
        { name: "severity", label: "Severidad", options: [
          { value: "info", label: "Informativo" },
          { value: "warning", label: "Advertencia" },
          { value: "critical", label: "Crítico" },
        ] },
      ]}
      columns={[
        {
          key: "action", header: "Acción",
          render: (a: any) => {
            const sev = SEVERITY[a.severity || "info"] || SEVERITY.info;
            return (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-muted-foreground"><Icon name={sev.icon} className="size-4" /></span>
                <div className="min-w-0">
                  <p className="font-semibold">{ACTION_LABEL[a.action] || a.action || "Evento"}</p>
                  <p className="text-xs text-muted-foreground">{a.description || "—"}</p>
                </div>
              </div>
            );
          },
        },
        {
          key: "user", header: "Usuario", hideOn: "md",
          render: (a: any) => (
            <div className="text-xs">
              <p className="font-medium">
                {typeof a.user === "object" && a.user ? a.user.name || a.user.email : "Sistema"}
              </p>
              {typeof a.impersonated_by === "object" && a.impersonated_by && (
                <Pill tone="danger" className="mt-1">Suplantado</Pill>
              )}
            </div>
          ),
        },
        { key: "entity", header: "Entidad", hideOn: "lg",
          render: (a: any) => <span className="font-mono text-[11px] text-muted-foreground">{a.entity_type || "—"}</span> },
        { key: "ip", header: "Origen", hideOn: "lg",
          render: (a: any) => <span className="font-mono text-[11px] text-muted-foreground">{a.ip_address || "—"}</span> },
        {
          key: "severity", header: "Severidad", align: "center", hideOn: "sm",
          render: (a: any) => {
            const sev = SEVERITY[a.severity || "info"] || SEVERITY.info;
            return <Pill tone={sev.tone}>{sev.label}</Pill>;
          },
        },
        { key: "when", header: "Fecha", align: "right",
          render: (a: any) => <span className="text-xs">{formatDateTime(a.occurred_at || a.createdAt)}</span> },
      ]}
      fields={[]}
    />
  );
}
