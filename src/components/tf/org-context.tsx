"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

/**
 * Contexto organizacional del panel: empresa actual y sucursal activa.
 *
 * La empresa la resuelve el servidor en cada petición (`requireTenant`), así que
 * aquí solo se muestra. La sucursal activa es una preferencia del usuario que se
 * conserva al cambiar de workspace y entre recargas; los módulos que la
 * necesiten pueden leerla con `useOrg()`.
 */

export interface BranchOption {
  _id: string;
  name?: string;
  code?: string;
  branch_type?: string;
  city?: string;
}

interface OrgValue {
  companyName: string;
  companyType?: string;
  branches: BranchOption[];
  branchId: string | null;
  branch: BranchOption | null;
  setBranchId: (id: string | null) => void;
  loading: boolean;
}

const OrgContext = createContext<OrgValue | null>(null);

const STORAGE_KEY = "tf:active-branch";

export function OrgProvider({
  companyName, companyType, children,
}: {
  companyName: string;
  companyType?: string;
  children: React.ReactNode;
}) {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<BranchOption[]>("/api/erp/branch?limit=100&filter.status=active");
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        // No es crítico: sin sucursales el selector simplemente no se dibuja.
        console.error("[org] no se pudieron cargar las sucursales:", res.error);
        return;
      }
      const rows = res.data || [];
      setBranches(rows);

      const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (stored && rows.some((b) => b._id === stored)) setBranchIdState(stored);
    })();
    return () => { cancelled = true; };
  }, []);

  const setBranchId = useCallback((id: string | null) => {
    setBranchIdState(id);
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
    console.log("[org] sucursal activa:", id || "todas");
  }, []);

  const value = useMemo<OrgValue>(() => ({
    companyName,
    companyType,
    branches,
    branchId,
    branch: branches.find((b) => b._id === branchId) || null,
    setBranchId,
    loading,
  }), [companyName, companyType, branches, branchId, setBranchId, loading]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg debe usarse dentro de <OrgProvider>");
  return ctx;
}
