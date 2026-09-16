"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable, type Column } from "@/components/tf/data-table";
import { ResourceForm, type FieldDef } from "@/components/tf/resource-form";
import { Icon } from "@/components/tf/icon";

export interface FilterDef {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Data-driven CRUD screen on top of `/api/erp/[resource]`.
 * Every module that is a straight master-data list reuses this.
 */
export function ResourcePage<T extends { _id: string }>({
  resource, eyebrow, title, description, columns, fields, filters, fixedFilters,
  searchPlaceholder = "Buscar…", createLabel = "Nuevo registro",
  emptyTitle, emptyDescription, emptyIcon, canWrite = true,
  extraActions, renderSummary, onRowClick, pageSize = 50, initialSort, embedded = false,
}: {
  resource: string;
  eyebrow?: string;
  title: string;
  description?: string;
  columns: Column<T>[];
  fields: FieldDef[];
  filters?: FilterDef[];
  /**
   * Always-on equality filters. They scope the list (e.g. only spare parts) and
   * are also merged into every record created from this screen, so a scoped
   * module can never produce a record that falls outside its own view.
   */
  fixedFilters?: Record<string, string>;
  searchPlaceholder?: string;
  createLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: string;
  canWrite?: boolean;
  extraActions?: React.ReactNode;
  renderSummary?: (rows: T[], total: number) => React.ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  initialSort?: string;
  /** Renders without the page header — for tabbed screens that own their own title. */
  embedded?: boolean;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    for (const [k, v] of Object.entries(fixedFilters || {})) params.set(`filter.${k}`, v);
    for (const [k, v] of Object.entries(filterValues)) if (v) params.set(`filter.${k}`, v);
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    if (initialSort) params.set("sort", initialSort);
    return params.toString();
  }, [search, filterValues, fixedFilters, page, pageSize, initialSort]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<T[]>(`/api/erp/${resource}?${query}`);
    setLoading(false);
    if (!res.ok) {
      console.error(`[${resource}] error cargando el listado:`, res.error);
      toast.error(res.error?.message || "No se pudieron cargar los datos");
      setRows([]);
      return;
    }
    setRows(res.data || []);
    setTotal(res.total ?? (res.data || []).length);
  }, [resource, query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [q]);

  const remove = async () => {
    if (!deleting) return;
    const res = await api.delete(`/api/erp/${resource}/${deleting._id}`);
    if (!res.ok) {
      console.error(`[${resource}] error eliminando:`, res.error);
      toast.error(res.error?.message || "No se pudo eliminar el registro");
      return;
    }
    toast.success("Registro eliminado");
    setDeleting(null);
    load();
  };

  /**
   * EXPORTAR LO QUE SE ESTÁ VIENDO.
   *
   * Va aquí —en el componente compartido— y no en cada pantalla: así las 35
   * pantallas genéricas del ERP lo tienen a la vez, y ninguna se queda fuera
   * porque nadie se acordó de añadírselo.
   *
   * Manda los MISMOS parámetros que el listado (búsqueda, filtros, fijos y
   * orden), y la ruta los resuelve con el mismo armador de filtros: el archivo
   * no puede traer filas distintas de las que se ven. Y exporta TODAS las que
   * cumplen el filtro, no la página actual, que es lo que espera cualquiera que
   * pulsa «exportar» con trescientos registros en pantalla.
   */
  const [exporting, setExporting] = useState(false);

  const exportar = async () => {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("q", search);
      for (const [name, value] of Object.entries({ ...(fixedFilters || {}), ...filterValues })) {
        if (value) qs.set(`filter.${name}`, String(value));
      }
      if (initialSort) qs.set("sort", initialSort);

      const res = await fetch(`/api/export/${resource}?${qs.toString()}`, { credentials: "same-origin" });
      if (!res.ok) {
        // El cuerpo de error es JSON aunque el éxito sea CSV.
        const detail = await res.json().catch(() => null);
        toast.error(detail?.error?.message || "No se pudo exportar");
        return;
      }
      const filas = Number(res.headers.get("X-Row-Count") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${filas} registro${filas === 1 ? "" : "s"} exportado${filas === 1 ? "" : "s"}`);
    } finally {
      setExporting(false);
    }
  };

  const actionColumn: Column<T> = {
    key: "__actions",
    header: "",
    align: "right",
    render: (row) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Editar"
          onClick={() => { setEditing(row as Record<string, any>); setFormOpen(true); }}>
          <Icon name="Pencil" className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive"
          aria-label="Eliminar" onClick={() => setDeleting(row)}>
          <Icon name="Trash2" className="size-3.5" />
        </Button>
      </div>
    ),
  };

  const allColumns = canWrite ? [...columns, actionColumn] : columns;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  const actions = (
    <>
      {extraActions}
      {canWrite && (
        <Button className="gap-1.5" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Icon name="Plus" className="size-4" /> {createLabel}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      )}
      {embedded && description && <p className="text-sm text-muted-foreground">{description}</p>}

      {renderSummary?.(rows, total)}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
        </div>
        {filters?.map((f) => (
          <Select
            key={f.name}
            value={filterValues[f.name] || "__all"}
            onValueChange={(v) => { setFilterValues((prev) => ({ ...prev, [f.name]: v === "__all" ? "" : v })); setPage(0); }}
          >
            <SelectTrigger className="w-[190px]"><SelectValue placeholder={f.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{f.label}: todos</SelectItem>
              {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        <Button variant="outline" size="icon" onClick={load} aria-label="Actualizar">
          <Icon name="RefreshCw" className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={exportar}
          disabled={exporting || total === 0}
          aria-label="Exportar a CSV"
          title="Exportar lo que estás viendo a CSV"
        >
          <Icon name="ArrowDownToLine" className="size-4" />
        </Button>
        {embedded && actions}
      </div>

      <DataTable
        rows={rows}
        columns={allColumns}
        loading={loading}
        onRowClick={onRowClick}
        emptyTitle={emptyTitle || "Todavía no hay registros"}
        emptyDescription={emptyDescription}
        emptyIcon={emptyIcon}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {total} registro{total === 1 ? "" : "s"} · página {page + 1} de {pages}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        }
      />

      <ResourceForm
        open={formOpen}
        onOpenChange={setFormOpen}
        resource={resource}
        fields={fields}
        record={editing}
        extraPayload={fixedFilters}
        title={editing ? `Editar ${title.toLowerCase()}` : createLabel}
        onSaved={load}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer y quedará registrada en la auditoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
