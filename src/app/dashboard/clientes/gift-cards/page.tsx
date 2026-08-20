"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GIFT_CARD_STATUS } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="gift_card"
      eyebrow="Clientes"
      title="Gift cards"
      description="Tarjetas de regalo emitidas con su saldo vigente. Cada redención queda registrada como movimiento."
      emptyIcon="Gift"
      filters={[
        { name: "status", label: "Estado", dict: GIFT_CARD_STATUS },
      ]}
      columns={[
        { key: "code", header: "Código" },
        { key: "recipient_name", header: "Destinatario" },
        { key: "initial_amount", header: "Emitida", kind: "money", align:"right" },
        { key: "balance", header: "Saldo", kind: "money", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GIFT_CARD_STATUS },
        { key: "expires_at", header: "Vence", kind: "date", hideOn:"md" },
      ]}
    />
  );
}
