"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/components/tf/icon";
import { EmptyState } from "@/components/tf/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PortalCtx {
  role: string;
  /** Partner whose data is being shown. Null while staff have not picked one. */
  partnerId: string | null;
  isStaff: boolean;
  /** `""` for portal users (server infers it) or `?partner_id=…` for staff. */
  query: (extra?: Record<string, string | undefined>) => string;
}

const Ctx = createContext<PortalCtx>({ role: "partner", partnerId: null, isStaff: false, query: () => "" });

export const usePortal = () => useContext(Ctx);

const STORAGE_KEY = "tf_portal_preview_partner";

/**
 * Portal users are locked to their own partner. Internal staff get a picker so
 * they can audit exactly what a reseller sees, without leaving the ERP session.
 */
export function PortalProvider({
  role, partnerId, children,
}: {
  role: string;
  partnerId: string | null;
  children: React.ReactNode;
}) {
  const isStaff = role !== "partner";
  const [preview, setPreview] = useState<string | null>(partnerId);
  const [partners, setPartners] = useState<{ _id: string; name?: string; commercial_name?: string }[]>([]);
  const [loading, setLoading] = useState(isStaff && !partnerId);

  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    (async () => {
      const res = await api.get<any[]>("/api/erp/partner?limit=200&filter.status=active");
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        console.error("[portal] no se pudieron cargar los partners:", res.error);
        return;
      }
      const rows = res.data || [];
      setPartners(rows);
      setPreview((current) => {
        if (current) return current;
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        if (stored && rows.some((r) => r._id === stored)) return stored;
        return rows[0]?._id || null;
      });
    })();
    return () => { cancelled = true; };
  }, [isStaff]);

  const select = (id: string) => {
    setPreview(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const query = useCallback((extra?: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (isStaff && preview) params.set("partner_id", preview);
    for (const [k, v] of Object.entries(extra || {})) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [isStaff, preview]);

  return (
    <Ctx.Provider value={{ role, partnerId: preview, isStaff, query }}>
      {isStaff && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
          <Icon name="Eye" className="size-4 shrink-0 text-primary" />
          <p className="text-[13px] text-muted-foreground">
            Vista previa del portal. Estás viendo lo que ve el partner seleccionado.
          </p>
          <div className="ml-auto min-w-[220px]">
            <Select value={preview || ""} onValueChange={select} disabled={loading || partners.length === 0}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder={loading ? "Cargando partners…" : "Selecciona un partner"} />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p._id} value={p._id}>{p.commercial_name || p.name || p._id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {isStaff && !loading && !preview ? (
        <EmptyState
          icon="Handshake"
          title="Todavía no hay partners activos"
          description="Crea un tour center o una agencia en «Tour centers y agencias» para poder previsualizar su portal."
        />
      ) : (
        children
      )}
    </Ctx.Provider>
  );
}
