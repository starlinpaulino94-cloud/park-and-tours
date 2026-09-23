"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/tf/page-header";
import { DataTable } from "@/components/tf/data-table";
import { StatusBadge } from "@/components/tf/status-badge";
import { ORDER_STATUS } from "@/lib/labels";
import { formatMoney, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SinFicha } from "../_components/sin-ficha";

interface Venta {
  _id: string; order_number?: string; total?: number; balance?: number; currency?: string;
  status?: string; order_date?: string; channel?: string;
  customer?: { first_name?: string; last_name?: string } | string;
}

/**
 * MIS VENTAS.
 *
 * Lee de `/api/orders`, que desde el ámbito del vendedor devuelve SOLO las
 * suyas: no hace falta —ni se debe— mandar un filtro por vendedor desde el
 * navegador. Un filtro que decide qué ve cada quien y viaja en la dirección es
 * un filtro que se puede quitar.
 */
export default function MisVentasPage() {
  const [sellerId, setSellerId] = useState<string | null | undefined>(undefined);
  const [filas, setFilas] = useState<Venta[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const porPagina = 25;

  useEffect(() => {
    let vivo = true;
    (async () => {
      const yo = await api.get<{ user?: { sellerId?: string | null } }>("/api/me");
      if (!vivo) return;
      const id = yo.ok ? yo.data?.user?.sellerId ?? null : null;
      setSellerId(id);
      if (!id) { setCargando(false); return; }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!sellerId) return;
    let vivo = true;
    setCargando(true);
    (async () => {
      const res = await api.get<Venta[]>(`/api/orders?limit=${porPagina}&offset=${(pagina - 1) * porPagina}`);
      if (!vivo) return;
      if (res.ok) {
        setFilas(res.data || []);
        setTotal(res.total ?? (res.data || []).length);
      }
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [sellerId, pagina]);

  if (sellerId === undefined) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mis ventas" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!sellerId) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mi espacio" title="Mis ventas" />
        <SinFicha />
      </div>
    );
  }

  const paginas = Math.max(Math.ceil(total / porPagina), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mi espacio"
        title="Mis ventas"
        description="Todo lo que está a tu nombre, con su estado de cobro."
      />
      <DataTable
        rows={filas}
        loading={cargando}
        emptyIcon="Receipt"
        emptyTitle="Todavía no hay ventas a tu nombre"
        emptyDescription="Cuando cierres una venta desde el punto de venta aparecerá aquí."
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {total} venta{total === 1 ? "" : "s"} · página {pagina} de {paginas}
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        }
        columns={[
          {
            key: "order", header: "Venta",
            render: (o: Venta) => (
              <div>
                <p className="font-semibold">{o.order_number || "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {typeof o.customer === "object" && o.customer
                    ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ") || "Cliente directo"
                    : "Cliente directo"}
                </p>
              </div>
            ),
          },
          { key: "date", header: "Fecha", hideOn: "sm",
            render: (o: Venta) => (o.order_date ? formatDate(o.order_date) : "—") },
          { key: "total", header: "Total", align: "right",
            render: (o: Venta) => formatMoney(o.total ?? 0, o.currency || "usd") },
          {
            // «—» y no «0»: un saldo en cero significa «ya está cobrada», y eso
            // es una afirmación, no la ausencia del dato.
            key: "balance", header: "Pendiente", align: "right", hideOn: "md",
            render: (o: Venta) => (o.balance == null
              ? "—"
              : <span className={o.balance > 0.009 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
                  {formatMoney(o.balance, o.currency || "usd")}
                </span>),
          },
          { key: "status", header: "Estado", render: (o: Venta) => <StatusBadge value={o.status} dict={ORDER_STATUS} /> },
        ]}
      />
    </div>
  );
}
