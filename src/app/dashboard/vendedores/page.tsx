"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, SELLER_ROLE } from "@/lib/labels";
import { formatMoney, formatPercent } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Seller } from "@/lib/types";

export default function SellersPage() {
  return (
    <ResourcePage
      resource="seller"
      eyebrow="Red de ventas"
      title="Vendedores y supervisores"
      description="Jerarquía comercial completa: parque → tour operator → tour center → supervisor → vendedor, con comisiones, metas y límites de descuento."
      createLabel="Nuevo vendedor"
      searchPlaceholder="Buscar por nombre, código, email o teléfono…"
      emptyIcon="UserRound"
      emptyTitle="Todavía no hay vendedores"
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
        { key: "commission", header: "Comisión", align: "right", hideOn: "sm", render: (s: any) => formatPercent(s.commission_pct ?? 0) },
        { key: "goal", header: "Meta mensual", align: "right", hideOn: "md", render: (s: any) => formatMoney(s.monthly_goal ?? 0, s.currency || "usd") },
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
