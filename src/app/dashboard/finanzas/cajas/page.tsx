"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { GENERIC_STATUS } from "@/lib/labels";

export default function Page() {
  return (
    <SimpleResource
      resource="cash_register"
      eyebrow="Finanzas"
      title="Cajas registradoras"
      description="Cajas y terminales por sucursal. Cada apertura de turno se asocia a una de ellas."
      emptyIcon="Calculator"
      columns={[
        { key: "name", header: "Caja" },
        { key: "code", header: "Código" },
        { key: "terminal", header: "Terminal", hideOn:"md" },
        { key: "branch", header: "Sucursal", kind: "ref" },
        { key: "currency", header: "Moneda" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
