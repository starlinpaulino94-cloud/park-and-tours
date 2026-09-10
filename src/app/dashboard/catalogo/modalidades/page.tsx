"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, GENERIC_STATUS, MODALITY_TYPE } from "@/lib/labels";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="product_modality"
      eyebrow="Catálogo"
      title="Modalidades"
      description="Variantes vendibles de cada producto: adulto, niño, VIP, privado o por vehículo, con su precio y costo."
      emptyIcon="Layers"
      filters={[
        { name: "modality_type", label: "Tipo", dict: MODALITY_TYPE },
      ]}
      emptyTitle="Sin modalidades"
      emptyDescription="Cada producto necesita al menos una modalidad vendible con su precio."
      createLabel="Nueva modalidad"
      fields={[
        { name: "product", label: "Producto", type: "reference", resource: "product", required: true },
        { name: "name", label: "Modalidad", required: true },
        { name: "code", label: "Código" },
        { name: "modality_type", label: "Tipo", type: "select", defaultValue: "adult", options: optionsFrom(MODALITY_TYPE) },
        { name: "price", label: "Precio", type: "number" },
        { name: "cost", label: "Costo", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "min_pax", label: "Pax mínimo", type: "number" },
        { name: "max_pax", label: "Pax máximo", type: "number" },
        { name: "age_from", label: "Edad desde", type: "number" },
        { name: "age_to", label: "Edad hasta", type: "number" },
        { name: "capacity_weight", label: "Peso en el cupo", type: "number", help: "Cuánto ocupa una unidad de esta modalidad en la capacidad de la salida." },
        { name: "sort_order", label: "Orden", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "name", header: "Modalidad" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "modality_type", header: "Tipo", kind: "badge", dict: MODALITY_TYPE },
        { key: "price", header: "Precio", kind: "money", align:"right" },
        { key: "cost", header: "Costo", kind: "money", align:"right",hideOn:"md" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
