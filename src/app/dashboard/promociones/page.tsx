"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
import type { Promotion } from "@/lib/types";

export default function PromotionsPage() {
  return (
    <ResourcePage
      resource="promotion"
      eyebrow="Comercial"
      title="Promociones y descuentos"
      description="Códigos promocionales por canal, importe mínimo y ventana de validez. El descuento aplicado queda congelado en el snapshot de cada reserva."
      createLabel="Nueva promoción"
      emptyIcon="BadgePercent"
      emptyTitle="Sin promociones activas"
      columns={[
        {
          key: "name", header: "Promoción",
          render: (p: any) => (
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
            </div>
          ),
        },
        { key: "value", header: "Descuento", align: "right",
          render: (p: any) => (p.discount_type === "percentage" ? `${p.value ?? 0}%` : formatMoney(p.value ?? 0, "usd")) },
        { key: "window", header: "Vigencia", hideOn: "sm",
          render: (p: any) => `${formatDate(p.valid_from)} → ${formatDate(p.valid_to)}` },
        { key: "uses", header: "Usos", align: "right", hideOn: "md",
          render: (p: any) => `${p.used_count ?? 0}${p.max_uses ? ` / ${p.max_uses}` : ""}` },
        { key: "min", header: "Mínimo", align: "right", hideOn: "lg", render: (p: any) => formatMoney(p.min_amount ?? 0, "usd") },
        { key: "status", header: "Estado", render: (p: any) => <StatusBadge value={p.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "code", label: "Código", required: true, placeholder: "EARLY10" },
        { name: "discount_type", label: "Tipo", type: "select", defaultValue: "percentage",
          options: [{ value: "percentage", label: "Porcentaje" }, { value: "fixed", label: "Importe fijo" }] },
        { name: "value", label: "Valor", type: "number", required: true },
        { name: "valid_from", label: "Válida desde", type: "date" },
        { name: "valid_to", label: "Válida hasta", type: "date" },
        { name: "min_amount", label: "Importe mínimo", type: "number" },
        { name: "max_uses", label: "Usos máximos", type: "number" },
        { name: "channels", label: "Canales", type: "multiselect", placeholder: "web, direct, b2b_portal",
          help: "Separa los canales por comas. Vacío = todos los canales." },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activa" }, { value: "inactive", label: "Inactiva" }, { value: "expired", label: "Expirada" }] },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
      ]}
    />
  );
}
