"use client";

import { SimpleResource } from "@/components/tf/simple-resource";
import { EXTRA_PRICE_TYPE, YES_NO } from "@/lib/labels-modules";
import { ACTIVE_STATUS } from "@/lib/labels";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";

/**
 * Los extras que se venden con la excursión.
 *
 * Es donde está el margen de una operadora: el tour compite por precio y el
 * almuerzo langosta no. Sin esta pantalla el vendedor tenía dos salidas, las dos
 * malas — crear un producto suelto que ensucia el catálogo y descuadra la
 * ocupación de las salidas, o cobrarlo por fuera del sistema, donde no aparece
 * ni en la rentabilidad del tour ni en el voucher del cliente.
 */
export default function Page() {
  return (
    <SimpleResource
      resource="product_extra"
      eyebrow="Catálogo"
      title="Extras y complementos"
      description="Lo que se vende junto al tour: almuerzo, fotos, transfer premium, seguro, entradas. Los marcados como obligatorios se añaden solos a cada reserva."
      emptyIcon="Gift"
      emptyTitle="Todavía no hay extras"
      emptyDescription="Un extra se ofrece en el punto de venta al añadir su producto al carrito, y viaja en el voucher del cliente."
      createLabel="Nuevo extra"
      filters={[
        { name: "price_type", label: "Cobro", dict: EXTRA_PRICE_TYPE },
        { name: "status", label: "Estado", dict: ACTIVE_STATUS },
      ]}
      fields={[
        { name: "product", label: "Producto", type: "reference", resource: "product", required: true,
          optionLabel: (p: any) => p.name,
          help: "El extra se ofrece al añadir ESE producto al carrito." },
        { name: "name", label: "Nombre", required: true, placeholder: "Almuerzo langosta" },
        { name: "price_type", label: "Cómo se cobra", type: "select", defaultValue: "per_person",
          options: optionsFrom(EXTRA_PRICE_TYPE),
          help: "Por persona multiplica por los pax que pagan; por reserva es un importe único." },
        { name: "price", label: "Precio", type: "number", required: true },
        { name: "cost", label: "Coste", type: "number",
          help: "Lo que paga la empresa al proveedor. De aquí sale el margen real del extra." },
        { name: "currency", label: "Moneda", type: "select", defaultValue: "usd", options: CURRENCY_OPTIONS },
        { name: "is_required", label: "¿Obligatorio?", type: "select", defaultValue: "no", options: optionsFrom(YES_NO),
          help: "Una tasa que el cliente paga igual (entrada al parque, impuesto de muelle): se añade sola a cada reserva." },
        { name: "max_quantity", label: "Cantidad máxima", type: "number",
          help: "Vacío = sin tope." },
        { name: "sort_order", label: "Orden", type: "number" },
        { name: "status", label: "Estado", type: "select", defaultValue: "active", options: optionsFrom(ACTIVE_STATUS) },
        { name: "description", label: "Descripción", type: "textarea", span: 2,
          help: "Lo que el vendedor le lee al cliente cuando se lo ofrece." },
      ]}
      columns={[
        { key: "name", header: "Extra" },
        { key: "product", header: "Producto", kind: "ref" },
        { key: "price_type", header: "Cobro", kind: "badge", dict: EXTRA_PRICE_TYPE },
        { key: "price", header: "Precio", kind: "money", align: "right" },
        { key: "cost", header: "Coste", kind: "money", align: "right" },
        { key: "is_required", header: "Obligatorio", kind: "badge", dict: YES_NO },
        { key: "status", header: "Estado", kind: "badge", dict: ACTIVE_STATUS },
      ]}
    />
  );
}
