"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { TICKET_STATUS, TICKET_TYPE } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";

export default function AccesosPage() {
  return (
    <ResourcePage
      resource="access_ticket"
      eyebrow="Parque"
      title="Accesos y pulseras"
      description="Pases emitidos con su vigencia, entradas restantes y redenciones. Cada validación en puerta descuenta de aquí."
      createLabel="Emitir pase"
      emptyIcon="Nfc"
      emptyTitle="Sin pases emitidos"
      emptyDescription="Los pases se emiten desde el punto de venta o manualmente para cortesías y staff."
      initialSort="-issued_at"
      filters={[
        { name: "status", label: "Estado", options: optionsFrom(TICKET_STATUS) },
        { name: "ticket_type", label: "Tipo", options: optionsFrom(TICKET_TYPE) },
      ]}
      columns={[
        {
          key: "code", header: "Pase",
          render: (t: any) => (
            <div>
              <p className="tf-num font-semibold">{t.code || t.wristband_code || "—"}</p>
              <p className="text-xs text-muted-foreground">
                {t.holder_name || t.customer?.first_name
                  ? t.holder_name || `${t.customer?.first_name || ""} ${t.customer?.last_name || ""}`.trim()
                  : "Sin titular"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", render: (t: any) => <StatusBadge value={t.ticket_type} dict={TICKET_TYPE} dot={false} /> },
        { key: "product", header: "Producto", hideOn: "md", render: (t: any) => <span className="text-xs">{t.product?.name || "—"}</span> },
        {
          key: "uses", header: "Entradas", align: "right",
          render: (t: any) => (
            <span className="tf-num">
              {formatNumber(t.entries_used)}
              <span className="text-muted-foreground">/{t.entries_allowed ? formatNumber(t.entries_allowed) : "∞"}</span>
            </span>
          ),
        },
        { key: "valid", header: "Vigencia", hideOn: "sm", render: (t: any) => <span className="tf-num text-xs">{formatDateTime(t.valid_to)}</span> },
        { key: "price", header: "Precio", align: "right", hideOn: "lg", render: (t: any) => formatMoney(t.price, t.currency || "usd") },
        { key: "status", header: "Estado", render: (t: any) => <StatusBadge value={t.status} dict={TICKET_STATUS} /> },
      ]}
      fields={[
        { name: "code", label: "Código", required: true },
        { name: "ticket_type", label: "Tipo", type: "select", defaultValue: "day_pass", options: optionsFrom(TICKET_TYPE) },
        { name: "status", label: "Estado", type: "select", defaultValue: "issued", options: optionsFrom(TICKET_STATUS) },
        { name: "holder_name", label: "Titular" },
        { name: "customer", label: "Cliente", type: "reference", resource: "customer",
          optionLabel: (c: any) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || c._id },
        { name: "product", label: "Producto", type: "reference", resource: "product" },
        { name: "booking", label: "Reserva", type: "reference", resource: "booking", optionLabel: (b: any) => b.booking_number || b._id },
        { name: "valid_from", label: "Válido desde", type: "datetime" },
        { name: "valid_to", label: "Válido hasta", type: "datetime" },
        { name: "entries_allowed", label: "Entradas permitidas", type: "number", help: "Vacío = ilimitadas." },
        { name: "entries_used", label: "Entradas usadas", type: "number" },
        { name: "wristband_code", label: "Código de pulsera" },
        { name: "price", label: "Precio", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
