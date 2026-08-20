"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toDateInput } from "@/lib/format";

export type FieldType = "text" | "number" | "textarea" | "select" | "date" | "datetime" | "email" | "phone" | "url" | "reference" | "multiselect";

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  /** For `reference`: the /api/erp resource to load options from. */
  resource?: string;
  optionLabel?: (row: any) => string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  span?: 1 | 2;
  suffix?: string;
  defaultValue?: string | number;
}

/** Loads reference options once per resource and caches them in state. */
function useReferenceOptions(fields: FieldDef[], open: boolean) {
  const [options, setOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const resources = [...new Set(fields.filter((f) => f.type === "reference" && f.resource).map((f) => f.resource!))];
    if (resources.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(
      resources.map(async (resource) => {
        const res = await api.get<any[]>(`/api/erp/${resource}?limit=300`);
        if (!res.ok) {
          console.error(`[form] no se pudieron cargar las opciones de ${resource}:`, res.error);
          return [resource, [] as any[]] as const;
        }
        return [resource, res.data || []] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      const map: Record<string, any[]> = {};
      for (const [resource, rows] of entries) map[resource] = rows;
      const built: Record<string, { value: string; label: string }[]> = {};
      for (const f of fields) {
        if (f.type !== "reference" || !f.resource) continue;
        built[f.name] = (map[f.resource] || []).map((row: any) => ({
          value: row._id,
          label: f.optionLabel
            ? f.optionLabel(row)
            : row.name || row.commercial_name || row.full_name ||
              [row.first_name, row.last_name].filter(Boolean).join(" ") || row.code || row._id,
        }));
      }
      setOptions(built);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, fields]);

  return { options, loading };
}

export function ResourceForm({
  open, onOpenChange, resource, fields, record, title, description, onSaved, extraPayload,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: string;
  fields: FieldDef[];
  record?: Record<string, any> | null;
  /** Merged into every create so scoped screens stay inside their own scope. */
  extraPayload?: Record<string, string>;
  title: string;
  description?: string;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const { options } = useReferenceOptions(fields, open);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, any> = {};
    for (const f of fields) {
      const raw = record?.[f.name];
      if (raw === undefined || raw === null) {
        initial[f.name] = f.defaultValue !== undefined && !record ? String(f.defaultValue) : "";
      } else if (typeof raw === "object" && raw._id) {
        initial[f.name] = raw._id;
      } else if (f.type === "date" || f.type === "datetime") {
        initial[f.name] = toDateInput(raw);
      } else if (Array.isArray(raw)) {
        initial[f.name] = raw.join(",");
      } else {
        initial[f.name] = String(raw);
      }
    }
    setValues(initial);
  }, [open, record, fields]);

  const set = (name: string, value: any) => setValues((v) => ({ ...v, [name]: value }));

  const submit = async () => {
    const missing = fields.filter((f) => f.required && !String(values[f.name] ?? "").trim());
    if (missing.length > 0) {
      toast.error(`Completa: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    const payload: Record<string, any> = {};
    for (const f of fields) {
      const raw = values[f.name];
      if (raw === "" || raw === undefined) {
        if (record) payload[f.name] = null;
        continue;
      }
      payload[f.name] = f.type === "multiselect" ? String(raw).split(",").map((s) => s.trim()).filter(Boolean) : raw;
    }

    setSaving(true);
    const res = record?._id
      ? await api.put(`/api/erp/${resource}/${record._id}`, payload)
      : await api.post(`/api/erp/${resource}`, { ...(extraPayload || {}), ...payload });
    setSaving(false);

    if (!res.ok) {
      console.error("[form] error guardando el registro:", res.error);
      toast.error(res.error?.message || "No se pudo guardar el registro");
      return;
    }
    toast.success(record?._id ? "Registro actualizado" : "Registro creado");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto tf-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {fields.map((f) => {
            const id = `field-${f.name}`;
            const selectOptions = f.type === "reference" ? options[f.name] || [] : f.options || [];
            return (
              <div key={f.name} className={cn("space-y-1.5", f.span === 2 && "sm:col-span-2")}>
                <Label htmlFor={id} className="text-[12px] font-semibold">
                  {f.label} {f.required && <span className="text-destructive">*</span>}
                </Label>

                {f.type === "textarea" ? (
                  <Textarea id={id} value={values[f.name] ?? ""} placeholder={f.placeholder} rows={3}
                    onChange={(e) => set(f.name, e.target.value)} />
                ) : f.type === "select" || f.type === "reference" ? (
                  <Select value={values[f.name] || "__none"} onValueChange={(v) => set(f.name, v === "__none" ? "" : v)}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder={f.placeholder || "Selecciona una opción"} />
                    </SelectTrigger>
                    <SelectContent>
                      {!f.required && <SelectItem value="__none">— Sin asignar —</SelectItem>}
                      {selectOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="relative">
                    <Input
                      id={id}
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                      // Empty string keeps number inputs clearable (no forced 0).
                      value={values[f.name] ?? ""}
                      placeholder={f.placeholder}
                      step={f.type === "number" ? "any" : undefined}
                      // AUD-U06: mirror the server's non-negative rule in the UI.
                      // Coordinates and offsets are the only numbers allowed below 0.
                      min={
                        f.type === "number" && !/lat|long|lng|offset|balance/i.test(f.name)
                          ? 0
                          : undefined
                      }
                      onChange={(e) => set(f.name, e.target.value)}
                      className={cn(f.suffix && "pr-10")}
                    />
                    {f.suffix && (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        {f.suffix}
                      </span>
                    )}
                  </div>
                )}
                {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
