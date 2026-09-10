"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { ACTIVE_STATUS, CHANNEL, GENERIC_STATUS } from "@/lib/labels";
import { PRICE_TYPE, WEEKDAY } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

export default function Page() {
  return (
    <SimpleResource
      resource="price_rule"
      eyebrow="Catálogo"
      title="Reglas de precio"
      description="Tarifas por canal, socio, temporada y volumen. La regla de mayor prioridad gana al cotizar."
      emptyIcon="Tags"
      filters={[
        { name: "price_type", label: "Tipo", dict: PRICE_TYPE },
        { name: "channel", label: "Canal", dict: CHANNEL },
      ]}
      emptyTitle="Sin reglas de precio"
      emptyDescription="Sin una regla, el precio sale del precio base del producto."
      createLabel="Nueva regla"
      fields={[
        { name: "name", label: "Nombre de la regla", required: true },
        { name: "price_type", label: "Tipo", type: "select", defaultValue: "standard", options: optionsFrom(PRICE_TYPE) },
        { name: "amount", label: "Importe", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "product", label: "Producto", type: "reference", resource: "product" },
        { name: "modality", label: "Modalidad", type: "reference", resource: "product_modality" },
        { name: "channel", label: "Canal", type: "select", options: optionsFrom(CHANNEL) },
        { name: "partner", label: "Socio", type: "reference", resource: "partner", optionLabel: (p: any) => p.commercial_name || p.name },
        { name: "seller", label: "Vendedor", type: "reference", resource: "seller", optionLabel: (s: any) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.code },
        { name: "season_from", label: "Temporada desde", type: "date" },
        { name: "season_to", label: "Temporada hasta", type: "date" },
        { name: "time_from", label: "Hora desde", placeholder: "08:00" },
        { name: "time_to", label: "Hora hasta", placeholder: "18:00" },
        { name: "min_qty", label: "Cantidad mínima", type: "number" },
        { name: "max_qty", label: "Cantidad máxima", type: "number" },
        { name: "priority", label: "Prioridad", type: "number", help: "La regla de mayor prioridad gana al cotizar." },
        { name: "weekdays", label: "Días de la semana", type: "multiselect", options: optionsFrom(WEEKDAY), span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
      ]}
      columns={[
        { key: "name", header: "Regla" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "price_type", header: "Tipo", kind: "badge", dict: PRICE_TYPE },
        { key: "channel", header: "Canal", kind: "badge", dict: CHANNEL },
        { key: "amount", header: "Importe", kind: "money", align:"right" },
        { key: "priority", header: "Prioridad", kind: "number", align:"right" },
        { key: "status", header: "Estado", kind: "badge", dict: GENERIC_STATUS },
      ]}
    />
  );
}
