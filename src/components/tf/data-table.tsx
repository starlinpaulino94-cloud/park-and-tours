"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/tf/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/tf/empty-state";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  hideOn?: "sm" | "md" | "lg";
}

export function DataTable<T extends { _id: string }>({
  rows, columns, loading, onRowClick, emptyTitle = "Sin resultados",
  emptyDescription, emptyIcon = "Inbox", footer, className,
}: {
  rows: T[];
  columns: Column<T>[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

  if (loading) {
    return (
      <div className="tf-card overflow-hidden">
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="tf-card p-2">
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className={cn("tf-card overflow-hidden", className)}>
      <div className="tf-scroll overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.hideOn && hide[c.hideOn]
                  )}
                >
                  {c.header}
                </th>
              ))}
              {onRowClick && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row._id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/60 transition-colors last:border-0",
                  onRowClick && "cursor-pointer hover:bg-muted/50",
                  i % 2 === 1 && "bg-muted/15"
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3 align-middle",
                      c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "",
                      c.hideOn && hide[c.hideOn],
                      c.className
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
                {onRowClick && (
                  <td className="px-2 text-muted-foreground">
                    <Icon name="ChevronRight" className="size-4" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-border bg-muted/25 px-4 py-2.5 text-sm">{footer}</div>}
    </div>
  );
}
