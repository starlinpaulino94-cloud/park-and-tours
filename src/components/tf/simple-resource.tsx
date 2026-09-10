"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import type { FieldDef } from "@/components/tf/resource-form";
import { StatusBadge } from "@/components/tf/status-badge";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import type { LabelDef } from "@/lib/labels";

/**
 * Pantalla de lista para un recurso del ERP.
 *
 * Nació como vista de solo lectura mientras cada módulo esperaba su formulario
 * propio, y el "mientras tanto" se quedó: 34 pantallas listaban datos que la
 * aplicación no ofrecía ninguna forma de crear. Un catálogo de categorías o una
 * tasa de cambio no se pueden dar de alta desde ningún sitio, así que el módulo
 * queda muerto por mucho que la tabla se pinte bien.
 *
 * Ahora acepta `fields`: con ellos la pantalla gana alta, edición y borrado con
 * el mismo formulario genérico que el resto del ERP. Sin ellos sigue siendo de
 * solo lectura, que es lo correcto para lo que genera otro flujo —un asiento
 * contable, un voucher, una comisión— y no debe teclearse a mano.
 */
export interface SimpleColumn {
  key: string;
  header: string;
  kind?: "text" | "money" | "number" | "date" | "datetime" | "badge" | "ref";
  dict?: Record<string, LabelDef>;
  /** For `ref`: how to label the expanded relation. */
  refLabel?: (row: any) => string;
  currencyKey?: string;
  align?: "left" | "right" | "center";
  hideOn?: "sm" | "md" | "lg";
}

function cell(row: any, col: SimpleColumn) {
  const value = row?.[col.key];
  switch (col.kind) {
    case "money":
      return formatMoney(Number(value ?? 0), row?.[col.currencyKey || "currency"] || "usd");
    case "number":
      return formatNumber(Number(value ?? 0));
    case "date":
      return value ? formatDate(value) : "—";
    case "datetime":
      return value ? formatDateTime(value) : "—";
    case "badge":
      return col.dict ? <StatusBadge value={value} dict={col.dict} /> : (value ?? "—");
    case "ref": {
      if (!value) return "—";
      if (typeof value === "string") return value;
      return col.refLabel ? col.refLabel(value) : value.name || value.code || value.title || "—";
    }
    default:
      return value === null || value === undefined || value === "" ? "—" : String(value);
  }
}

export function SimpleResource({
  resource, eyebrow, title, description, columns, fields, createLabel,
  emptyTitle, emptyDescription, searchPlaceholder, emptyIcon, filters, fixedFilters, initialSort,
}: {
  resource: string;
  eyebrow: string;
  title: string;
  description: string;
  columns: SimpleColumn[];
  /** Campos del formulario. Sin ellos la pantalla es de solo lectura. */
  fields?: FieldDef[];
  createLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  searchPlaceholder?: string;
  emptyIcon?: string;
  filters?: { name: string; label: string; dict: Record<string, LabelDef> }[];
  fixedFilters?: Record<string, string>;
  initialSort?: string;
}) {
  return (
    <ResourcePage
      resource={resource}
      eyebrow={eyebrow}
      title={title}
      description={description}
      canWrite={Boolean(fields?.length)}
      createLabel={createLabel}
      searchPlaceholder={searchPlaceholder}
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle || "Todavía no hay datos en este módulo"}
      emptyDescription={emptyDescription || (fields?.length
        ? "Crea el primero con el botón de arriba."
        : "En cuanto se registren movimientos aparecerán aquí.")}
      fixedFilters={fixedFilters}
      initialSort={initialSort}
      filters={filters?.map((f) => ({ name: f.name, label: f.label, options: optionsFrom(f.dict) }))}
      fields={fields || []}
      columns={columns.map((col) => ({
        key: col.key,
        header: col.header,
        align: col.align,
        hideOn: col.hideOn,
        render: (row: any) => cell(row, col),
      }))}
    />
  );
}
