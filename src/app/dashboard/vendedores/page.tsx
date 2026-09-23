"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ResourcePage } from "@/components/tf/resource-page";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/tf/icon";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, SELLER_ROLE } from "@/lib/labels";
import { formatMoney, formatPercent } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Seller } from "@/lib/types";

export default function SellersPage() {
  /**
   * «Crear cuenta e invitar», en la propia fila.
   *
   * Dar de alta a un vendedor eran tres pasos en dos pantallas: crear la ficha
   * aquí, invitar la cuenta en Configuración → Equipo y volver a vincularla. El
   * tercero es el que decide si esa persona ve sus ventas o no ve ninguna, y es
   * el que se olvida —no falla, no avisa, y el vendedor entra a un sistema
   * vacío—. `POST /api/sellers/invite` hace los tres de una vez.
   */
  const [invitando, setInvitando] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const invitar = async (seller: any) => {
    if (!seller.email) {
      toast.error("Pon primero el correo de esta persona en su ficha");
      return;
    }
    setInvitando(seller._id);
    const res = await api.post<{ invited?: { email?: string } }>("/api/sellers/invite", { seller_id: seller._id });
    setInvitando(null);
    if (!res.ok) {
      toast.error(res.error?.message || "No se pudo crear la cuenta");
      return;
    }
    toast.success(`Invitación enviada a ${res.data?.invited?.email || seller.email}`);
    setVersion((v) => v + 1);
  };

  return (
    <ResourcePage
      key={version}
      resource="seller"
      eyebrow="Red de ventas"
      title="Vendedores y supervisores"
      description="Jerarquía comercial completa: parque → tour operator → tour center → supervisor → vendedor, con comisiones, metas y límites de descuento."
      createLabel="Nuevo vendedor"
      searchPlaceholder="Buscar por nombre, código, email o teléfono…"
      emptyIcon="UserRound"
      emptyTitle="Todavía no hay vendedores"
      rowActions={(s: any) => (s.user || s.user_id ? null : (
        <Button
          variant="ghost" size="icon" className="size-8 text-amber-600 hover:text-amber-700"
          aria-label="Crear cuenta e invitar"
          title="Crear cuenta de acceso e invitar"
          disabled={invitando === s._id}
          onClick={() => invitar(s)}
        >
          <Icon name={invitando === s._id ? "Loader2" : "UserPlus"} className={invitando === s._id ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      ))}
      filters={[
        { name: "seller_role", label: "Rol", options: optionsFrom(SELLER_ROLE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "suspended"]) },
      ]}
      columns={[
        {
          key: "name", header: "Vendedor",
          render: (s: any) => (
            <div>
              <p className="font-semibold">{[s.first_name, s.last_name].filter(Boolean).join(" ")}</p>
              <p className="text-xs text-muted-foreground">{s.code ? `${s.code} · ` : ""}{s.email || s.phone || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "role", header: "Rol", render: (s: any) => <StatusBadge value={s.seller_role} dict={SELLER_ROLE} dot={false} /> },
        { key: "partner", header: "Partner", hideOn: "lg",
          render: (s: any) => (typeof s.partner === "object" && s.partner ? s.partner.commercial_name || s.partner.name : "Equipo propio") },
        { key: "supervisor", header: "Supervisor", hideOn: "lg",
          render: (s: any) => (typeof s.supervisor === "object" && s.supervisor
            ? [s.supervisor.first_name, s.supervisor.last_name].filter(Boolean).join(" ") : "—") },
        // «—» y no «0» cuando el campo no viene: el recorte de columnas
        // (`field-projection.ts`) esconde las condiciones de los compañeros a
        // quien no tiene rango, y una comisión del 0 % es una afirmación falsa
        // sobre el contrato de esa persona, no una ausencia.
        { key: "commission", header: "Comisión", align: "right", hideOn: "sm",
          render: (s: any) => (s.commission_pct == null ? "—" : formatPercent(s.commission_pct)) },
        { key: "goal", header: "Meta mensual", align: "right", hideOn: "md",
          render: (s: any) => (s.monthly_goal == null ? "—" : formatMoney(s.monthly_goal, s.currency || "usd")) },
        {
          // Sin cuenta vinculada, esta persona entra al sistema y no ve NINGUNA
          // de sus ventas: el sistema no sabe cuáles son suyas. Se enseña en el
          // listado porque es lo primero que hay que arreglar de una ficha.
          key: "acceso", header: "Acceso", hideOn: "md",
          render: (s: any) => (s.user || s.user_id
            ? <span className="text-xs text-muted-foreground">Vinculada</span>
            : <span className="text-xs font-semibold text-amber-600">Sin vincular</span>),
        },
        { key: "status", header: "Estado", render: (s: any) => <StatusBadge value={s.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "first_name", label: "Nombre", required: true },
        { name: "last_name", label: "Apellidos" },
        { name: "code", label: "Código" },
        { name: "seller_role", label: "Rol", type: "select", defaultValue: "seller", options: optionsFrom(SELLER_ROLE) },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "whatsapp", label: "WhatsApp" },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        /**
         * La cuenta con la que entra esta persona.
         *
         * Es lo que convierte «rol de vendedor» en «ES este vendedor». Sin
         * vincularla, quien entra con rol de vendedor no ve NINGUNA venta
         * atribuida —el sistema no sabe cuáles son las suyas— y su panel sale
         * vacío. El campo existía en la base desde el principio y no había
         * ninguna pantalla que lo pusiera.
         */
        { name: "user", label: "Cuenta de acceso", type: "reference", optionsPath: "/api/team?limit=300",
          optionLabel: (u: any) => `${u.name || u.email}${u.email && u.name ? ` · ${u.email}` : ""}`,
          span: 2,
          help: "Vincula la cuenta con la que entra esta persona. Sin esto solo verá las ventas sin vendedor asignado, y su panel saldrá vacío." },
        { name: "partner", label: "Partner al que pertenece", type: "reference", resource: "partner",
          optionLabel: (p: any) => p.commercial_name || p.name, help: "Déjalo vacío si es personal propio." },
        { name: "supervisor", label: "Supervisor", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "commission_pct", label: "Comisión estándar", type: "number", suffix: "%" },
        /**
         * Y si la retiene en el acto (0082). Justo debajo de la comisión, que
         * es de lo que se retiene: verlas separadas es cómo se declara una
         * retención sobre un porcentaje que nadie fijó.
         *
         * Aquí no aparece «cobra el punto de venta»: el punto de venta es el
         * tour center, no la persona, y ofrecerlo invitaría a declarar en la
         * ficha algo que luego decide el contrato.
         */
        { name: "collection_mode", label: "Cobro en la calle", type: "select",
          defaultValue: "operator_collects",
          help: "Con «retiene», se queda su comisión al vender y el cliente paga el resto al subir.",
          options: [
            { value: "operator_collects", label: "El cliente paga todo al operador" },
            { value: "seller_retains", label: "Retiene su comisión como depósito" },
          ] },
        { name: "monthly_goal", label: "Meta mensual", type: "number" },
        { name: "max_discount_pct", label: "Descuento máximo autorizado", type: "number", suffix: "%" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "hire_date", label: "Fecha de ingreso", type: "date" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: [
          { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }, { value: "suspended", label: "Suspendido" },
        ] },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
