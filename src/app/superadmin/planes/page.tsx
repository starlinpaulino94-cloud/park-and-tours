"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GENERIC_STATUS, MODULE_LABEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";
import type { Plan } from "@/lib/types";

interface PlanRow extends Plan {
  usage: { companies: number; active: number; trial: number; past_due: number; mrr: number; invoiced: number };
}

const EMPTY_DRAFT = {
  name: "", code: "", description: "",
  monthly_price: "", yearly_price: "", currency: "usd",
  max_users: "", max_bookings_month: "", max_products: "", max_storage_mb: "",
  trial_days: "14", is_premium: "no", status: "active", sort_order: "",
  modules: [] as string[],
};

type Draft = typeof EMPTY_DRAFT;

/** The `plan` table only accepts these three currencies for subscription pricing. */
const PLAN_CURRENCIES = CURRENCY_OPTIONS.filter((c) => ["usd", "dop", "eur"].includes(c.value));

export default function SuperadminPlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [deleting, setDeleting] = useState<PlanRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<{ plans: PlanRow[]; invoices: any[]; unassigned_companies: number }>("/api/superadmin/plans");
    setLoading(false);
    if (!res.ok) {
      console.error("[superadmin/planes] error cargando los planes:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar los planes");
      setPlans([]);
      return;
    }
    setPlans(res.data?.plans || []);
    setInvoices(res.data?.invoices || []);
    setUnassigned(res.data?.unassigned_companies || 0);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setOpen(true);
  };

  const startEdit = (plan: PlanRow) => {
    setEditing(plan);
    setDraft({
      name: plan.name || "",
      code: plan.code || "",
      description: plan.description || "",
      monthly_price: plan.monthly_price != null ? String(plan.monthly_price) : "",
      yearly_price: plan.yearly_price != null ? String(plan.yearly_price) : "",
      currency: plan.currency || "usd",
      max_users: plan.max_users != null ? String(plan.max_users) : "",
      max_bookings_month: plan.max_bookings_month != null ? String(plan.max_bookings_month) : "",
      max_products: plan.max_products != null ? String(plan.max_products) : "",
      max_storage_mb: plan.max_storage_mb != null ? String(plan.max_storage_mb) : "",
      trial_days: plan.trial_days != null ? String(plan.trial_days) : "14",
      is_premium: plan.is_premium || "no",
      status: plan.status || "active",
      sort_order: plan.sort_order != null ? String(plan.sort_order) : "",
      modules: (plan.modules_enabled as string[]) || [],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) { toast.error("El nombre del plan es obligatorio"); return; }
    setBusy(true);
    const res = await api.post("/api/superadmin/plans", {
      ...(editing ? { plan_id: editing._id } : {}),
      name: draft.name.trim(),
      code: draft.code.trim() || draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      description: draft.description,
      monthly_price: draft.monthly_price,
      yearly_price: draft.yearly_price,
      currency: draft.currency,
      max_users: draft.max_users,
      max_bookings_month: draft.max_bookings_month,
      max_products: draft.max_products,
      max_storage_mb: draft.max_storage_mb,
      trial_days: draft.trial_days,
      is_premium: draft.is_premium,
      status: draft.status,
      sort_order: draft.sort_order,
      modules_enabled: draft.modules,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[superadmin/planes] error guardando el plan:", res.error);
      toast.error(res.error?.message || "No se pudo guardar el plan");
      return;
    }
    toast.success(editing ? "Plan actualizado" : "Plan creado");
    setOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await api.delete(`/api/superadmin/plans?id=${deleting._id}`);
    setBusy(false);
    if (!res.ok) {
      console.error("[superadmin/planes] error eliminando el plan:", res.error);
      toast.error(res.error?.message || "No se pudo eliminar el plan");
      return;
    }
    toast.success("Plan eliminado");
    setDeleting(null);
    load();
  };

  const toggleModule = (key: string) => {
    setDraft((d) => ({
      ...d,
      modules: d.modules.includes(key) ? d.modules.filter((m) => m !== key) : [...d.modules, key],
    }));
  };

  const mrr = plans.reduce((s, p) => s + p.usage.mrr, 0);
  const subscribed = plans.reduce((s, p) => s + p.usage.companies, 0);
  const invoicedPending = invoices
    .filter((i) => i.status === "pending")
    .reduce((s, i) => s + (i.amount ?? 0), 0);

  const limit = (v?: number | null) => (v == null || v <= 0 ? "Ilimitado" : formatNumber(v));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plataforma"
        title="Planes y suscripciones"
        description="Define qué módulos y qué límites incluye cada plan. Los cambios afectan de inmediato al menú y a los endpoints de las empresas que lo tengan contratado."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
              <Icon name="RefreshCw" className="size-4" />
            </Button>
            <Button className="gap-1.5" onClick={startCreate}>
              <Icon name="Plus" className="size-4" /> Nuevo plan
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard tone="primary" icon="Repeat" label="MRR de planes activos" value={formatMoney(mrr, "usd")} />
        <KpiCard tone="ink" icon="Layers" label="Planes publicados" value={formatNumber(plans.length)} />
        <KpiCard icon="Building2" label="Empresas con plan" value={formatNumber(subscribed)}
          hint={unassigned > 0 ? `${formatNumber(unassigned)} sin plan asignado` : "Todas asignadas"} />
        <KpiCard tone={invoicedPending > 0 ? "coral" : "default"} icon="Hourglass"
          label="Facturas pendientes" value={formatMoney(invoicedPending, "usd")} />
      </div>

      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">Planes</TabsTrigger>
          <TabsTrigger value="invoices">Facturas de suscripción</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-5">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[360px] rounded-xl" />)}
            </div>
          ) : plans.length === 0 ? (
            <EmptyState
              icon="Layers"
              title="Todavía no hay planes"
              description="Crea al menos un plan para poder asignarlo a las empresas y empezar a facturar."
              action={<Button className="gap-1.5" onClick={startCreate}><Icon name="Plus" className="size-4" /> Crear el primer plan</Button>}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((p) => (
                <article key={p._id} className="tf-card tf-rise flex flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                        {p.is_premium === "yes" && <Pill tone="violet"><Icon name="Crown" className="size-3" /> Premium</Pill>}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>
                    </div>
                    <StatusBadge value={p.status} dict={GENERIC_STATUS} />
                  </div>

                  <div>
                    <p className="font-display text-3xl font-semibold tabular-nums">
                      {formatMoney(p.monthly_price ?? 0, p.currency)}
                      <span className="text-sm font-normal text-muted-foreground">/mes</span>
                    </p>
                    {(p.yearly_price ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(p.yearly_price, p.currency)}/año
                      </p>
                    )}
                  </div>

                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}

                  <ul className="space-y-1 text-[13px]">
                    <li className="flex justify-between gap-3"><span className="text-muted-foreground">Usuarios</span><span className="tabular-nums">{limit(p.max_users)}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-muted-foreground">Reservas / mes</span><span className="tabular-nums">{limit(p.max_bookings_month)}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-muted-foreground">Productos</span><span className="tabular-nums">{limit(p.max_products)}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-muted-foreground">Almacenamiento</span><span className="tabular-nums">{p.max_storage_mb ? `${formatNumber(p.max_storage_mb)} MB` : "Ilimitado"}</span></li>
                    <li className="flex justify-between gap-3"><span className="text-muted-foreground">Prueba</span><span className="tabular-nums">{formatNumber(p.trial_days ?? 0)} días</span></li>
                  </ul>

                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Módulos incluidos
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {((p.modules_enabled as string[]) || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Todos los módulos</span>
                      ) : (
                        ((p.modules_enabled as string[]) || []).map((m) => (
                          <Pill key={m} tone="accent">{MODULE_LABEL[m] || m}</Pill>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                    <Metric label="Empresas" value={formatNumber(p.usage.companies)} />
                    <Metric label="Activas" value={formatNumber(p.usage.active)} />
                    <Metric label="MRR" value={formatMoney(p.usage.mrr, p.currency)} />
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => startEdit(p)}>
                      <Icon name="Pencil" className="size-3.5" /> Editar
                    </Button>
                    <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive"
                      aria-label="Eliminar plan" onClick={() => setDeleting(p)}>
                      <Icon name="Trash2" className="size-3.5" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-5">
          <DataTable
            rows={invoices}
            loading={loading}
            emptyIcon="Receipt"
            emptyTitle="Todavía no hay facturas de suscripción"
            emptyDescription="Se generan al cobrar cada período de las empresas suscritas."
            columns={[
              { key: "number", header: "Factura", render: (i: any) => (
                <div>
                  <p className="font-mono text-xs font-semibold">{i.invoice_number || "—"}</p>
                  <p className="text-xs text-muted-foreground">Emitida {formatDate(i.issued_at)}</p>
                </div>
              ) },
              { key: "company", header: "Empresa",
                render: (i: any) => (typeof i.company === "object" && i.company ? i.company.name : "—") },
              { key: "plan", header: "Plan", hideOn: "md",
                render: (i: any) => (typeof i.plan === "object" && i.plan ? i.plan.name : "—") },
              { key: "period", header: "Período", hideOn: "lg",
                render: (i: any) => `${formatDate(i.period_from)} – ${formatDate(i.period_to)}` },
              { key: "amount", header: "Importe", align: "right",
                render: (i: any) => <span className="font-semibold">{formatMoney(i.amount ?? 0, i.currency)}</span> },
              { key: "status", header: "Estado", render: (i: any) => <StatusBadge value={i.status} dict={GENERIC_STATUS} /> },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------------ plan form */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto tf-scroll sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-display text-xl">{editing ? `Editar ${editing.name}` : "Nuevo plan"}</SheetTitle>
            <SheetDescription>
              Un límite en 0 o vacío significa «sin límite». Si no marcas ningún módulo, el plan incluye todos.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 pb-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <Text label="Nombre" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} className="sm:col-span-2" />
              <Text label="Código" value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="starter" />
              <div className="space-y-1.5">
                <Label>Moneda</Label>
                <Select value={draft.currency} onValueChange={(v) => setDraft({ ...draft, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLAN_CURRENCIES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Text label="Precio mensual" value={draft.monthly_price} onChange={(v) => setDraft({ ...draft, monthly_price: v })} type="number" />
              <Text label="Precio anual" value={draft.yearly_price} onChange={(v) => setDraft({ ...draft, yearly_price: v })} type="number" />
              <Text label="Máx. usuarios" value={draft.max_users} onChange={(v) => setDraft({ ...draft, max_users: v })} type="number" />
              <Text label="Máx. reservas / mes" value={draft.max_bookings_month} onChange={(v) => setDraft({ ...draft, max_bookings_month: v })} type="number" />
              <Text label="Máx. productos" value={draft.max_products} onChange={(v) => setDraft({ ...draft, max_products: v })} type="number" />
              <Text label="Máx. almacenamiento (MB)" value={draft.max_storage_mb} onChange={(v) => setDraft({ ...draft, max_storage_mb: v })} type="number" />
              <Text label="Días de prueba" value={draft.trial_days} onChange={(v) => setDraft({ ...draft, trial_days: v })} type="number" />
              <Text label="Orden" value={draft.sort_order} onChange={(v) => setDraft({ ...draft, sort_order: v })} type="number" />
              <div className="space-y-1.5">
                <Label>Plan premium</Label>
                <Select value={draft.is_premium} onValueChange={(v) => setDraft({ ...draft, is_premium: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="yes">Sí</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {optionsFrom(GENERIC_STATUS, ["active", "inactive"]).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Descripción</Label>
                <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Módulos incluidos</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(MODULE_LABEL).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-[13px]">
                    <Checkbox checked={draft.modules.includes(key)} onCheckedChange={() => toggleModule(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={busy} className="gap-1.5">
                <Icon name="Save" className="size-4" /> {busy ? "Guardando…" : "Guardar plan"}
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el plan {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Solo se puede eliminar un plan que ninguna empresa tenga contratado.
              {deleting && deleting.usage.companies > 0
                ? ` Ahora mismo lo usan ${deleting.usage.companies} empresas, así que la operación será rechazada: desactívalo en su lugar.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Text({ label, value, onChange, type = "text", placeholder, className }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
