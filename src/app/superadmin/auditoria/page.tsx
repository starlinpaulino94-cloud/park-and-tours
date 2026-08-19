"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime, formatNumber, parseJson } from "@/lib/format";
import type { Company } from "@/lib/types";

interface AuditRow {
  _id: string;
  action?: string; entity_type?: string; entity_id?: string;
  description?: string; severity?: string;
  ip_address?: string; user_agent?: string;
  metadata_json?: string; occurred_at?: string; createdAt?: string;
  company?: any; user?: any; impersonated_by?: any;
}

const SEVERITY: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "danger"; icon: string }> = {
  info: { label: "Informativo", tone: "info", icon: "Info" },
  warning: { label: "Advertencia", tone: "warning", icon: "TriangleAlert" },
  critical: { label: "Crítico", tone: "danger", icon: "ShieldAlert" },
};

/** Spanish names for the domain actions the engines write. */
const ACTION_LABEL: Record<string, string> = {
  impersonation_started: "Suplantación iniciada",
  impersonation_stopped: "Suplantación finalizada",
  company_created_by_superadmin: "Empresa creada por soporte",
  company_updated_by_superadmin: "Empresa modificada por soporte",
  company_updated: "Empresa actualizada",
  plan_created: "Plan creado",
  plan_updated: "Plan actualizado",
  plan_deleted: "Plan eliminado",
  order_created: "Venta registrada",
  booking_cancelled: "Reserva cancelada",
  booking_checked_in: "Check-in realizado",
  payment_registered: "Pago registrado",
  cash_session_opened: "Caja abierta",
  cash_session_closed: "Caja cerrada",
  commission_bulk_updated: "Comisiones actualizadas en lote",
  settlement_generated: "Liquidación generada",
  capacity_override: "Cupo forzado",
  record_deleted: "Registro eliminado",
};

const PAGE_SIZE = 100;

export default function SuperadminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (search) params.set("q", search);
    if (severity) params.set("severity", severity);
    if (companyId) params.set("company_id", companyId);
    return `/api/superadmin/audit?${params.toString()}`;
  }, [search, severity, companyId, page]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<AuditRow[]>(url);
    setLoading(false);
    if (!res.ok) {
      console.error("[superadmin/auditoria] error cargando la auditoría:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la auditoría");
      setRows([]);
      return;
    }
    setRows(res.data || []);
  }, [url]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const res = await api.get<Company[]>("/api/superadmin/companies?limit=200");
      if (!res.ok) {
        console.error("[superadmin/auditoria] error cargando empresas para el filtro:", res.error);
        return;
      }
      setCompanies(res.data || []);
    })();
  }, []);

  const critical = rows.filter((r) => r.severity === "critical").length;
  const warnings = rows.filter((r) => r.severity === "warning").length;
  const impersonations = rows.filter((r) => (r.action || "").startsWith("impersonation")).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plataforma"
        title="Auditoría global"
        description="Registro inmutable de todo lo que ocurre en la plataforma, incluidas las sesiones de soporte dentro de un tenant."
        actions={
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="ink" icon="ScrollText" label="Eventos en la vista" value={formatNumber(rows.length)} />
        <KpiCard tone={critical > 0 ? "coral" : "default"} icon="ShieldAlert" label="Críticos" value={formatNumber(critical)} />
        <KpiCard tone="amber" icon="TriangleAlert" label="Advertencias" value={formatNumber(warnings)} />
        <KpiCard icon="Eye" label="Suplantaciones" value={formatNumber(impersonations)}
          hint="Entradas y salidas de soporte" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por acción, descripción o entidad…" className="pl-9" />
        </div>
        <Select value={severity || "__all"} onValueChange={(v) => { setSeverity(v === "__all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Severidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Severidad: todas</SelectItem>
            {Object.entries(SEVERITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={companyId || "__all"} onValueChange={(v) => { setCompanyId(v === "__all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[210px]"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Empresa: todas</SelectItem>
            {companies.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={(r) => setDetail(r)}
        emptyIcon="ShieldCheck"
        emptyTitle="No hay eventos con estos filtros"
        emptyDescription="La auditoría registra cada acción sensible en cuanto ocurre."
        columns={[
          { key: "when", header: "Cuándo", render: (r: AuditRow) => (
            <span className="whitespace-nowrap text-xs">{formatDateTime(r.occurred_at || r.createdAt)}</span>
          ) },
          { key: "severity", header: "Severidad", render: (r: AuditRow) => {
            const def = SEVERITY[r.severity || "info"] || SEVERITY.info;
            return <Pill tone={def.tone}><Icon name={def.icon} className="size-3" /> {def.label}</Pill>;
          } },
          { key: "action", header: "Acción", render: (r: AuditRow) => (
            <div>
              <p className="font-medium">{ACTION_LABEL[r.action || ""] || (r.action || "").replace(/_/g, " ") || "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{r.description || r.entity_type || "—"}</p>
            </div>
          ) },
          { key: "company", header: "Empresa", hideOn: "md",
            render: (r: AuditRow) => (typeof r.company === "object" && r.company ? r.company.name : "Plataforma") },
          { key: "user", header: "Usuario", hideOn: "lg", render: (r: AuditRow) => (
            <div className="text-xs">
              <p>{typeof r.user === "object" && r.user ? r.user.name || r.user.email : "Sistema"}</p>
              {typeof r.impersonated_by === "object" && r.impersonated_by && (
                <p className="text-amber-600 dark:text-amber-400">
                  vía soporte: {r.impersonated_by.email}
                </p>
              )}
            </div>
          ) },
          { key: "ip", header: "IP", hideOn: "lg",
            render: (r: AuditRow) => <span className="font-mono text-[11px]">{r.ip_address || "—"}</span> },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Mostrando {rows.length} eventos · página {page + 1}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={rows.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">
                  {ACTION_LABEL[detail.action || ""] || (detail.action || "").replace(/_/g, " ")}
                </SheetTitle>
                <SheetDescription>{formatDateTime(detail.occurred_at || detail.createdAt)}</SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <Pill tone={(SEVERITY[detail.severity || "info"] || SEVERITY.info).tone}>
                  {(SEVERITY[detail.severity || "info"] || SEVERITY.info).label}
                </Pill>

                {detail.description && <p className="text-sm">{detail.description}</p>}

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Empresa" value={typeof detail.company === "object" && detail.company ? detail.company.name : "Plataforma"} />
                  <Field label="Usuario" value={typeof detail.user === "object" && detail.user ? detail.user.email || detail.user.name : "Sistema"} />
                  <Field label="Entidad" value={detail.entity_type || "—"} />
                  <Field label="ID de la entidad" value={detail.entity_id || "—"} mono />
                  <Field label="IP" value={detail.ip_address || "—"} mono />
                  <Field label="Suplantado por" value={
                    typeof detail.impersonated_by === "object" && detail.impersonated_by
                      ? detail.impersonated_by.email : "—"} />
                </dl>

                {detail.user_agent && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Navegador</p>
                    <p className="break-all text-xs text-muted-foreground">{detail.user_agent}</p>
                  </div>
                )}

                {detail.metadata_json && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Datos del evento</p>
                    <pre className="tf-scroll overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-[11px]">
                      {JSON.stringify(parseJson<Record<string, unknown>>(detail.metadata_json, {}), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs" : "text-sm font-medium"}>{value}</dd>
    </div>
  );
}
