"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { TICKET_STATUS, TICKET_TYPE } from "@/lib/labels-modules";

export default function Page() {
  return (
    <SimpleResource
      resource="access_ticket"
      eyebrow="Ventas"
      title="Tickets de acceso"
      description="Entradas, pulseras y pases emitidos, con su vigencia y las entradas que quedan disponibles."
      emptyIcon="Ticket"
      filters={[
        { name: "status", label: "Estado", dict: TICKET_STATUS },
        { name: "ticket_type", label: "Tipo", dict: TICKET_TYPE },
      ]}
      columns={[
        { key: "code", header: "Ticket" },
        { key: "ticket_type", header: "Tipo", kind: "badge", dict: TICKET_TYPE },
        { key: "status", header: "Estado", kind: "badge", dict: TICKET_STATUS },
        { key: "holder_name", header: "Titular", hideOn:"md" },
        { key: "valid_from", header: "Desde", kind: "date", hideOn:"lg" },
        { key: "valid_to", header: "Hasta", kind: "date" },
        { key: "entries_used", header: "Usos", kind: "number", align:"right" },
      ]}
    />
  );
}
