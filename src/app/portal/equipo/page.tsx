"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge } from "@/components/tf/status-badge";
import { EmptyState } from "@/components/tf/empty-state";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";

interface MiembroSocio {
  _id: string;
  email?: string;
  name?: string;
  status?: string;
  partner_role?: string | null;
  mfa_enabled?: boolean;
  last_sign_in_at?: string | null;
}

/**
 * EL EQUIPO DEL TOUR CENTER, GESTIONADO POR EL TOUR CENTER.
 *
 * Hasta aquí, dar de alta a un vendedor suyo era una llamada a la operadora.
 * Con dos operadoras, dos llamadas — y mientras tanto la persona trabaja con la
 * cuenta de otra, que es como se acaba sin saber quién vendió qué.
 *
 * Las dos columnas que parecen accesorias no lo son: **último acceso** y
 * **segundo factor** contestan la única pregunta que nadie se hace a tiempo,
 * que es a quién le queda la cuenta abierta sin usarla y quién la tiene sin
 * proteger. Sin ellas hay que ir preguntando a la gente.
 */
export default function PortalTeamPage() {
  const { isStaff } = usePortal();
  const [miembros, setMiembros] = useState<MiembroSocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [puedeGestionar, setPuedeGestionar] = useState(false);
  const [alta, setAlta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", partner_role: "agent" });

  const cargar = useCallback(async () => {
    setCargando(true);
    const [equipo, yo] = await Promise.all([
      api.get<MiembroSocio[]>("/api/team"),
      api.get<{ user?: { partnerRole?: string | null } }>("/api/me"),
    ]);
    setCargando(false);
    if (!equipo.ok) {
      console.error("[portal/equipo] no se pudo cargar el equipo:", equipo.error);
      toast.error(equipo.error?.message || "No se pudo cargar el equipo");
      return;
    }
    setMiembros(equipo.data || []);
    setPuedeGestionar(yo.ok ? yo.data?.user?.partnerRole === "admin" : false);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async () => {
    if (!form.email.trim() || !form.name.trim()) {
      toast.error("El nombre y el correo son obligatorios");
      return;
    }
    setGuardando(true);
    const res = await api.post("/api/team", form);
    setGuardando(false);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo dar de alta a esta persona");
      return;
    }
    toast.success("Persona dada de alta");
    setAlta(false);
    setForm({ email: "", name: "", password: "", partner_role: "agent" });
    void cargar();
  };

  const cambiar = async (miembro: MiembroSocio, patch: Record<string, unknown>) => {
    const res = await api.put("/api/team", { user_id: miembro._id, ...patch });
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo guardar el cambio");
      return;
    }
    void cargar();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi equipo"
        description="Quién de tu empresa tiene acceso, con qué permiso y desde cuándo no entra."
        actions={puedeGestionar ? (
          <Button onClick={() => setAlta(true)}>
            <Icon name="UserPlus" className="mr-2 size-4" /> Dar de alta
          </Button>
        ) : null}
      />

      {isStaff && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Estás viendo esta pantalla como personal interno. La gestión del equipo de un tour center
          la hace quien administra su cuenta; desde aquí solo se consulta.
        </p>
      )}

      {!cargando && miembros.length === 0 ? (
        <EmptyState icon="Users" title="Todavía no hay nadie" description="Da de alta a la primera persona de tu equipo." />
      ) : (
        <DataTable
          loading={cargando}
          rows={miembros}
          columns={[
            { key: "name", header: "Persona", render: (m: MiembroSocio) => (
              <div>
                <div className="font-medium">{m.name || "—"}</div>
                <div className="text-xs text-muted-foreground">{m.email}</div>
              </div>
            ) },
            { key: "partner_role", header: "Permiso", render: (m: MiembroSocio) => (
              m.partner_role === "admin" ? "Administra la cuenta" : "Reserva y consulta"
            ) },
            { key: "status", header: "Estado", render: (m: MiembroSocio) => (
              <StatusBadge value={m.status} dict={GENERIC_STATUS} />
            ) },
            { key: "mfa_enabled", header: "2 pasos", render: (m: MiembroSocio) => (
              m.mfa_enabled
                ? <span className="text-emerald-600">Activo</span>
                : <span className="text-muted-foreground">Sin activar</span>
            ) },
            /**
             * «Nunca» y «hace tres meses» son la misma señal con dos caras: una
             * cuenta abierta que nadie usa. Se dice con palabras y no con una
             * fecha en blanco, que se lee como un dato que falta.
             */
            { key: "last_sign_in_at", header: "Último acceso", render: (m: MiembroSocio) => (
              m.last_sign_in_at ? formatDate(m.last_sign_in_at) : <span className="text-muted-foreground">Nunca ha entrado</span>
            ) },
            ...(puedeGestionar ? [{
              key: "acciones", header: "", render: (m: MiembroSocio) => (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => cambiar(m, {
                    partner_role: m.partner_role === "admin" ? "agent" : "admin",
                  })}>
                    {m.partner_role === "admin" ? "Quitar administración" : "Hacer administrador"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => cambiar(m, {
                    status: m.status === "active" ? "inactive" : "active",
                  })}>
                    {m.status === "active" ? "Desactivar" : "Reactivar"}
                  </Button>
                </div>
              ),
            }] : []),
          ]}
        />
      )}

      <Sheet open={alta} onOpenChange={setAlta}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Dar de alta a alguien de tu equipo</SheetTitle>
            <SheetDescription>
              Entrará al portal con su propio correo y su propia contraseña.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="equipo-nombre">Nombre</Label>
              <Input id="equipo-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipo-email">Correo</Label>
              <Input id="equipo-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipo-clave">Contraseña inicial</Label>
              <Input id="equipo-clave" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">Mínimo 8 caracteres. Podrá cambiarla desde su perfil.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipo-permiso">Permiso</Label>
              <Select value={form.partner_role} onValueChange={(v) => setForm({ ...form, partner_role: v })}>
                <SelectTrigger id="equipo-permiso"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Reserva y consulta</SelectItem>
                  <SelectItem value="admin">Administra la cuenta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <SheetFooter>
            <Button onClick={crear} disabled={guardando}>{guardando ? "Dando de alta…" : "Dar de alta"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
