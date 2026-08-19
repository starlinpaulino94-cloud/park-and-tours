"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { KpiCard } from "@/components/tf/kpi-card";
import { LEAD_STATUS, CHANNEL } from "@/lib/labels";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { CURRENCY_OPTIONS, optionsFrom } from "@/components/tf/options";

const PIPELINE = ["new", "contacted", "interested", "quoted", "follow_up", "booked", "lost"];

/** Small pipeline strip so the sales team sees the funnel, not just a list. */
function Pipeline({ rows }: { rows: any[] }) {
  const byStatus = new Map<string, { count: number; value: number }>();
  for (const l of rows) {
    const key = l.status || "new";
    const agg = byStatus.get(key) || { count: 0, value: 0 };
    agg.count += 1;
    agg.value += l.estimated_value ?? 0;
    byStatus.set(key, agg);
  }
  const open = rows.filter((l) => !["booked", "lost"].includes(l.status || ""));
  const won = rows.filter((l) => l.status === "booked");
  const pipelineValue = open.reduce((s, l) => s + (l.estimated_value ?? 0), 0);
  const wonValue = won.reduce((s, l) => s + (l.estimated_value ?? 0), 0);
  const closed = won.length + rows.filter((l) => l.status === "lost").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="primary" icon="Sparkles" label="Oportunidades abiertas"
          value={formatNumber(open.length)} hint={`${formatNumber(rows.length)} leads en total`} />
        <KpiCard icon="Banknote" label="Valor del pipeline" value={formatMoney(pipelineValue, "usd")}
          hint="Suma del valor estimado de los leads abiertos" />
        <KpiCard tone="ink" icon="Trophy" label="Ganado" value={formatMoney(wonValue, "usd")}
          hint={`${formatNumber(won.length)} leads convertidos en reserva`} />
        <KpiCard tone="amber" icon="Target" label="Tasa de conversión"
          value={`${closed > 0 ? ((won.length / closed) * 100).toFixed(0) : 0}%`}
          hint={`${formatNumber(closed)} leads cerrados`} />
      </div>

      <div className="tf-card tf-scroll flex gap-2 overflow-x-auto p-3">
        {PIPELINE.map((status) => {
          const agg = byStatus.get(status) || { count: 0, value: 0 };
          return (
            <div key={status} className="min-w-[140px] flex-1 rounded-lg border border-border bg-muted/25 p-3">
              <StatusBadge value={status} dict={LEAD_STATUS} />
              <p className="mt-2 font-display text-xl font-semibold tabular-nums">{agg.count}</p>
              <p className="text-xs text-muted-foreground">{formatMoney(agg.value, "usd")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CrmPage() {
  const [sellerLabel, setSellerLabel] = useState<Record<string, string>>({});

  // Cheap lookup so the table can show the seller name without expanding twice.
  useEffect(() => {
    api.get<any[]>("/api/erp/seller?limit=300").then((res) => {
      if (!res.ok) {
        console.error("[crm] no se pudieron cargar los vendedores:", res.error);
        return;
      }
      const map: Record<string, string> = {};
      for (const s of res.data || []) {
        map[s._id] = [s.first_name, s.last_name].filter(Boolean).join(" ") || s.code || "Vendedor";
      }
      setSellerLabel(map);
    });
  }, []);

  return (
    <ResourcePage
      resource="lead"
      eyebrow="Comercial"
      title="CRM y oportunidades"
      description="Cada lead conserva su origen, su vendedor y su valor estimado hasta que se convierte en venta o se pierde."
      createLabel="Nuevo lead"
      searchPlaceholder="Buscar por nombre, email o teléfono…"
      emptyIcon="Sparkles"
      emptyTitle="Todavía no hay leads"
      emptyDescription="Registra las oportunidades que llegan por WhatsApp, web o recomendación para no perder ninguna."
      renderSummary={(rows) => <Pipeline rows={rows} />}
      filters={[
        { name: "status", label: "Etapa", options: optionsFrom(LEAD_STATUS) },
        { name: "source", label: "Origen", options: optionsFrom(CHANNEL) },
      ]}
      columns={[
        {
          key: "name", header: "Lead",
          render: (l: any) => (
            <div>
              <p className="font-semibold">{l.name || "Sin nombre"}</p>
              <p className="text-xs text-muted-foreground">{l.email || l.phone || l.whatsapp || "Sin contacto"}</p>
            </div>
          ),
        },
        { key: "product", header: "Interés", hideOn: "md",
          render: (l: any) => (typeof l.product === "object" && l.product ? l.product.name : "—") },
        { key: "seller", header: "Vendedor", hideOn: "lg",
          render: (l: any) => {
            const s = l.seller;
            if (s && typeof s === "object") return [s.first_name, s.last_name].filter(Boolean).join(" ");
            return typeof s === "string" ? sellerLabel[s] || "—" : "—";
          } },
        { key: "pax", header: "Pax", align: "right", hideOn: "sm", render: (l: any) => formatNumber(l.pax ?? 0) },
        { key: "value", header: "Valor estimado", align: "right",
          render: (l: any) => formatMoney(l.estimated_value ?? 0, l.currency) },
        { key: "next", header: "Próxima acción", align: "right", hideOn: "lg",
          render: (l: any) => (l.next_action_at ? formatDate(l.next_action_at) : "—") },
        { key: "status", header: "Etapa", render: (l: any) => <StatusBadge value={l.status} dict={LEAD_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre del lead", required: true, span: 2 },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Teléfono" },
        { name: "whatsapp", label: "WhatsApp" },
        { name: "customer", label: "Cliente existente", type: "reference", resource: "customer",
          optionLabel: (c: any) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Cliente" },
        { name: "product", label: "Excursión de interés", type: "reference", resource: "product" },
        { name: "seller", label: "Vendedor asignado", type: "reference", resource: "seller",
          optionLabel: (s: any) => [s.first_name, s.last_name].filter(Boolean).join(" ") },
        { name: "partner", label: "Partner", type: "reference", resource: "partner",
          optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "source", label: "Origen", type: "select", options: optionsFrom(CHANNEL) },
        { name: "status", label: "Etapa", type: "select", defaultValue: "new", options: optionsFrom(LEAD_STATUS) },
        { name: "pax", label: "Pax estimados", type: "number" },
        { name: "estimated_value", label: "Valor estimado", type: "number" },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "travel_date", label: "Fecha de viaje prevista", type: "date" },
        { name: "next_action_at", label: "Próxima acción", type: "datetime" },
        { name: "lost_reason", label: "Motivo de pérdida", span: 2 },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
