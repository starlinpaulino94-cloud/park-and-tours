"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="currency_rate"
      eyebrow="Finanzas"
      title="Tipos de cambio"
      description="Tasas por fecha usadas para convertir ventas, costos y asientos a la moneda base de la empresa."
      emptyIcon="ArrowLeftRight"
      emptyTitle="Sin tasas de cambio"
      emptyDescription="La tasa del día es lo que convierte una venta en moneda extranjera a la moneda base."
      createLabel="Nueva tasa"
      fields={[
        { name: "currency_from", label: "De", type: "select", required: true, options: CURRENCY_OPTIONS },
        { name: "currency_to", label: "A", type: "select", required: true, options: CURRENCY_OPTIONS },
        { name: "rate", label: "Tasa", type: "number", required: true },
        { name: "rate_date", label: "Fecha", type: "date", required: true },
        { name: "source", label: "Fuente", placeholder: "Banco Central, manual…" },
      ]}
      columns={[
        { key: "rate_date", header: "Fecha", kind: "date" },
        { key: "currency_from", header: "De" },
        { key: "currency_to", header: "A" },
        { key: "rate", header: "Tasa", kind: "number", align:"right" },
        { key: "source", header: "Fuente", hideOn:"md" },
      ]}
    />
  );
}
