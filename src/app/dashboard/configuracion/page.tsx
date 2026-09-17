"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/tf/page-header";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge, Pill } from "@/components/tf/status-badge";
import { DataTable } from "@/components/tf/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHANNEL, COMPANY_TYPE, GENERIC_STATUS, MODALITY_TYPE, MODULE_LABEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";
import { passwordIssue, memberState, MEMBER_STATE_LABEL, type MemberState } from "@/lib/team";
import {
  brandColor, readableOn, hasReadableContrast, contrastRatio, brandingGaps,
  logoProblem, LOGO_PROBLEM_MESSAGE, DEFAULT_BRAND_COLOR, MIN_CONTRAST,
} from "@/lib/branding";

/* ------------------------------------------------------------------ company */

function CompanyForm() {
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<any>("/api/company");
    setLoading(false);
    if (!res.ok) {
      console.error("[configuracion] error cargando la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo cargar la empresa");
      return;
    }
    setCompany(res.data || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    const res = await api.put("/api/company", company);
    setBusy(false);
    if (!res.ok) {
      console.error("[configuracion] error guardando la empresa:", res.error);
      toast.error(res.error?.message || "No se pudo guardar la empresa");
      return;
    }
    toast.success("Datos de la empresa actualizados");
    load();
  };

  // Acepta número, booleano y nulo además de texto: `hold_hours` es un entero
  // —mandarlo como cadena vacía lo guardaría como 0, "expira al instante", en
  // vez de "sin límite"— y la página pública es un sí/no.
  const set = (k: string, v: string | number | boolean | null) => setCompany((c: any) => ({ ...c, [k]: v }));

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>;
  }
  if (!company) return <p className="text-sm text-muted-foreground">No se pudo cargar la empresa.</p>;

  const modules = (company.modules_enabled || []) as string[];

  return (
    <div className="space-y-5">
      <section className="tf-card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Nombre comercial" value={company.name} onChange={(v) => set("name", v)} />
        <Field label="Razón social" value={company.legal_name} onChange={(v) => set("legal_name", v)} />
        <Field label="Identificación fiscal" value={company.tax_id} onChange={(v) => set("tax_id", v)} />
        <div className="space-y-1.5">
          <Label>Tipo de negocio</Label>
          <Select value={company.company_type || "other"} onValueChange={(v) => set("company_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {optionsFrom(COMPANY_TYPE).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Field label="Email" value={company.email} onChange={(v) => set("email", v)} type="email" />
        <Field label="Teléfono" value={company.phone} onChange={(v) => set("phone", v)} />
        <Field label="WhatsApp" value={company.whatsapp} onChange={(v) => set("whatsapp", v)} />
        <Field label="Grupo empresarial" value={company.group_name} onChange={(v) => set("group_name", v)} />
        <Field label="Ciudad" value={company.city} onChange={(v) => set("city", v)} />
        <Field label="País" value={company.country} onChange={(v) => set("country", v)} />
        <div className="space-y-1.5">
          <Label>Moneda base</Label>
          <Select value={company.base_currency || "usd"} onValueChange={(v) => set("base_currency", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Toda la contabilidad se consolida en esta moneda. Cambiarla no reconvierte lo ya facturado.
          </p>
        </div>
        <Field label="Zona horaria" value={company.timezone} onChange={(v) => set("timezone", v)} placeholder="America/Santo_Domingo" />
        <div className="space-y-1.5">
          <Label htmlFor="hold-hours">Retener la plaza sin pagar (horas)</Label>
          <Input
            id="hold-hours" type="number" min="0"
            value={company.hold_hours ?? ""}
            onChange={(e) => set("hold_hours", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="Sin límite"
          />
          <p className="text-xs text-muted-foreground">
            Pasado ese plazo sin cobrar nada, la reserva libera su cupo y vuelve a estar a la venta.
            En blanco, nada expira. Una reserva con anticipo pagado nunca se cancela sola.
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Dirección</Label>
          <Textarea rows={2} value={company.address || ""} onChange={(e) => set("address", e.target.value)} />
        </div>

        {/* ------------------------------------------------- la marca (0055) */}
        <div className="sm:col-span-2">
          <Marca company={company} set={set} onSaved={load} />
        </div>
        {/* ------------------------------------------- página pública (0047) */}
        <div className="space-y-3 rounded-xl border border-border p-4 sm:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">Página pública de reservas</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Una página con tu marca donde un cliente elige su excursión, su fecha y pide su lugar sin
                llamar a nadie. Se publican solo las excursiones que marques como «en la web».
              </p>
            </div>
            <Select
              value={company.public_booking_enabled ? "yes" : "no"}
              onValueChange={(v) => set("public_booking_enabled", v === "yes")}
            >
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">Desactivada</SelectItem>
                <SelectItem value="yes">Activada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {company.public_booking_enabled && (
            <>
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">
                Tu dirección:{" "}
                <span className="font-mono">
                  {typeof window !== "undefined" ? window.location.origin : ""}/reservar/{company.slug || "…"}
                </span>
                {!company.slug && " — pide que te asignen un identificador para poder compartirla."}
              </p>
              <div className="space-y-1.5">
                <Label>Texto de bienvenida</Label>
                <Textarea rows={2} value={company.public_intro || ""} onChange={(e) => set("public_intro", e.target.value)}
                  placeholder="Excursiones en Bávaro desde 2011. Recogida en tu hotel." />
              </div>
              <div className="space-y-1.5">
                <Label>Qué ve al terminar</Label>
                <Textarea rows={2} value={company.public_terms || ""} onChange={(e) => set("public_terms", e.target.value)}
                  placeholder="Recibimos tu solicitud. Te confirmamos por WhatsApp y pagas el día de la excursión." />
                <p className="text-xs text-muted-foreground">
                  Aquí se dice cómo se paga. Si lo dejas vacío, el cliente lee que le confirmarás la plaza en
                  breve — nunca que su reserva ya está confirmada.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          <Button onClick={save} disabled={busy} className="gap-1.5">
            <Icon name="Save" className="size-4" /> {busy ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </section>

      <section className="tf-card space-y-3 p-5">
        <h3 className="font-display text-base font-semibold">Suscripción y módulos</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={company.subscription_status} dict={GENERIC_STATUS} />
          {company.trial_ends_at && (
            <Pill tone="warning">Prueba hasta {formatDate(company.trial_ends_at)}</Pill>
          )}
          {company.next_billing_at && (
            <Pill tone="info">Próxima factura {formatDate(company.next_billing_at)}</Pill>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Módulos activos en tu plan. Para cambiarlos, contacta con el administrador de la plataforma.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(MODULE_LABEL).map(([key, label]) => (
              <Pill key={key} tone={modules.includes(key) ? "success" : "neutral"}>
                <Icon name={modules.includes(key) ? "Check" : "X"} className="size-3" /> {label}
              </Pill>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, className }: {
  label: string; value?: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label>{label}</Label>
      <Input type={type} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ----------------------------------------------------------------- equipo */

const ROLE_LABEL: Record<string, { label: string; description: string; tone: "neutral" | "info" | "success" | "warning" | "accent" | "violet" | "danger" }> = {
  owner: { label: "Propietario", description: "Control total, incluida la facturación de la suscripción.", tone: "violet" },
  admin: { label: "Administrador", description: "Todo salvo la propiedad de la cuenta.", tone: "accent" },
  manager: { label: "Gerente", description: "Comercial y operación completas, sin configuración del sistema.", tone: "info" },
  operations: { label: "Operaciones", description: "Despacho, check-in, transporte y pickups.", tone: "success" },
  cashier: { label: "Cajero", description: "Punto de venta, caja y cobros.", tone: "warning" },
  seller: { label: "Vendedor", description: "Sus propias ventas y sus propias comisiones.", tone: "neutral" },
  partner: { label: "Portal B2B", description: "Solo el portal del partner al que pertenece.", tone: "violet" },
};

const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, def]) => ({ value, label: def.label }));

function Team() {
  const [users, setUsers] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  /**
   * Cómo entra la persona.
   *
   * «invite» es el camino normal desde que existe `/api/team/invite`: recibe un
   * correo y pone una contraseña que nadie más ha visto. El camino de la
   * contraseña se queda porque hay casos reales sin correo fiable —un cajero de
   * temporada, una tablet compartida—, pero deja de ser el primero que se ve.
   */
  const [mode, setMode] = useState<"invite" | "password">("invite");

  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "seller", partner_id: "", branch: "", phone: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [u, p, b] = await Promise.all([
      api.get<any[]>("/api/team"),
      api.get<any[]>("/api/erp/partner?limit=200&filter.status=active"),
      api.get<any[]>("/api/erp/branch?limit=200"),
    ]);
    setLoading(false);
    if (!u.ok) {
      console.error("[configuracion/equipo] error cargando usuarios:", u.error);
      toast.error(u.error?.message || "No se pudieron cargar los usuarios");
      setUsers([]);
      return;
    }
    setUsers(u.data || []);
    if (p.ok) setPartners(p.data || []);
    if (b.ok) setBranches(b.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("El nombre y el email son obligatorios"); return; }
    if (form.role === "partner" && !form.partner_id) { toast.error("Elige el partner del usuario de portal"); return; }

    if (mode === "invite") {
      setBusy(true);
      const res = await api.post("/api/team/invite", {
        name: form.name.trim(), email: form.email.trim(), role: form.role,
        branch: form.branch || null,
      });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error?.message || "No se pudo enviar la invitación");
        return;
      }
      toast.success("Invitación enviada. La persona pondrá su propia contraseña.");
      setCreateOpen(false);
      setForm({ name: "", email: "", password: "", role: "seller", partner_id: "", branch: "", phone: "" });
      load();
      return;
    }

    const issue = passwordIssue(form.password);
    if (issue) { toast.error(issue); return; }
    setBusy(true);
    const res = await api.post<{ linked?: boolean }>("/api/team", {
      name: form.name.trim(), email: form.email.trim(), password: form.password,
      role: form.role, partner_id: form.partner_id || null,
      branch: form.branch || null, phone: form.phone || null,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[configuracion/equipo] error creando el usuario:", res.error);
      toast.error(res.error?.message || "No se pudo crear el usuario");
      return;
    }
    toast.success(res.data?.linked
      ? "La persona ya tenía una cuenta; se vinculó a esta empresa. Entrará con su contraseña actual."
      : "Usuario creado. Ya puede entrar con su email y contraseña.");
    setCreateOpen(false);
    setForm({ name: "", email: "", password: "", role: "seller", partner_id: "", branch: "", phone: "" });
    load();
  };

  const resetMfa = async (user: any) => {
    if (!user?._id) return;
    setBusy(true);
    const res = await api.post<{ removed: number }>("/api/team/mfa-reset", { user_id: user._id });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo restablecer la verificación");
      return;
    }
    toast.success(res.data?.removed
      ? "Verificación restablecida. Puede entrar solo con su contraseña."
      : "Esa cuenta no tenía verificación en dos pasos activa.");
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await api.put("/api/team", {
      user_id: editing._id,
      name: editing.name,
      role: editing.role,
      status: editing.status,
      phone: editing.phone || null,
      branch: typeof editing.branch === "object" && editing.branch ? editing.branch._id : editing.branch || null,
      partner_id: typeof editing.partner_id === "object" && editing.partner_id ? editing.partner_id._id : editing.partner_id || null,
    });
    setBusy(false);
    if (!res.ok) {
      console.error("[configuracion/equipo] error guardando el usuario:", res.error);
      toast.error(res.error?.message || "No se pudo guardar el usuario");
      return;
    }
    toast.success("Usuario actualizado");
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada persona entra con su propia cuenta y ve solo lo que su rol permite. Los usuarios de
          portal quedan encerrados en el portal de su partner y nunca acceden al ERP interno.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
            <Icon name="RefreshCw" className="size-4" />
          </Button>
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Icon name="UserPlus" className="size-4" /> Nuevo usuario
          </Button>
        </div>
      </div>

      <DataTable
        rows={users}
        loading={loading}
        onRowClick={(u: any) => setEditing({ ...u })}
        emptyIcon="Users"
        emptyTitle="Todavía no has invitado a nadie"
        emptyDescription="Crea cuentas para tu equipo de ventas, caja y operación, o da acceso al portal a un tour center."
        columns={[
          { key: "name", header: "Usuario", render: (u: any) => (
            <div>
              <p className="font-semibold">{u.name || "Sin nombre"}</p>
              <p className="text-xs text-muted-foreground">{u.email}</p>
            </div>
          ) },
          { key: "role", header: "Rol", render: (u: any) => {
            const def = ROLE_LABEL[u.role] || { label: u.role, tone: "neutral" as const };
            return <Pill tone={def.tone}>{def.label}</Pill>;
          } },
          { key: "scope", header: "Ámbito", hideOn: "md", render: (u: any) => {
            if (typeof u.partner_id === "object" && u.partner_id) {
              return <span className="text-xs">{u.partner_id.commercial_name || u.partner_id.name}</span>;
            }
            if (typeof u.branch === "object" && u.branch) return <span className="text-xs">{u.branch.name}</span>;
            return <span className="text-xs text-muted-foreground">Toda la empresa</span>;
          } },
          { key: "last", header: "Último acceso", hideOn: "lg",
            render: (u: any) => (u.last_login_at ? formatDate(u.last_login_at) : "Nunca") },
          // «Invitado» es un estado que el administrador necesita distinguir:
          // es la diferencia entre reenviar el correo y llamar por teléfono.
          { key: "status", header: "Estado", render: (u: any) => (
            <Pill tone={u.state === "invited" ? "warning" : u.state === "active" ? "success" : "neutral"}>
              {MEMBER_STATE_LABEL[(u.state || memberState(u.status)) as MemberState]}
            </Pill>
          ) },
        ]}
      />

      <div className="tf-card p-5">
        <h3 className="mb-3 font-display text-base font-semibold">Qué puede hacer cada rol</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(ROLE_LABEL).map(([key, def]) => (
            <li key={key} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
              <Pill tone={def.tone}>{def.label}</Pill>
              <span className="text-xs text-muted-foreground">{def.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ------------------------------------------------------- create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>
              {mode === "invite"
                ? "Recibe un correo y elige su propia contraseña. Nadie más la ve, ni tú."
                : "Le pones tú la contraseña inicial y se la tienes que hacer llegar. Úsalo solo si no tiene correo."}
            </DialogDescription>
          </DialogHeader>
          {/* La invitación primero: compartir una contraseña por chat deja a
              otra persona pudiendo firmar cierres de caja con esa cuenta. */}
          <div className="flex gap-2 rounded-lg border border-border p-1">
            {([["invite", "Invitar por correo"], ["password", "Con contraseña"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre completo" value={form.name} onChange={(v) => setForm({ ...form, name: v })} className="sm:col-span-2" />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            {mode === "password" && (
              <Field label="Contraseña" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            )}
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_LABEL[form.role]?.description}</p>
            </div>
            <Field label="Teléfono" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            {form.role === "partner" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Partner del portal</Label>
                <Select value={form.partner_id} onValueChange={(v) => setForm({ ...form, partner_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona el tour center o agencia" /></SelectTrigger>
                  <SelectContent>
                    {partners.map((p) => (
                      <SelectItem key={p._id} value={p._id}>{p.commercial_name || p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Sucursal (opcional)</Label>
                <Select value={form.branch || "__none"} onValueChange={(v) => setForm({ ...form, branch: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Toda la empresa" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Toda la empresa</SelectItem>
                    {branches.map((b) => <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Ahora acota de verdad: antes se elegía y no pasaba nada. */}
                <p className="text-xs text-muted-foreground">
                  Con una sucursal asignada, esta persona ve y exporta solo las reservas, cajas, salidas y
                  gastos de esa sucursal —y lo que registre nacerá en ella—. El catálogo y los clientes siguen
                  siendo de toda la empresa.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={create} disabled={busy}>
              {busy ? "Enviando…" : mode === "invite" ? "Enviar invitación" : "Crear usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------- edit */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.name || editing.email}</DialogTitle>
                <DialogDescription>{editing.email}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} className="sm:col-span-2" />
                <div className="space-y-1.5">
                  <Label>Rol</Label>
                  <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <Select value={editing.status || "active"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {optionsFrom(GENERIC_STATUS, ["active", "inactive", "suspended"]).map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Teléfono" value={editing.phone} onChange={(v) => setEditing({ ...editing, phone: v })} />
                {editing.role === "partner" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Partner del portal</Label>
                    <Select
                      value={typeof editing.partner_id === "object" && editing.partner_id ? editing.partner_id._id : editing.partner_id || ""}
                      onValueChange={(v) => setEditing({ ...editing, partner_id: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecciona el partner" /></SelectTrigger>
                      <SelectContent>
                        {partners.map((p) => (
                          <SelectItem key={p._id} value={p._id}>{p.commercial_name || p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {/* La salida del teléfono perdido. Sin ella, un móvil roto deja
                  una cuenta muerta —y la reacción real no es «más cuidado», es
                  que nadie active la verificación en dos pasos—. No da acceso:
                  la persona sigue necesitando su contraseña. */}
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold">Verificación en dos pasos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Si perdió el teléfono y no guardó la clave, quítale el segundo paso. Seguirá necesitando su
                  contraseña, y queda registrado en la bitácora a tu nombre.
                </p>
                <Button
                  size="sm" variant="outline" className="mt-2"
                  disabled={busy}
                  onClick={() => resetMfa(editing)}
                >
                  <Icon name="ShieldCheck" className="size-3.5" /> Restablecer verificación
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                <Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------------------------------------------------------------- resources */

/** Mirrors the branch_type union in src/lib/types.ts. */
const BRANCH_TYPE_OPTIONS = [
  { value: "park", label: "Parque" },
  { value: "office", label: "Oficina" },
  { value: "tour_center", label: "Tour center" },
  { value: "pos", label: "Punto de venta" },
  { value: "warehouse", label: "Almacén" },
  { value: "other", label: "Otro" },
];

function Branches() {
  return (
    <ResourcePage
      embedded resource="branch" title="Sucursales"
      description="Cada sucursal agrupa cajas, ventas y personal. Pueden anidarse para reflejar la estructura real del grupo."
      createLabel="Nueva sucursal" searchPlaceholder="Buscar sucursal…"
      emptyIcon="Building2" emptyTitle="Todavía no hay sucursales"
      emptyDescription="Crea una sucursal por punto físico de operación."
      columns={[
        { key: "name", header: "Sucursal", render: (b: any) => (
          <div>
            <p className="font-semibold">{b.name}</p>
            <p className="text-xs text-muted-foreground">{[b.code, b.city].filter(Boolean).join(" · ") || "Sin código"}</p>
          </div>
        ) },
        { key: "type", header: "Tipo", hideOn: "md",
          render: (b: any) => BRANCH_TYPE_OPTIONS.find((o) => o.value === b.branch_type)?.label || "—" },
        { key: "parent", header: "Depende de", hideOn: "lg",
          render: (b: any) => (typeof b.parent_branch === "object" && b.parent_branch ? b.parent_branch.name : "—") },
        { key: "phone", header: "Teléfono", hideOn: "lg", render: (b: any) => b.phone || "—" },
        { key: "status", header: "Estado", render: (b: any) => <StatusBadge value={b.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "branch_type", label: "Tipo", type: "select", defaultValue: "office", options: BRANCH_TYPE_OPTIONS },
        { name: "parent_branch", label: "Depende de", type: "reference", resource: "branch" },
        { name: "phone", label: "Teléfono" },
        { name: "email", label: "Email", type: "email" },
        { name: "city", label: "Ciudad" },
        { name: "address", label: "Dirección", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}

function Categories() {
  return (
    <ResourcePage
      embedded resource="product_category" title="Categorías de producto"
      description="Agrupan las excursiones en el catálogo y sirven de ámbito para las reglas de comisión."
      createLabel="Nueva categoría" searchPlaceholder="Buscar categoría…"
      emptyIcon="Layers" emptyTitle="Todavía no hay categorías"
      emptyDescription="Agrupa tus excursiones por tipo: acuáticas, aventura, culturales…"
      initialSort="sort_order"
      columns={[
        { key: "name", header: "Categoría", render: (c: any) => (
          <div className="flex items-center gap-2.5">
            <span className="inline-block size-4 rounded-full border border-border"
              style={{ background: c.color || "var(--muted)" }} />
            <div>
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.description || "Sin descripción"}</p>
            </div>
          </div>
        ) },
        { key: "order", header: "Orden", align: "right", hideOn: "sm", render: (c: any) => c.sort_order ?? "—" },
        { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "color", label: "Color", placeholder: "#0E7C86" },
        { name: "icon", label: "Icono (lucide)", placeholder: "Waves" },
        { name: "sort_order", label: "Orden", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
      ]}
    />
  );
}

function Modalities() {
  return (
    <ResourcePage
      embedded resource="product_modality" title="Modalidades y tarifas"
      description="Adulto, niño, VIP, privado… Cada modalidad tiene su propio precio, coste y peso sobre el cupo de la salida."
      createLabel="Nueva modalidad" searchPlaceholder="Buscar modalidad…"
      emptyIcon="Tags" emptyTitle="Todavía no hay modalidades"
      emptyDescription="Crea al menos una modalidad de adulto por excursión para poder vender."
      columns={[
        { key: "name", header: "Modalidad", render: (m: any) => (
          <div>
            <p className="font-semibold">{m.name || MODALITY_TYPE[m.modality_type || ""]?.label}</p>
            <p className="text-xs text-muted-foreground">
              {typeof m.product === "object" && m.product ? m.product.name : "Sin producto"}
            </p>
          </div>
        ) },
        { key: "type", header: "Tipo", hideOn: "md",
          render: (m: any) => MODALITY_TYPE[m.modality_type || ""]?.label || m.modality_type || "—" },
        { key: "ages", header: "Edades", hideOn: "lg",
          render: (m: any) => (m.age_from != null || m.age_to != null ? `${m.age_from ?? 0}–${m.age_to ?? "+"}` : "—") },
        { key: "cost", header: "Coste", align: "right", hideOn: "lg", render: (m: any) => formatMoney(m.cost ?? 0, m.currency) },
        { key: "price", header: "Precio", align: "right",
          render: (m: any) => <span className="font-semibold">{formatMoney(m.price ?? 0, m.currency)}</span> },
        { key: "weight", header: "Peso cupo", align: "right", hideOn: "sm", render: (m: any) => m.capacity_weight ?? 1 },
        { key: "status", header: "Estado", render: (m: any) => <StatusBadge value={m.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "product", label: "Excursión", type: "reference", resource: "product", required: true, span: 2 },
        { name: "name", label: "Nombre", required: true },
        { name: "code", label: "Código" },
        { name: "modality_type", label: "Tipo", type: "select", defaultValue: "adult", options: optionsFrom(MODALITY_TYPE) },
        { name: "price", label: "Precio", type: "number", required: true },
        { name: "cost", label: "Coste", type: "number" },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "age_from", label: "Edad desde", type: "number" },
        { name: "age_to", label: "Edad hasta", type: "number" },
        { name: "min_pax", label: "Pax mínimos", type: "number" },
        { name: "max_pax", label: "Pax máximos", type: "number" },
        { name: "capacity_weight", label: "Peso sobre el cupo", type: "number", defaultValue: 1,
          help: "Un infante puede contar 0 y un vehículo privado varias plazas." },
        { name: "sort_order", label: "Orden", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}

function PriceRules() {
  return (
    <ResourcePage
      embedded resource="price_rule" title="Reglas de precio"
      description="Se evalúan por prioridad y especificidad: vendedor, partner, canal, modalidad y temporada. La primera que encaje fija el precio."
      createLabel="Nueva regla" searchPlaceholder="Buscar regla…"
      emptyIcon="BadgeDollarSign" emptyTitle="Todavía no hay reglas de precio"
      emptyDescription="Sin reglas se aplica el precio de la modalidad o, en su defecto, el precio base del producto."
      initialSort="priority"
      columns={[
        { key: "name", header: "Regla", render: (r: any) => (
          <div>
            <p className="font-semibold">{r.name}</p>
            <p className="text-xs text-muted-foreground">
              {typeof r.product === "object" && r.product ? r.product.name : "Todos los productos"}
              {typeof r.modality === "object" && r.modality ? ` · ${r.modality.name}` : ""}
            </p>
          </div>
        ) },
        { key: "priority", header: "Prioridad", align: "center", render: (r: any) => <Pill tone="neutral">{r.priority ?? 100}</Pill> },
        { key: "scope", header: "Ámbito", hideOn: "lg", render: (r: any) => {
          const parts = [
            typeof r.partner === "object" && r.partner ? r.partner.commercial_name || r.partner.name : null,
            typeof r.seller === "object" && r.seller ? [r.seller.first_name, r.seller.last_name].filter(Boolean).join(" ") : null,
            r.channel ? CHANNEL[r.channel]?.label || r.channel : null,
          ].filter(Boolean);
          return <span className="text-xs text-muted-foreground">{parts.length ? parts.join(" · ") : "General"}</span>;
        } },
        { key: "season", header: "Temporada", hideOn: "lg", render: (r: any) =>
          r.season_from || r.season_to
            ? <span className="text-xs">{formatDate(r.season_from)} – {formatDate(r.season_to)}</span>
            : <span className="text-xs text-muted-foreground">Todo el año</span> },
        { key: "amount", header: "Importe", align: "right",
          render: (r: any) => <span className="font-semibold">{formatMoney(r.amount ?? 0, r.currency)}</span> },
        { key: "status", header: "Estado", render: (r: any) => <StatusBadge value={r.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre de la regla", required: true, span: 2 },
        { name: "priority", label: "Prioridad", type: "number", defaultValue: 100 },
        { name: "amount", label: "Importe", type: "number", required: true },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "price_type", label: "Tipo de precio", type: "select", defaultValue: "standard", options: [
          { value: "standard", label: "Estándar" }, { value: "per_person", label: "Por persona" },
          { value: "per_group", label: "Por grupo" }, { value: "per_vehicle", label: "Por vehículo" },
          { value: "b2c", label: "B2C (público)" }, { value: "b2b", label: "B2B (agencias)" },
        ] },
        { name: "product", label: "Excursión", type: "reference", resource: "product" },
        { name: "modality", label: "Modalidad", type: "reference", resource: "product_modality" },
        { name: "partner", label: "Partner", type: "reference", resource: "partner", optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "seller", label: "Vendedor", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "channel", label: "Canal", type: "select", options: optionsFrom(CHANNEL) },
        { name: "min_qty", label: "Cantidad mínima", type: "number" },
        { name: "max_qty", label: "Cantidad máxima", type: "number" },
        { name: "season_from", label: "Temporada desde", type: "date" },
        { name: "season_to", label: "Temporada hasta", type: "date" },
        { name: "weekdays", label: "Días de la semana", type: "multiselect", placeholder: "mon, tue, wed",
          help: "Códigos separados por comas. Vacío = todos los días." },
        { name: "time_from", label: "Hora desde", placeholder: "08:00" },
        { name: "time_to", label: "Hora hasta", placeholder: "18:00" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}

function CancellationPolicies() {
  return (
    <ResourcePage
      embedded resource="cancellation_policy" title="Políticas de cancelación"
      description="Definen el reembolso según las horas que faltan para la salida. Los tramos se guardan como JSON: [{ hours_before, refund_pct }]."
      createLabel="Nueva política" searchPlaceholder="Buscar política…"
      emptyIcon="FileWarning" emptyTitle="Todavía no hay políticas"
      emptyDescription="Sin política, una cancelación no genera reembolso automático."
      columns={[
        { key: "name", header: "Política", render: (p: any) => (
          <div>
            <p className="font-semibold">{p.name}</p>
            <p className="text-xs text-muted-foreground">{p.description || "Sin descripción"}</p>
          </div>
        ) },
        { key: "tiers", header: "Tramos", hideOn: "md", render: (p: any) => {
          let tiers: any[] = [];
          try { tiers = typeof p.tiers === "string" ? JSON.parse(p.tiers) : p.tiers || []; }
          catch { tiers = []; }
          if (!Array.isArray(tiers) || tiers.length === 0) return <span className="text-xs text-muted-foreground">Sin tramos</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {tiers.map((t: any, i: number) => (
                <Pill key={i} tone="neutral" className="tf-num">{t.hours_before}h → {t.refund_pct}%</Pill>
              ))}
            </div>
          );
        } },
        { key: "noshow", header: "No-show", align: "right", hideOn: "lg",
          render: (p: any) => formatPercent(p.no_show_refund_pct ?? 0, 0) },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "tiers", label: "Tramos (JSON)", type: "textarea", span: 2,
          placeholder: '[{"hours_before":48,"refund_pct":100},{"hours_before":24,"refund_pct":50},{"hours_before":0,"refund_pct":0}]',
          help: "Se evalúan de mayor a menor: gana el primer tramo cuyas horas ya se hayan cumplido." },
        { name: "no_show_refund_pct", label: "Reembolso por no-show (%)", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
      ]}
    />
  );
}

function CashRegisters() {
  return (
    <ResourcePage
      embedded resource="cash_register" title="Cajas"
      description="Cada punto de cobro necesita su caja. Una caja solo puede tener una sesión abierta a la vez."
      createLabel="Nueva caja" searchPlaceholder="Buscar caja…"
      emptyIcon="Wallet" emptyTitle="Todavía no hay cajas"
      emptyDescription="Crea una caja para poder abrir sesiones y cobrar en efectivo."
      columns={[
        { key: "name", header: "Caja", render: (c: any) => (
          <div>
            <p className="font-semibold">{c.name}</p>
            <p className="text-xs text-muted-foreground">{[c.code, c.terminal].filter(Boolean).join(" · ") || "Sin código"}</p>
          </div>
        ) },
        { key: "branch", header: "Sucursal", render: (c: any) => (typeof c.branch === "object" && c.branch ? c.branch.name : "—") },
        { key: "currency", header: "Moneda", align: "center", hideOn: "md",
          render: (c: any) => <Pill tone="neutral">{(c.currency || "usd").toUpperCase()}</Pill> },
        { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "code", label: "Código" },
        { name: "terminal", label: "Terminal" },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        {
          name: "difference_tolerance", label: "Tolerancia de descuadre", type: "number",
          defaultValue: 0,
          help: "Hasta cuánto puede descuadrar un turno sin que lo revise un supervisor. Con 0, cualquier diferencia se revisa.",
        },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
      ]}
    />
  );
}

function ExpenseCategories() {
  return (
    <ResourcePage
      embedded resource="expense_category" title="Categorías de gasto"
      description="Clasifican los gastos operativos para poder analizarlos por concepto."
      createLabel="Nueva categoría" searchPlaceholder="Buscar categoría…"
      emptyIcon="Receipt" emptyTitle="Todavía no hay categorías de gasto"
      emptyDescription="Combustible, peajes, entradas, comidas del personal…"
      columns={[
        { key: "name", header: "Categoría", render: (c: any) => (
          <div className="flex items-center gap-2.5">
            <span className="inline-block size-4 rounded-full border border-border" style={{ background: c.color || "var(--muted)" }} />
            <div>
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.description || "Sin descripción"}</p>
            </div>
          </div>
        ) },
        { key: "status", header: "Estado", render: (c: any) => <StatusBadge value={c.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "color", label: "Color", placeholder: "#0E7C86" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(GENERIC_STATUS, ["active", "inactive"]) },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
      ]}
    />
  );
}

function CurrencyRates() {
  return (
    <ResourcePage
      embedded resource="currency_rate" title="Tipos de cambio"
      description="Se usan para consolidar en la moneda base. Cada venta guarda el tipo con el que se cerró."
      createLabel="Nuevo tipo de cambio" searchPlaceholder="Buscar por origen…"
      emptyIcon="ArrowLeftRight" emptyTitle="Todavía no hay tipos de cambio"
      emptyDescription="Añade los tipos si operas con más de una moneda."
      columns={[
        { key: "pair", header: "Par", render: (r: any) => (
          <span className="font-mono font-semibold">
            {(r.currency_from || "").toUpperCase()} → {(r.currency_to || "").toUpperCase()}
          </span>
        ) },
        { key: "rate", header: "Tipo", align: "right", render: (r: any) => <span className="font-semibold">{formatNumber(r.rate ?? 0, 4)}</span> },
        { key: "date", header: "Fecha", align: "right", hideOn: "sm", render: (r: any) => formatDate(r.rate_date) },
        { key: "source", header: "Fuente", hideOn: "lg", render: (r: any) => r.source || "Manual" },
      ]}
      fields={[
        { name: "currency_from", label: "Moneda origen", type: "select", required: true, options: CURRENCY_OPTIONS },
        { name: "currency_to", label: "Moneda destino", type: "select", required: true, options: CURRENCY_OPTIONS },
        { name: "rate", label: "Tipo de cambio", type: "number", required: true },
        { name: "rate_date", label: "Fecha", type: "date" },
        { name: "source", label: "Fuente", placeholder: "Banco central, manual…" },
      ]}
    />
  );
}

/* -------------------------------------------------------------------- page */

const TABS = [
  { value: "company", label: "Empresa", node: <CompanyForm /> },
  { value: "team", label: "Usuarios y roles", node: <Team /> },
  { value: "branches", label: "Sucursales", node: <Branches /> },
  { value: "categories", label: "Categorías", node: <Categories /> },
  { value: "modalities", label: "Modalidades", node: <Modalities /> },
  { value: "prices", label: "Reglas de precio", node: <PriceRules /> },
  { value: "policies", label: "Cancelaciones", node: <CancellationPolicies /> },
  { value: "registers", label: "Cajas", node: <CashRegisters /> },
  { value: "expenses", label: "Categorías de gasto", node: <ExpenseCategories /> },
  { value: "rates", label: "Tipos de cambio", node: <CurrencyRates /> },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sistema"
        title="Configuración"
        description="Los datos maestros que gobiernan el resto del sistema: precios, cupos, políticas, cajas y estructura de la empresa."
      />
      <Tabs defaultValue="company">
        <div className="tf-scroll overflow-x-auto pb-1">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-5">{t.node}</TabsContent>
        ))}
      </Tabs>
    </div>
  );
}


/**
 * LA MARCA DE LA EMPRESA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE BLOQUE EXISTE PORQUE ANTES NO SE PODÍA GUARDAR
 *
 * La pantalla pedía WhatsApp, logo, dirección y color desde el principio, y
 * ninguna de esas columnas existía en la base. No es que se perdiera el campo:
 * PostgREST rechaza el UPDATE ENTERO cuando una columna del payload no existe,
 * así que en cuanto alguien escribía su WhatsApp se perdía también el nombre,
 * el RNC y todo lo demás del formulario. La migración 0055 crea las columnas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VISTA PREVIA NO ES ADORNO
 *
 * Un color se elige mirándolo, no imaginándoselo. Aquí se ve la cabecera tal y
 * como saldrá en el voucher —logo, nombre, contacto, RNC— y el aviso de
 * contraste aparece ANTES de que la empresa entregue mil documentos con un
 * texto que no se lee encima de su amarillo corporativo.
 */
function Marca({
  company, set, onSaved,
}: {
  company: any;
  set: (k: string, v: string | number | boolean | null) => void;
  onSaved: () => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const color = brandColor(company.brand_color);
  const sobre = readableOn(color);
  const legible = hasReadableContrast(color);
  const problemaLogo = logoProblem(company.logo_url);
  const pendientes = brandingGaps(company);

  const subirLogo = async (file: File) => {
    setSubiendo(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/company/logo", { method: "POST", body: form, credentials: "same-origin" });
    setSubiendo(false);
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(payload?.error?.message || "No se pudo subir el logo");
      return;
    }
    toast.success("Logo actualizado. Ya sale en los documentos nuevos.");
    onSaved();
  };

  const contacto = [company.phone || company.whatsapp, company.email,
    [company.address, company.city].filter(Boolean).join(", ")].filter(Boolean).join("  ·  ");

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div>
        <p className="font-medium">Tu marca en los documentos</p>
        <p className="mt-1 text-xs text-muted-foreground">
          El voucher, la cotización y la factura son lo único que el cliente se lleva a casa. Esto es lo que
          decide cómo salen.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* ------------------------------------------------------------ logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-3">
            {company.logo_url ? (
              <img src={company.logo_url} alt="Logo" className="h-12 w-auto max-w-[140px] object-contain" />
            ) : (
              <div className="flex h-12 w-24 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                Sin logo
              </div>
            )}
            <div>
              <Input
                type="file" accept="image/png,image/jpeg" disabled={subiendo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subirLogo(f);
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                PNG o JPG. El formato PDF no sabe incrustar SVG ni WebP: se vería en pantalla y no en el
                voucher.
              </p>
            </div>
          </div>
          {problemaLogo && (
            <p className="text-xs text-destructive">{LOGO_PROBLEM_MESSAGE[problemaLogo]}</p>
          )}
        </div>

        {/* ----------------------------------------------------------- color */}
        <div className="space-y-2">
          <Label htmlFor="brand-color">Color de marca</Label>
          <div className="flex items-center gap-2">
            <input
              id="brand-color" type="color" className="h-10 w-14 rounded border"
              value={color}
              onChange={(e) => set("brand_color", e.target.value.toLowerCase())}
            />
            <Input
              className="w-32 font-mono"
              value={company.brand_color || ""}
              placeholder={DEFAULT_BRAND_COLOR}
              onChange={(e) => set("brand_color", e.target.value || null)}
            />
          </div>
          {!legible && (
            <p className="text-xs text-amber-600">
              Con este color el texto encima queda en {contrastRatio(color, sobre)}:1, por debajo del
              mínimo legible de {MIN_CONTRAST}:1. Los documentos lo usarán igual, pero se leerá peor.
            </p>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- vista previa */}
      <div className="space-y-1.5">
        <Label>Así sale la cabecera</Label>
        <div className="rounded-lg border bg-white p-4 text-[#111]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {company.logo_url && (
                  <img src={company.logo_url} alt="" className="h-8 w-auto max-w-[120px] object-contain" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold">{company.name || company.legal_name || "Nombre de tu empresa"}</p>
                {company.legal_name && company.legal_name !== company.name && (
                  <p className="text-[11px] text-neutral-500">{company.legal_name}</p>
                )}
                {contacto && <p className="text-[11px] text-neutral-500">{contacto}</p>}
                {company.tax_id && <p className="text-[11px] text-neutral-500">RNC {company.tax_id}</p>}
              </div>
            </div>
            <span className="shrink-0 text-xs font-bold" style={{ color }}>VOUCHER · RES-00042</span>
          </div>
          <div className="mt-3 h-px bg-neutral-200" />
          {company.document_footer && (
            <p className="mt-3 text-[10px] text-neutral-500">{company.document_footer}</p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------- textos legales */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Pie legal (en todos los documentos)</Label>
          <Textarea
            rows={2} value={company.document_footer || ""}
            onChange={(e) => set("document_footer", e.target.value)}
            placeholder="RM 12345 · Autorizada por MITUR"
          />
          <p className="text-xs text-muted-foreground">
            El registro mercantil, la leyenda de turismo o lo que te exijan. Va al pie de cada hoja.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Condiciones del voucher</Label>
          <Textarea
            rows={3} value={company.voucher_terms || ""}
            onChange={(e) => set("voucher_terms", e.target.value)}
            placeholder="Presentarse 15 minutos antes. Llevar documento de identidad."
          />
          <p className="text-xs text-muted-foreground">
            Lo que el cliente enseña en la puerta. Las condiciones pactadas en una reserva concreta mandan
            sobre estas.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Nota legal de la factura</Label>
          <Textarea
            rows={3} value={company.invoice_terms || ""}
            onChange={(e) => set("invoice_terms", e.target.value)}
            placeholder="Régimen ordinario. Esta factura es válida como crédito fiscal."
          />
          <p className="text-xs text-muted-foreground">
            Cambia según el régimen de cada empresa, así que no puede venir escrita en el sistema.
          </p>
        </div>
      </div>

      {pendientes.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-semibold">Lo que falta para que los documentos salgan completos</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {pendientes.map((g) => <li key={g}>· {g}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
