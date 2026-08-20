"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { ITEM_TYPE, ITEM_UNIT, YES_NO } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

export default function ArticulosPage() {
  return (
    <ResourcePage
      resource="inventory_item"
      eyebrow="Comercio"
      title="Artículos de inventario"
      description="Alimentos, bebidas, retail, uniformes y consumibles con costo, precio y punto de reorden. El margen que ves aquí es el que defiende la tienda."
      createLabel="Nuevo artículo"
      emptyIcon="Boxes"
      emptyTitle="Sin artículos"
      emptyDescription="Registra tus artículos para llevar inventario perpetuo y controlar mermas."
      filters={[
        { name: "item_type", label: "Tipo", options: optionsFrom(ITEM_TYPE) },
        { name: "is_sellable", label: "Se vende", options: optionsFrom(YES_NO) },
      ]}
      columns={[
        {
          key: "name", header: "Artículo",
          render: (i: any) => (
            <div>
              <p className="font-semibold">{i.name}</p>
              <p className="text-xs text-muted-foreground">
                {[i.sku, i.barcode, i.product_category?.name].filter(Boolean).join(" · ") || "Sin SKU"}
              </p>
            </div>
          ),
        },
        { key: "type", header: "Tipo", hideOn: "md", render: (i: any) => <StatusBadge value={i.item_type} dict={ITEM_TYPE} dot={false} /> },
        { key: "unit", header: "Unidad", hideOn: "lg", render: (i: any) => <span className="text-xs">{ITEM_UNIT[i.unit]?.label || "—"}</span> },
        { key: "cost", header: "Costo", align: "right", hideOn: "sm", render: (i: any) => formatMoney(i.cost, i.currency || "usd") },
        { key: "price", header: "Precio", align: "right", render: (i: any) => formatMoney(i.price, i.currency || "usd") },
        {
          key: "margin", header: "Margen", align: "right", hideOn: "sm",
          render: (i: any) => {
            if (!i.price || !i.cost) return <span className="text-muted-foreground">—</span>;
            const pct = ((i.price - i.cost) / i.price) * 100;
            return <span className={`tf-num font-semibold ${pct < 20 ? "text-rose-600 dark:text-rose-400" : ""}`}>{formatPercent(pct)}</span>;
          },
        },
        { key: "reorder", header: "Reorden", align: "right", hideOn: "lg", render: (i: any) => <span className="tf-num">{formatNumber(i.reorder_point)}</span> },
        { key: "status", header: "Estado", render: (i: any) => <StatusBadge value={i.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "sku", label: "SKU" },
        { name: "barcode", label: "Código de barras" },
        { name: "item_type", label: "Tipo", type: "select", defaultValue: "retail", options: optionsFrom(ITEM_TYPE) },
        { name: "unit", label: "Unidad", type: "select", defaultValue: "unit", options: optionsFrom(ITEM_UNIT) },
        { name: "product_category", label: "Categoría", type: "reference", resource: "product_category" },
        { name: "supplier", label: "Proveedor habitual", type: "reference", resource: "supplier" },
        { name: "cost", label: "Costo", type: "number" },
        { name: "price", label: "Precio de venta", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "tax_rate", label: "Impuesto", type: "number", suffix: "%" },
        { name: "min_stock", label: "Stock mínimo", type: "number" },
        { name: "max_stock", label: "Stock máximo", type: "number" },
        { name: "reorder_point", label: "Punto de reorden", type: "number" },
        { name: "reorder_qty", label: "Cantidad a reordenar", type: "number" },
        { name: "shelf_life_days", label: "Vida útil", type: "number", suffix: "días" },
        { name: "is_sellable", label: "Se vende al público", type: "select", defaultValue: "yes", options: optionsFrom(YES_NO) },
        { name: "tracks_lots", label: "Controla lotes", type: "select", defaultValue: "no", options: optionsFrom(YES_NO) },
        { name: "image_url", label: "Imagen (URL)", type: "url", span: 2 },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
