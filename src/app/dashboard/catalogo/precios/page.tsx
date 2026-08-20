"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { CHANNEL, GENERIC_STATUS } from "@/lib/labels";
import { PRICE_TYPE } from "@/lib/labels-modules";

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
