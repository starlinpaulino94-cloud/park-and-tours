"use client";

import { ResourcePage } from "@/components/tf/resource-page";
import { StatusBadge } from "@/components/tf/status-badge";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { optionsFrom } from "@/components/tf/options";
import type { LabelDef } from "@/lib/labels";

/**
 * Read-only list screen for a registered ERP resource.
 *
 * Modules that still need their own purpose-built screen use this so the data
 * in the table is already visible and searchable. Editing for these modules is
 * intentionally disabled until each one gets its proper form.
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
  resource, eyebrow, title, description, columns, emptyIcon, filters, fixedFilters, initialSort,
}: {
  resource: string;
  eyebrow: string;
  title: string;
  description: string;
  columns: SimpleColumn[];
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
      canWrite={false}
      emptyIcon={emptyIcon}
      emptyTitle="Todavía no hay datos en este módulo"
      emptyDescription="En cuanto se registren movimientos aparecerán aquí."
      fixedFilters={fixedFilters}
      initialSort={initialSort}
      filters={filters?.map((f) => ({ name: f.name, label: f.label, options: optionsFrom(f.dict) }))}
      fields={[]}
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
