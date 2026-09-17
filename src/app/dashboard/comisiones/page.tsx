"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { KpiCard } from "@/components/tf/kpi-card";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResourcePage } from "@/components/tf/resource-page";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ADJUSTMENT_REASON, BENEFICIARY_TYPE, COMMISSION_BENEFICIARIES, CALC_TYPE, COMMISSION_STATUS, GENERIC_STATUS, CHANNEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";

interface Commission {
  _id: string; beneficiary_type?: string; beneficiary_name?: string;
  base_amount?: number; amount?: number; percentage?: number; currency?: string;
  status?: string; generated_at?: string; approved_at?: string; notes?: string;
  booking?: any; seller?: any; partner?: any; rule?: any;
  // 0059 — el desglose legible y el neto tras los ajustes firmados.
  breakdown?: string; adjustment_total?: number; net_amount?: number;
}

const BULK_ACTIONS = [
  { value: "approved", label: "Aprobar", icon: "CheckCheck" },
  { value: "held", label: "Retener", icon: "PauseCircle" },
  { value: "disputed", label: "Marcar en disputa", icon: "TriangleAlert" },
  { value: "cancelled", label: "Anular", icon: "Ban" },
];

function CommissionList() {
  const [rows, setRows] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("__all");
  const [typeFilter, setTypeFilter] = useState("__all");
  const [confirm, setConfirm] = useState<{ status: string; label: string } | null>(null);
  /**
   * La comisión que se está ajustando (0059).
   *
   * Una comisión PAGADA no se anula —el dinero salió— y hasta aquí eso dejaba
   * a quien la gestiona sin ninguna acción posible: la veía, sabía que estaba
   * mal, y lo único que podía hacer era llamar por teléfono.
   */
  const [adjusting, setAdjusting] = useState<Commission | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustCode, setAdjustCode] = useState("correction");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (statusFilter !== "__all") params.set("filter.status", statusFilter);
    if (typeFilter !== "__all") params.set("filter.beneficiary_type", typeFilter);

    const res = await api.get<Commission[]>(`/api/erp/commission?${params}`);
    setLoading(false);
    if (!res.ok) {
      console.error("[comisiones] error cargando el listado:", res.error);
      toast.error(res.error?.message || "No se pudieron cargar las comisiones");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setSelected(new Set());
  }, [statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const applyBulk = async () => {
    if (!confirm) return;
    setBusy(true);
    const res = await api.post<{ updated: number; skipped: number; amount: number }>("/api/commissions/bulk", {
      ids: [...selected], status: confirm.status,
    });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      console.error("[comisiones] error en la acción masiva:", res.error);
      toast.error(res.error?.message || "No se pudo actualizar las comisiones");
      return;
    }
    const { updated = 0, skipped = 0 } = res.data || {};
    toast.success(`${updated} comisión${updated === 1 ? "" : "es"} actualizada${updated === 1 ? "" : "s"}${skipped > 0 ? ` · ${skipped} omitidas por estar liquidadas` : ""}`);
    load();
  };

  const saveAdjustment = async () => {
    if (!adjusting) return;
    setBusy(true);
    const res = await api.post("/api/commissions/adjust", {
      commission_id: adjusting._id,
      amount: Number(adjustAmount),
      reason: adjustReason,
      reason_code: adjustCode,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo guardar el ajuste");
      return;
    }
    toast.success("Ajuste guardado. La comisión conserva su importe y su historia.");
    setAdjusting(null);
    setAdjustAmount("");
    setAdjustReason("");
    setAdjustCode("correction");
    load();
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const currency = rows[0]?.currency || "usd";
  const sum = (list: Commission[]) => list.reduce((s, c) => s + (c.amount ?? 0), 0);
  const pending = rows.filter((c) => c.status === "pending");
  const approved = rows.filter((c) => c.status === "approved");
  const settled = rows.filter((c) => ["settled", "paid"].includes(c.status || ""));
  const selectedAmount = sum(rows.filter((c) => selected.has(c._id)));

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="amber" icon="Clock" label="Pendientes de aprobar" value={formatMoney(sum(pending), currency)}
          hint={`${formatNumber(pending.length)} comisiones`} />
        <KpiCard tone="primary" icon="CheckCheck" label="Aprobadas" value={formatMoney(sum(approved), currency)}
          hint="Listas para incluir en una liquidación" />
        <KpiCard tone="ink" icon="FileSpreadsheet" label="Liquidadas" value={formatMoney(sum(settled), currency)}
          hint={`${formatNumber(settled.length)} comisiones cerradas`} />
        <KpiCard icon="Percent" label="Comisión media"
          value={formatPercent(rows.length ? rows.reduce((s, c) => s + (c.percentage ?? 0), 0) / rows.length : 0)}
          hint="Sobre la base imponible de la venta" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Estado: todos</SelectItem>
            {optionsFrom(COMMISSION_STATUS).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Beneficiario: todos</SelectItem>
            {optionsFrom(BENEFICIARY_TYPE, [...COMMISSION_BENEFICIARIES]).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
          <Icon name="RefreshCw" className="size-4" />
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="tf-card flex flex-wrap items-center gap-3 border-primary/40 bg-primary/5 px-4 py-3">
          <p className="text-sm font-semibold">
            {selected.size} seleccionada{selected.size === 1 ? "" : "s"} · {formatMoney(selectedAmount, currency)}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            {BULK_ACTIONS.map((a) => (
              <Button key={a.value} size="sm" variant={a.value === "approved" ? "default" : "outline"} className="gap-1.5"
                onClick={() => setConfirm({ status: a.value, label: a.label })}>
                <Icon name={a.icon} className="size-4" /> {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <DataTable
        rows={rows}
        loading={loading}
        emptyIcon="Percent"
        emptyTitle="Todavía no hay comisiones"
        emptyDescription="Las comisiones se generan automáticamente con cada venta, según las reglas configuradas."
        columns={[
          {
            key: "__select", header: "",
            render: (c: Commission) => (
              <div onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selected.has(c._id)} onCheckedChange={() => toggle(c._id)} aria-label="Seleccionar comisión" />
              </div>
            ),
          },
          {
            key: "beneficiary", header: "Beneficiario",
            render: (c: Commission) => {
              const s = c.seller;
              const p = c.partner;
              const name = c.beneficiary_name
                || (s && typeof s === "object" ? [s.first_name, s.last_name].filter(Boolean).join(" ") : null)
                || (p && typeof p === "object" ? p.commercial_name || p.name : null)
                || "Sin beneficiario";
              return (
                <div>
                  <p className="font-semibold">{name}</p>
                  <Pill tone="neutral" className="mt-1">{BENEFICIARY_TYPE[c.beneficiary_type || ""]?.label || c.beneficiary_type}</Pill>
                </div>
              );
            },
          },
          {
            key: "booking", header: "Reserva", hideOn: "md",
            render: (c: Commission) => {
              const b = c.booking;
              if (!b || typeof b !== "object") return "—";
              return (
                <div className="text-xs">
                  <p className="font-medium">{b.booking_number}</p>
                  <p className="text-muted-foreground">{typeof b.product === "object" ? b.product?.name : ""}</p>
                </div>
              );
            },
          },
          { key: "rule", header: "Regla", hideOn: "lg",
            render: (c: Commission) => <span className="text-xs text-muted-foreground">{typeof c.rule === "object" && c.rule ? c.rule.name : "Por defecto"}</span> },
          { key: "base", header: "Base", align: "right", hideOn: "lg", render: (c: Commission) => formatMoney(c.base_amount ?? 0, c.currency) },
          { key: "pct", header: "%", align: "right", hideOn: "sm", render: (c: Commission) => formatPercent(c.percentage ?? 0) },
          { key: "amount", header: "Comisión", align: "right",
            render: (c: Commission) => (
              <div>
                <span className="font-semibold">{formatMoney(c.amount ?? 0, c.currency)}</span>
                {/* El ajuste se enseña AL LADO del importe, no en su lugar: las
                    dos cifras juntas son justamente lo que hace defendible una
                    liquidación de hace seis semanas. */}
                {!!c.adjustment_total && (
                  <p className="text-xs text-coral">
                    {c.adjustment_total > 0 ? "+" : ""}{formatMoney(c.adjustment_total, c.currency)} en ajustes
                  </p>
                )}
              </div>
            ) },
          { key: "net", header: "A pagar", align: "right", hideOn: "sm",
            render: (c: Commission) => (
              <span className={c.adjustment_total ? "font-semibold text-primary" : ""}>
                {formatMoney(c.net_amount ?? c.amount ?? 0, c.currency)}
              </span>
            ) },
          { key: "breakdown", header: "Por qué", hideOn: "lg",
            render: (c: Commission) => (
              // La frase que cierra la discusión por WhatsApp. Sin desglose es
              // una comisión de antes de 0059, y se dice en vez de dejar vacío.
              <span className="text-xs text-muted-foreground">{c.breakdown || "Sin desglose"}</span>
            ) },
          { key: "date", header: "Generada", align: "right", hideOn: "lg", render: (c: Commission) => <span className="text-xs">{formatDate(c.generated_at)}</span> },
          { key: "status", header: "Estado", render: (c: Commission) => <StatusBadge value={c.status} dict={COMMISSION_STATUS} /> },
          {
            key: "__adjust", header: "", align: "right",
            render: (c: Commission) => (
              <Button size="sm" variant="ghost" title="Ajustar con signo"
                onClick={(e) => { e.stopPropagation(); setAdjusting(c); }}>
                <Icon name="Scale" className="size-4" />
              </Button>
            ),
          },
        ]}
        footer={
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={allSelected}
                onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r._id)))} />
              Seleccionar todo
            </label>
            <span className="text-xs text-muted-foreground">
              {rows.length} comisiones · {formatMoney(sum(rows), currency)}
            </span>
          </div>
        }
      />

      {/* ------------------------------------------- el ajuste firmado (0059) */}
      <Dialog open={!!adjusting} onOpenChange={(v) => !v && setAdjusting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar la comisión de {adjusting?.beneficiary_name || "este beneficiario"}</DialogTitle>
            <DialogDescription>
              El importe original no se toca. Un ajuste es un movimiento con signo que se suma al lado:
              así quedan las dos cifras a la vista y la liquidación de hace seis semanas se puede defender.
              Corregir un ajuste se hace con otro ajuste.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
              Comisión: <strong>{formatMoney(adjusting?.amount ?? 0, adjusting?.currency)}</strong>
              {!!adjusting?.adjustment_total && (
                <> · ajustes: <strong>{formatMoney(adjusting.adjustment_total, adjusting.currency)}</strong></>
              )}
              {" · "}a pagar hoy:{" "}
              <strong>{formatMoney(adjusting?.net_amount ?? adjusting?.amount ?? 0, adjusting?.currency)}</strong>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-amount">Importe del ajuste</Label>
              <Input id="adj-amount" type="number" step="0.01" value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)} placeholder="-30.00" />
              <p className="text-xs text-muted-foreground">
                En negativo descuenta, en positivo añade. Un ajuste de cero no ajusta nada.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Select value={adjustCode} onValueChange={setAdjustCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {optionsFrom(ADJUSTMENT_REASON).map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">Explicación</Label>
              <Textarea id="adj-reason" rows={2} value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="El grupo canceló el 14 y la comisión ya se había pagado en la liquidación de septiembre." />
              <p className="text-xs text-muted-foreground">
                Dentro de un mes, un movimiento sin motivo es un descuadre que nadie sabe explicar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjusting(null)}>Cancelar</Button>
            <Button onClick={saveAdjustment} disabled={busy}>{busy ? "Guardando…" : "Guardar el ajuste"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.label} {selected.size} comisión{selected.size === 1 ? "" : "es"}</AlertDialogTitle>
            <AlertDialogDescription>
              El importe nunca se recalcula: el snapshot financiero de cada comisión es inmutable. Las comisiones
              ya liquidadas se omitirán automáticamente. La acción queda registrada en la auditoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={applyBulk} disabled={busy}>{busy ? "Aplicando…" : confirm?.label}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CommissionRules() {
  return (
    <ResourcePage
      embedded
      resource="commission_rule"
      title="Reglas de comisión"
      description="Se evalúan por prioridad: gana la de número más bajo que encaje con la venta. Sin regla aplicable se usa el porcentaje por defecto del partner o vendedor."
      createLabel="Nueva regla"
      searchPlaceholder="Buscar regla…"
      emptyIcon="Percent"
      emptyTitle="Todavía no hay reglas de comisión"
      emptyDescription="Crea reglas por producto, partner, vendedor o canal para automatizar el cálculo."
      initialSort="priority"
      columns={[
        {
          key: "name", header: "Regla",
          render: (r: any) => (
            <div>
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-muted-foreground">{r.description || "Sin descripción"}</p>
            </div>
          ),
        },
        { key: "priority", header: "Prioridad", align: "center",
          render: (r: any) => <Pill tone="neutral">{r.priority ?? 100}</Pill> },
        { key: "beneficiary", header: "Beneficiario", hideOn: "md",
          render: (r: any) => BENEFICIARY_TYPE[r.beneficiary_type || ""]?.label || r.beneficiary_type || "—" },
        {
          key: "scope", header: "Ámbito", hideOn: "lg",
          render: (r: any) => {
            const parts = [
              typeof r.product === "object" && r.product ? r.product.name : null,
              typeof r.category === "object" && r.category ? r.category.name : null,
              typeof r.partner === "object" && r.partner ? r.partner.commercial_name || r.partner.name : null,
              typeof r.seller === "object" && r.seller ? [r.seller.first_name, r.seller.last_name].filter(Boolean).join(" ") : null,
              r.channel ? CHANNEL[r.channel]?.label || r.channel : null,
            ].filter(Boolean);
            return <span className="text-xs text-muted-foreground">{parts.length ? parts.join(" · ") : "Todas las ventas"}</span>;
          },
        },
        { key: "calc", header: "Cálculo", hideOn: "sm",
          render: (r: any) => CALC_TYPE[r.calc_type || ""]?.label || r.calc_type || "—" },
        {
          key: "value", header: "Valor", align: "right",
          render: (r: any) => (
            <span className="font-semibold">
              {r.calc_type === "fixed" ? formatMoney(r.value ?? 0, r.currency) : formatPercent(r.value ?? 0)}
            </span>
          ),
        },
        { key: "status", header: "Estado", render: (r: any) => <StatusBadge value={r.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre de la regla", required: true, span: 2 },
        { name: "priority", label: "Prioridad", type: "number", defaultValue: 100,
          help: "Menor número = se evalúa antes. Gana la primera regla que encaje." },
        { name: "beneficiary_type", label: "Beneficiario", type: "select", defaultValue: "partner", options: optionsFrom(BENEFICIARY_TYPE, [...COMMISSION_BENEFICIARIES]) },
        { name: "calc_type", label: "Tipo de cálculo", type: "select", defaultValue: "percentage", options: optionsFrom(CALC_TYPE) },
        { name: "value", label: "Valor", type: "number", required: true, help: "Porcentaje o importe fijo según el tipo de cálculo." },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "channel", label: "Canal", type: "select", options: optionsFrom(CHANNEL) },
        { name: "product", label: "Excursión", type: "reference", resource: "product" },
        { name: "category", label: "Categoría", type: "reference", resource: "product_category" },
        { name: "partner", label: "Partner", type: "reference", resource: "partner", optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "seller", label: "Vendedor", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "min_sales", label: "Ventas mínimas", type: "number" },
        { name: "max_sales", label: "Ventas máximas", type: "number" },
        { name: "season_from", label: "Temporada desde", type: "date" },
        { name: "season_to", label: "Temporada hasta", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
      ]}
    />
  );
}

export default function CommissionsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Red de ventas"
        title="Comisiones"
        description="Cada venta genera su obligación de comisión con el snapshot del cálculo. Aprobar o retener nunca modifica el importe original."
      />
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Comisiones generadas</TabsTrigger>
          <TabsTrigger value="rules">Reglas de cálculo</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-5"><CommissionList /></TabsContent>
        <TabsContent value="rules" className="mt-5"><CommissionRules /></TabsContent>
      </Tabs>
    </div>
  );
}
