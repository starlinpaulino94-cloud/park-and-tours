"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS, PARTNER_TYPE } from "@/lib/labels";
import { formatMoney, formatPercent } from "@/lib/format";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import type { Partner } from "@/lib/types";

export default function PartnersPage() {
  return (
    <ResourcePage
      resource="partner"
      eyebrow="Red de ventas"
      title="Tour centers, agencias y partners"
      description="Contratos, condiciones comerciales, límite de crédito, tarifas B2B y catálogo autorizado de cada canal externo."
      createLabel="Nuevo partner"
      searchPlaceholder="Buscar por nombre comercial, RNC, contacto o email…"
      emptyIcon="Handshake"
      emptyTitle="Aún no hay partners"
      emptyDescription="Da de alta tus tour centers y agencias para venderles con tarifa neta y comisión propia."
      filters={[
        { name: "partner_type", label: "Tipo", options: optionsFrom(PARTNER_TYPE) },
        { name: "status", label: "Estado", options: optionsFrom(GENERIC_STATUS, ["active", "inactive", "blocked", "pending"]) },
      ]}
      columns={[
        {
          key: "name", header: "Partner",
          render: (p: any) => (
            <div>
              <p className="font-semibold">{p.commercial_name || p.name}</p>
              <p className="text-xs text-muted-foreground">{p.city ? `${p.city} · ` : ""}{p.contact_name || p.email || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (p: any) => <StatusBadge value={p.partner_type} dict={PARTNER_TYPE} dot={false} /> },
        { key: "commission", header: "Comisión", align: "right", hideOn: "sm", render: (p: any) => formatPercent(p.default_commission_pct ?? 0) },
        { key: "credit", header: "Crédito", align: "right", hideOn: "md",
          render: (p: any) => (
            <div>
              <p>{formatMoney(p.credit_limit ?? 0, p.currency || "usd")}</p>
              <p className="text-[11px] text-muted-foreground">{p.credit_days ?? 0} días</p>
            </div>
          ) },
        { key: "balance", header: "Saldo", align: "right",
          render: (p: any) => (
            <span className={(p.balance ?? 0) > 0 ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>
              {formatMoney(p.balance ?? 0, p.currency || "usd")}
            </span>
          ) },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Razón social", required: true },
        { name: "commercial_name", label: "Nombre comercial" },
        { name: "partner_type", label: "Tipo", type: "select", required: true, defaultValue: "tour_center", options: optionsFrom(PARTNER_TYPE) },
        { name: "tax_id", label: "RNC / Identificación fiscal" },
        { name: "contact_name", label: "Persona de contacto" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "whatsapp", label: "WhatsApp" },
        { name: "city", label: "Ciudad" },
        { name: "country", label: "País" },
        { name: "default_commission_pct", label: "Comisión estándar", type: "number", suffix: "%" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "credit_limit", label: "Límite de crédito", type: "number" },
        { name: "credit_days", label: "Días de crédito", type: "number" },
        { name: "contract_from", label: "Contrato desde", type: "date" },
        { name: "contract_to", label: "Contrato hasta", type: "date" },
        { name: "parent_partner", label: "Depende de", type: "reference", resource: "partner",
          help: "Para subagencias dentro de una agencia matriz." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: [
          { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" },
          { value: "blocked", label: "Bloqueado" }, { value: "pending", label: "Pendiente" },
        ] },
        { name: "address", label: "Dirección", span: 2 },
        { name: "commercial_terms", label: "Condiciones comerciales", type: "textarea", span: 2 },
        { name: "notes", label: "Notas internas", type: "textarea", span: 2 },
      ]}
    />
  );
}
