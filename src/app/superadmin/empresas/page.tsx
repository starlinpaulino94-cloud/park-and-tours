"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { KpiCard } from "@/components/tf/kpi-card";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { COMPANY_TYPE, GENERIC_STATUS, MODULE_LABEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";
import type { Company, Plan } from "@/lib/types";

interface Row extends Company {
  usage: { bookings: number; users: number; products: number; storage_mb: number };
}

const SUBSCRIPTION_OPTIONS = optionsFrom(GENERIC_STATUS, ["trial", "active", "past_due", "cancelled", "suspended"]);
const STATUS_OPTIONS = optionsFrom(GENERIC_STATUS, ["active", "inactive", "suspended"]);
const PAGE_SIZE = 50;

export default function SuperadminCompaniesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  const [detail, setDetail] = useState<Row | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [impersonating, setImpersonating] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "", email: "", company_type: "excursion_company",
    base_currency: "usd", plan: "", trial_days: "14",
  });

  // Draft of the tenant being edited in the side sheet.
  const [edit, setEdit] = useState<{
    status: string; subscription_status: string; plan: string;
    trial_ends_at: string; next_billing_at: string; modules: string[]; notes: string;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    return `/api/superadmin/companies?${params.toString()}`;
  }, [search, status, page]);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([
      api.get<Row[]>(url),
      api.get<{ plans: Plan[] }>("/api/superadmin/plans"),
    ]);
    setLoading(false);
    if (!c.ok) {
      console.error("[superadmin/empresas] error listando empresas:", c.error);
      toast.error(c.error?.message || "No se pudieron cargar las empresas");
      setRows([]);
      return;
    }
    setRows(c.data || []);
    setTotal(c.total ?? (c.data || []).length);
    if (p.ok) setPlans(p.data?.plans || []);
    else console.error("[superadmin/empresas] error cargando planes:", p.error);
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const openDetail = (row: Row) => {
    setDetail(row);
    setEdit({
      status: row.status || "active",
      subscription_status: row.subscription_status || "trial",
      plan: typeof row.plan === "object" && row.plan ? row.plan._id : (row.plan as string) || "",
      trial_ends_at: row.trial_ends_at ? row.trial_ends_at.slice(0, 10) : "",
      next_billing_at: row.next_billing_at ? row.next_billing_at.slice(0, 10) : "",
      modules: (row.modules_enabled as string[]) || [],
      notes: row.notes || "",
    });
  };

  const saveDetail = async () => {
    if (!detail || !edit) return;
    setBusy(true);
    const res = await api.post("/api/superadmin/companies", {
      company_id: detail._id,
      status: edit.status,
      subscription_status: edit.subscription_status,
      plan: edit.plan || null,
      trial_ends_at: edit.trial_ends_at ? new Date(edit.trial_ends_at).toISOString() : null,
      next_billing_at: edit.next_billing_at ? new Date(edit.next_billing_at).toISOString() : null,
      modules_enabled: edit.modules,
      notes: edit.notes,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[superadmin/empresas] error guardando la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo guardar la empresa");
      return;
    }
    toast.success("Empresa actualizada");
    setDetail(null);
    load();
  };

  const createCompany = async () => {
    if (!form.name.trim()) { toast.error("El nombre de la empresa es obligatorio"); return; }
    setBusy(true);
    const res = await api.post("/api/superadmin/companies", {
      name: form.name.trim(),
      email: form.email || undefined,
      company_type: form.company_type,
      base_currency: form.base_currency,
      plan: form.plan || undefined,
      trial_days: Number(form.trial_days) || 14,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[superadmin/empresas] error creando la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo crear la empresa");
      return;
    }
    toast.success("Empresa creada con su período de prueba");
    setCreateOpen(false);
    setForm({ name: "", email: "", company_type: "excursion_company", base_currency: "usd", plan: "", trial_days: "14" });
    load();
  };

  const impersonate = async () => {
    if (!impersonating) return;
    setBusy(true);
    const res = await api.post("/api/superadmin/impersonate", { company_id: impersonating._id });
    setBusy(false);
    if (!res.ok) {
      console.error("[superadmin/empresas] error suplantando:", res.error);
      toast.error(res.error?.message || "No se pudo entrar en la empresa");
      return;
    }
    toast.success(`Estás operando dentro de ${impersonating.name}`);
    setImpersonating(null);
    window.location.href = "/dashboard/inicio/mi-dia";
  };

  const toggleModule = (key: string) => {
    setEdit((e) => e && ({
      ...e,
      modules: e.modules.includes(key) ? e.modules.filter((m) => m !== key) : [...e.modules, key],
    }));
  };

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const trialing = rows.filter((r) => r.subscription_status === "trial").length;
  const pastDue = rows.filter((r) => r.subscription_status === "past_due").length;
  const suspended = rows.filter((r) => r.status === "suspended").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plataforma"
        title="Empresas"
        description="Cada empresa es un tenant con sus datos completamente aislados. Desde aquí puedes cambiar su plan, sus módulos o entrar a dar soporte."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Icon name="Plus" className="size-4" /> Nueva empresa
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="ink" icon="Building2" label="Empresas en la vista" value={formatNumber(total)} />
        <KpiCard tone="amber" icon="Hourglass" label="En prueba" value={formatNumber(trialing)} />
        <KpiCard tone={pastDue > 0 ? "coral" : "default"} icon="TriangleAlert" label="Impagadas" value={formatNumber(pastDue)} />
        <KpiCard icon="Ban" label="Suspendidas" value={formatNumber(suspended)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa por nombre…" className="pl-9" />
        </div>
        <Select value={status || "__all"} onValueChange={(v) => { setStatus(v === "__all" ? "" : v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        loading={loading}
        onRowClick={openDetail}
        emptyIcon="Building2"
        emptyTitle="Todavía no hay empresas"
        emptyDescription="Cada registro desde /register crea su propio tenant, o puedes darlo de alta manualmente."
        columns={[
          { key: "name", header: "Empresa", render: (c: any) => (
            <div>
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {COMPANY_TYPE[c.company_type || ""]?.label || "Empresa"}
                {c.email ? ` · ${c.email}` : ""}
              </p>
            </div>
          ) },
          { key: "plan", header: "Plan", hideOn: "md", render: (c: any) =>
            typeof c.plan === "object" && c.plan
              ? <Pill tone="violet">{c.plan.name}</Pill>
              : <span className="text-xs text-muted-foreground">Sin plan</span> },
          { key: "users", header: "Usuarios", align: "right", hideOn: "lg", render: (c: Row) => formatNumber(c.usage.users) },
          { key: "bookings", header: "Reservas", align: "right", hideOn: "lg", render: (c: Row) => formatNumber(c.usage.bookings) },
          { key: "products", header: "Productos", align: "right", hideOn: "lg", render: (c: Row) => formatNumber(c.usage.products) },
          { key: "billing", header: "Facturación", hideOn: "md", render: (c: any) => (
            <div className="text-xs">
              {c.next_billing_at
                ? <p>Próxima: {formatDate(c.next_billing_at)}</p>
                : <p className="text-muted-foreground">Sin fecha</p>}
              {c.subscription_status === "trial" && c.trial_ends_at && (
                <p className="text-muted-foreground">Prueba hasta {formatDate(c.trial_ends_at)}</p>
              )}
            </div>
          ) },
          { key: "subscription", header: "Suscripción",
            render: (c: any) => <StatusBadge value={c.subscription_status} dict={GENERIC_STATUS} /> },
          { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={GENERIC_STATUS} /> },
          { key: "__actions", header: "", align: "right", render: (c: Row) => (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Entrar en la empresa"
                onClick={() => setImpersonating(c)}>
                <Icon name="LogIn" className="size-3.5" />
              </Button>
            </div>
          ) },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {total} empresa{total === 1 ? "" : "s"} · página {page + 1} de {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
            </div>
          </div>
        }
      />

      {/* ---------------------------------------------------------- detail */}
      <Sheet open={!!detail} onOpenChange={(v) => { if (!v) { setDetail(null); setEdit(null); } }}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          {detail && edit && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">{detail.name}</SheetTitle>
                <SheetDescription>
                  {COMPANY_TYPE[detail.company_type || ""]?.label || "Empresa"} · alta {formatDate(detail.createdAt)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Usuarios" value={formatNumber(detail.usage.users)} />
                  <Metric label="Reservas" value={formatNumber(detail.usage.bookings)} />
                  <Metric label="Productos" value={formatNumber(detail.usage.products)} />
                  <Metric label="Almacenamiento" value={`${formatNumber(detail.usage.storage_mb, 1)} MB`} />
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Plan contratado</Label>
                    <Select value={edit.plan || "__none"} onValueChange={(v) => setEdit({ ...edit, plan: v === "__none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sin plan</SelectItem>
                        {plans.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {p.name} — {formatMoney(p.monthly_price ?? 0, p.currency)}/mes
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Estado de la suscripción</Label>
                      <Select value={edit.subscription_status} onValueChange={(v) => setEdit({ ...edit, subscription_status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SUBSCRIPTION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Estado de la cuenta</Label>
                      <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Fin del período de prueba</Label>
                      <Input type="date" value={edit.trial_ends_at} onChange={(e) => setEdit({ ...edit, trial_ends_at: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Próxima facturación</Label>
                      <Input type="date" value={edit.next_billing_at} onChange={(e) => setEdit({ ...edit, next_billing_at: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Módulos habilitados</Label>
                    <p className="text-xs text-muted-foreground">
                      Los módulos deshabilitados desaparecen del menú del tenant y sus endpoints dejan de estar accesibles.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(MODULE_LABEL).map(([key, label]) => (
                        <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-[13px]">
                          <Checkbox checked={edit.modules.includes(key)} onCheckedChange={() => toggleModule(key)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Notas internas</Label>
                    <Textarea rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveDetail} disabled={busy} className="gap-1.5">
                    <Icon name="Save" className="size-4" /> {busy ? "Guardando…" : "Guardar cambios"}
                  </Button>
                  <Button variant="outline" className="gap-1.5" onClick={() => setImpersonating(detail)}>
                    <Icon name="LogIn" className="size-4" /> Entrar en la empresa
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------------------------------------------------- create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva empresa</DialogTitle>
            <DialogDescription>
              Se crea el tenant con su período de prueba. El propietario podrá registrarse y completar el onboarding.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nombre comercial</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Caribe Adventures" />
            </div>
            <div className="space-y-1.5">
              <Label>Email de contacto</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de negocio</Label>
              <Select value={form.company_type} onValueChange={(v) => setForm({ ...form, company_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(COMPANY_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Moneda base</Label>
              <Select value={form.base_currency} onValueChange={(v) => setForm({ ...form, base_currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={form.plan || "__none"} onValueChange={(v) => setForm({ ...form, plan: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin plan</SelectItem>
                  {plans.map((p) => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Días de prueba</Label>
              <Input type="number" value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={createCompany} disabled={busy}>{busy ? "Creando…" : "Crear empresa"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------- impersonate */}
      <AlertDialog open={!!impersonating} onOpenChange={(v) => !v && setImpersonating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Entrar en {impersonating?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Operarás dentro de la empresa como superadministrador. La suplantación nunca es invisible:
              se muestra un aviso permanente en la interfaz y cada acción queda registrada en la auditoría
              con tu usuario.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={impersonate} disabled={busy}>Entrar y auditar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="tf-card p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 tf-num text-lg">{value}</p>
    </div>
  );
}
