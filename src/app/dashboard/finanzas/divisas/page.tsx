"use client";

import { SimpleResource } from "@/components/tf/simple-resource";

export default function Page() {
  return (
    <SimpleResource
      resource="currency_rate"
      eyebrow="Finanzas"
      title="Tipos de cambio"
      description="Tasas por fecha usadas para convertir ventas, costos y asientos a la moneda base de la empresa."
      emptyIcon="ArrowLeftRight"
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
