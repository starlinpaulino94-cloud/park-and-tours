"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS } from "@/lib/labels";
import { ALLOTMENT_TYPE, WEEKDAY } from "@/lib/labels-modules";
import { optionsFrom } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="allotment"
      eyebrow="Distribución"
      title="Allotments"
      description="Cupos garantizados y free sale por socio o canal, con liberación automática antes de la salida."
      emptyIcon="TableProperties"
      filters={[
        { name: "allotment_type", label: "Tipo", dict: ALLOTMENT_TYPE },
      ]}
      emptyTitle="Sin cupos asignados"
      emptyDescription="Reserva capacidad garantizada para un socio, con su fecha de liberación."
      createLabel="Nuevo allotment"
      fields={[
        { name: "partner", label: "Socio", type: "reference", resource: "partner", optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "product", label: "Producto", type: "reference", resource: "product" },
        { name: "product_modality", label: "Modalidad", type: "reference", resource: "product_modality" },
        { name: "allotment_type", label: "Tipo", type: "select", defaultValue: "free_sale", options: optionsFrom(ALLOTMENT_TYPE) },
        { name: "seats", label: "Cupos", type: "number" },
        { name: "release_days", label: "Liberar con antelación", type: "number", suffix: "días" },
        { name: "valid_from", label: "Vigente desde", type: "date" },
        { name: "valid_to", label: "Vigente hasta", type: "date" },
        { name: "weekdays", label: "Días de la semana", type: "multiselect", options: optionsFrom(WEEKDAY), span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
      columns={[
        { key: "partner", header: "Socio", kind: "ref" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "allotment_type", header: "Tipo", kind: "badge", dict: ALLOTMENT_TYPE },
        { key: "seats", header: "Cupos", kind: "number", align:"right" },
        { key: "seats_used", header: "Usados", kind: "number", align:"right" },
        { key: "valid_from", header: "Desde", kind: "date", hideOn:"md" },
        { key: "valid_to", header: "Hasta", kind: "date", hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
