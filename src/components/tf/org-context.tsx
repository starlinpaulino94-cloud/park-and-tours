"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/client";

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

/** Una empresa a la que esta persona pertenece de verdad. */
export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
  isPrimary: boolean;
  isActive: boolean;
}

interface OrgValue {
  companyName: string;
  companyType?: string;
  branches: BranchOption[];
  branchId: string | null;
  branch: BranchOption | null;
  setBranchId: (id: string | null) => void;
  /** Las empresas de esta persona. Vacío o con una sola: no hay nada que elegir. */
  workspaces: WorkspaceOption[];
  /** Cambiar de empresa. Recarga, porque cambia TODO lo que hay en pantalla. */
  switchWorkspace: (id: string) => Promise<void>;
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
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
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

  /**
   * Las empresas de esta persona.
   *
   * El servidor decide: esta lista es exactamente la que autoriza el cambio, y
   * viene de `/api/workspace`. Aquí no se filtra nada ni se recuerda nada — una
   * lista guardada en el navegador seguiría ofreciendo una empresa de la que ya
   * te sacaron.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<WorkspaceOption[]>("/api/workspace");
      if (cancelled) return;
      if (!res.ok) {
        console.error("[org] no se pudieron cargar las empresas:", res.error);
        return;
      }
      setWorkspaces(res.data || []);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Cambiar de empresa RECARGA la página entera.
   *
   * No es pereza: al cambiar de empresa cambian el rol, los módulos visibles,
   * el menú, la sucursal y cada dato que hay pintado. Actualizar por partes
   * dejaría durante unos instantes la pantalla de una empresa con los datos de
   * la otra, y ese instante es suficiente para que alguien lea una cifra que no
   * es suya y la apunte.
   */
  const switchWorkspace = useCallback(async (id: string) => {
    const res = await api.post<{ reloadSession?: boolean }>("/api/workspace", { company_id: id });
    if (!res.ok) {
      console.error("[org] no se pudo cambiar de empresa:", res.error);
      throw new Error(res.error?.message || "No se pudo cambiar de empresa");
    }
    /**
     * El cambio de empresa solo alcanza a lo que lee por RLS y al panel si el
     * TOKEN lleva la nueva empresa. La ruta ya guardó la empresa activa; aquí se
     * refresca la sesión para que el enganche (0068) reemita el `org_id`, y
     * recién entonces se recarga. Sin este refresco, la cookie diría la empresa
     * nueva y el JWT seguiría en la vieja —que es justo el fallo que esto cierra—.
     */
    if (res.data?.reloadSession) {
      try { await supabaseBrowser().auth.refreshSession(); }
      catch (err) { console.error("[org] no se pudo refrescar la sesión:", err); }
    }
    window.location.assign("/dashboard");
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
    workspaces,
    switchWorkspace,
    loading,
  }), [companyName, companyType, branches, branchId, setBranchId, workspaces, switchWorkspace, loading]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg debe usarse dentro de <OrgProvider>");
  return ctx;
}
