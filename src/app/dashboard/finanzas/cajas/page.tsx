"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="cash_register"
      eyebrow="Finanzas"
      title="Cajas registradoras"
      description="Cajas y terminales por sucursal. Cada apertura de turno se asocia a una de ellas."
      emptyIcon="Calculator"
      emptyTitle="Sin cajas registradas"
      emptyDescription="Sin una caja no se puede abrir turno ni cobrar en el punto de venta."
      createLabel="Nueva caja"
      fields={[
        { name: "name", label: "Caja", required: true },
        { name: "code", label: "Código" },
        { name: "terminal", label: "Terminal", help: "Identificador del punto físico o del datáfono." },
        { name: "branch", label: "Sucursal", type: "reference", resource: "branch" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
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
