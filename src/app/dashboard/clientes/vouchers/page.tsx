"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { VOUCHER_STATUS } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="voucher"
      eyebrow="Clientes"
      title="Vouchers"
      description="Vouchers emitidos por reserva, con su código QR, vigencia y estado de uso."
      emptyIcon="QrCode"
      filters={[
        { name: "status", label: "Estado", dict: VOUCHER_STATUS },
      ]}
      columns={[
        { key: "code", header: "Voucher" },
        { key: "status", header: "Estado", kind: "badge", dict: VOUCHER_STATUS },
        { key: "issued_at", header: "Emitido", kind: "datetime", hideOn:"md" },
        { key: "used_at", header: "Usado", kind: "datetime" },
        { key: "expires_at", header: "Vence", kind: "date" },
      ]}
    />
  );
}
