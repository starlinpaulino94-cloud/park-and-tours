"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { optionsFrom } from "@/components/tf/options";

/**
 * Categorías de gasto.
 *
 * El formulario de gastos pide la categoría con un selector de referencia, pero
 * no existía ninguna pantalla para darlas de alta: el selector salía siempre
 * vacío y todo gasto quedaba sin clasificar.
 */
export default function Page() {
  return (
    <SimpleResource
      resource="expense_category"
      eyebrow="Finanzas"
      title="Categorías de gasto"
      description="Clasificación de los gastos operativos. Es lo que agrupa el desglose por categoría del informe de gastos."
      emptyIcon="FolderTree"
      createLabel="Nueva categoría"
      emptyTitle="Sin categorías de gasto"
      emptyDescription="Sin categorías, el selector del formulario de gastos sale vacío y nada queda clasificado."
      fields={[
        { name: "name", label: "Nombre", required: true },
        { name: "description", label: "Descripción", type: "textarea", span: 2 },
        { name: "color", label: "Color", placeholder: "#F97316" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "name", header: "Categoría" },
        { key: "description", header: "Descripción", hideOn: "md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
