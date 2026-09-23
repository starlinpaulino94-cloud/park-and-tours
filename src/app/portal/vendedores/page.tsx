"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { usePortal } from "../portal-context";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { KpiCard } from "@/components/tf/kpi-card";
import { EmptyState } from "@/components/tf/empty-state";
import { StatusBadge } from "@/components/tf/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GENERIC_STATUS } from "@/lib/labels";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

interface VendedorDelSocio {
  _id: string;
  first_name?: string;
  last_name?: string;
  code?: string;
  status?: string;
  commission_pct?: number;
  sales_count: number;
  sales_amount: number;
  commission_amount: number;
}

interface Respuesta {
  period: { from: string; to: string; label: string };
  sellers: VendedorDelSocio[];
}

const PERIODOS = [
  { value: "month", label: "Este mes" },
  { value: "last_month", label: "Mes pasado" },
  { value: "quarter", label: "Este trimestre" },
  { value: "year", label: "Este año" },
];

/**
 * EL EQUIPO DE VENTAS DEL TOUR CENTER.
 *
 * Lo que un tour center no tenía manera de saber sin pedírselo a su operadora:
 * cuánto vendió cada uno de los suyos y cuánto lleva generado. Es la mitad de
 * por qué un sub-login por vendedor sirve para algo — la otra mitad es que cada
 * uno vea solo lo suyo, y de eso se encarga el ámbito.
 *
 * Los totales van arriba porque son la pregunta que se hace primero; el detalle
 * por persona, debajo, en el orden en que se lee una nómina.
 */
export default function PortalSellersPage() {
  const { isStaff, partnerId } = usePortal();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [periodo, setPeriodo] = useState("month");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ period: periodo });
    if (isStaff && partnerId) params.set("partner_id", partnerId);
    const res = await api.get<Respuesta>(`/api/portal/sellers?${params}`);
    setCargando(false);
    if (!res.ok) {
      console.error("[portal/vendedores] no se pudo cargar el equipo:", res.error);
      toast.error(res.error?.message || "No se pudo cargar el equipo de ventas");
      setDatos(null);
      return;
    }
    setDatos(res.data ?? null);
  }, [periodo, isStaff, partnerId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const equipo = datos?.sellers ?? [];
  const totalVentas = equipo.reduce((a, s) => a + s.sales_count, 0);
  const totalImporte = equipo.reduce((a, s) => a + s.sales_amount, 0);
  const totalComision = equipo.reduce((a, s) => a + s.commission_amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi equipo de ventas"
        description="Cuánto vendió cada uno de los tuyos y cuánto lleva generado."
        actions={
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Ventas" value={formatNumber(totalVentas)} icon="ShoppingCart" />
        <KpiCard label="Importe vendido" value={formatMoney(totalImporte)} icon="Banknote" />
        <KpiCard label="Comisión generada" value={formatMoney(totalComision)} icon="Percent" />
      </div>

      {!cargando && equipo.length === 0 ? (
        <EmptyState
          icon="Users"
          title="Todavía no tienes vendedores"
          description="Cuando tu operador dé de alta a los vendedores de tu empresa, aparecerán aquí con sus ventas."
        />
      ) : (
        <DataTable
          loading={cargando}
          rows={equipo}
          columns={[
            { key: "nombre", header: "Vendedor", render: (s: VendedorDelSocio) => (
              <div>
                <div className="font-medium">
                  {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.code || "Vendedor"}
                </div>
                {s.code && <div className="text-xs text-muted-foreground">{s.code}</div>}
              </div>
            ) },
            { key: "status", header: "Estado", render: (s: VendedorDelSocio) => (
              <StatusBadge value={s.status} dict={GENERIC_STATUS} />
            ) },
            { key: "sales_count", header: "Ventas", align: "right",
              render: (s: VendedorDelSocio) => formatNumber(s.sales_count) },
            { key: "sales_amount", header: "Importe", align: "right",
              render: (s: VendedorDelSocio) => formatMoney(s.sales_amount) },
            /**
             * «—» y no «0 %» cuando la ficha no declara comisión: un cero dice
             * que esa persona no cobra nada, que es una afirmación, y aquí lo
             * que pasa es que nadie la ha fijado.
             */
            { key: "commission_pct", header: "Comisión", align: "right",
              render: (s: VendedorDelSocio) => (
                s.commission_pct == null ? <span className="text-muted-foreground">—</span>
                  : formatPercent(s.commission_pct)
              ) },
            { key: "commission_amount", header: "Generado", align: "right",
              render: (s: VendedorDelSocio) => formatMoney(s.commission_amount) },
          ]}
        />
      )}
    </div>
  );
}
