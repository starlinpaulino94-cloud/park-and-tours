"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { GENERIC_STATUS } from "@/lib/labels";
import { ITEM_UNIT } from "@/lib/labels-modules";
import { optionsFrom, CURRENCY_OPTIONS } from "@/components/tf/options";
import { formatMoney, formatNumber } from "@/lib/format";

export default function RepuestosPage() {
  return (
    <ResourcePage
      resource="inventory_item"
      eyebrow="Mantenimiento"
      title="Repuestos"
      description="Piezas críticas con su stock mínimo y proveedor. Un repuesto agotado es downtime esperando a ocurrir."
      createLabel="Nuevo repuesto"
      emptyIcon="Bolt"
      emptyTitle="Sin repuestos registrados"
      emptyDescription="Registra las piezas críticas de tus activos para no quedarte sin stock en temporada."
      fixedFilters={{ item_type: "spare_part" }}
      columns={[
        {
          key: "name", header: "Repuesto",
          render: (i: any) => (
            <div>
              <p className="font-semibold">{i.name}</p>
              <p className="text-xs text-muted-foreground">
                {[i.sku, i.supplier?.name].filter(Boolean).join(" · ") || "Sin SKU"}
              </p>
            </div>
          ),
        },
        { key: "unit", header: "Unidad", hideOn: "md", render: (i: any) => <span className="text-xs">{ITEM_UNIT[i.unit]?.label || "—"}</span> },
        { key: "cost", header: "Costo", align: "right", render: (i: any) => formatMoney(i.cost, i.currency || "usd") },
        { key: "min", header: "Mínimo", align: "right", hideOn: "sm", render: (i: any) => <span className="tf-num">{formatNumber(i.min_stock)}</span> },
        { key: "reorder", header: "Reorden", align: "right", hideOn: "sm", render: (i: any) => <span className="tf-num">{formatNumber(i.reorder_point)}</span> },
        { key: "status", header: "Estado", render: (i: any) => <StatusBadge value={i.status} dict={GENERIC_STATUS} /> },
      ]}
      fields={[
        { name: "name", label: "Nombre", required: true, span: 2 },
        { name: "sku", label: "SKU / número de parte" },
        { name: "unit", label: "Unidad", type: "select", defaultValue: "unit", options: optionsFrom(ITEM_UNIT) },
        { name: "supplier", label: "Proveedor", type: "reference", resource: "supplier" },
        { name: "cost", label: "Costo", type: "number" },
        { name: "currency", label: "Moneda", type: "select", options: CURRENCY_OPTIONS },
        { name: "min_stock", label: "Stock mínimo", type: "number" },
        { name: "reorder_point", label: "Punto de reorden", type: "number" },
        { name: "reorder_qty", label: "Cantidad a reordenar", type: "number" },
        { name: "is_sellable", label: "Se vende", type: "select", defaultValue: "no",
          options: [{ value: "no", label: "No" }, { value: "yes", label: "Sí" }] },
        { name: "status", label: "Estado", type: "select", defaultValue: "active",
          options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]}
    />
  );
}
