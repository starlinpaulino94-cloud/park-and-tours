"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SimpleResource } from "@/components/tf/simple-resource";
import { KpiCard } from "@/components/tf/kpi-card";
import Link from "next/link";
import { formatMoney, formatNumber } from "@/lib/format";
import { Icon } from "@/components/tf/icon";
import { Button } from "@/components/ui/button";
import { reorderThreshold } from "@/lib/inventory-rules";

/**
 * EXISTENCIAS, CON SU VALOR.
 *
 * Dos cosas cambian aquí desde 0052:
 *
 *  · **«Reservado» dice algo.** La columna existía desde 0013 y siempre decía
 *    cero porque nada la escribía. Ahora vender un extra que sale del almacén
 *    aparta sus unidades: lo que hay y lo que se puede vender dejan de ser el
 *    mismo número.
 *
 *  · **Se ve lo que vale el almacén.** Es la cifra que el contador necesita
 *    para cerrar el periodo, valorada al costo promedio con el que la mercancía
 *    entró de verdad. Antes había que contarla a mano.
 */

/**
 * Lo que está en el punto de pedido o por debajo.
 *
 * `/api/inventory/low-stock` estaba implementada y no la llamaba nadie, así que
 * la lista de reposición no existía en el producto: el aviso de existencias
 * bajas llegaba por notificación —una vez al mes por artículo y almacén— y no
 * había ninguna pantalla donde ver TODO lo que hay que reponer de una vez. Para
 * hacer una orden de compra tocaba recorrer el listado a ojo comparando la
 * columna «Disponible» con un punto de pedido que no se enseña.
 *
 * Usa el MISMO criterio que la campana (`isLowStock`), a propósito: con dos
 * definiciones de «bajo», la pantalla señala lo que la campana calla.
 */
interface Bajo {
  _id: string;
  quantity?: number;
  available?: number;
  inventory_item?: { _id?: string; name?: string; sku?: string; unit?: string; reorder_point?: number; min_stock?: number; reorder_qty?: number } | null;
  warehouse?: { name?: string } | null;
}

interface Valuation {
  currency: string;
  totals: { value: number; units: number; items: number };
  byWarehouse: { id: string; name: string; items: number; units: number; value: number }[];
}

export default function Page() {
  const [valoracion, setValoracion] = useState<Valuation | null>(null);
  const [bajos, setBajos] = useState<Bajo[] | null>(null);

  useEffect(() => {
    api.get<Bajo[]>("/api/inventory/low-stock").then((r) => {
      if (r.ok === false) {
        console.error("[existencias] no se pudo leer la reposición:", r.error);
        setBajos([]);
        return;
      }
      setBajos(r.data ?? []);
    });
  }, []);

  useEffect(() => {
    api.get<Valuation>("/api/reports/inventory-valuation").then((r) => {
      if (r.ok === false) {
        // Sin valoración la pantalla sigue sirviendo: el listado es lo
        // principal y los medidores son el añadido.
        console.error("[existencias] no se pudo valorar el inventario:", r.error);
        return;
      }
      setValoracion(r.data ?? null);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Valor del inventario"
          value={formatMoney(valoracion?.totals.value ?? 0, valoracion?.currency || "usd")}
          icon="Layers3"
          hint="Al costo promedio ponderado con el que entró la mercancía."
        />
        <KpiCard label="Unidades en existencia" value={formatNumber(valoracion?.totals.units ?? 0)} icon="Package" />
        <KpiCard label="Artículos con saldo" value={formatNumber(valoracion?.totals.items ?? 0)} icon="Boxes"
          hint="Los que están en cero no cuentan: no son existencia." />
      </div>

      {valoracion && valoracion.byWarehouse.length > 1 && (
        <div className="rounded-lg border p-4 text-sm">
          <p className="mb-2 font-semibold">Por almacén</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {valoracion.byWarehouse.map((w) => (
              <div key={w.id} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{w.name}</span>
                <span className="font-semibold tabular-nums">{formatMoney(w.value, valoracion.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────────────────── qué hay que reponer ─────────────────────── */}
      {bajos && bajos.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Icon name="TriangleAlert" className="size-4 text-amber-600 dark:text-amber-400" />
              {formatNumber(bajos.length)} {bajos.length === 1 ? "artículo" : "artículos"} en el punto de pedido o por debajo
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/comercio/compras">Crear orden de compra</Link>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="py-1 text-left font-semibold">Artículo</th>
                  <th className="py-1 text-left font-semibold">Almacén</th>
                  <th className="py-1 text-right font-semibold">Disponible</th>
                  <th className="py-1 text-right font-semibold">Punto de pedido</th>
                  <th className="py-1 text-right font-semibold">Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {bajos.map((b) => {
                  const umbral = reorderThreshold(b.inventory_item);
                  const disponible = Number(b.available ?? 0);
                  return (
                    <tr key={b._id} className="border-b last:border-0">
                      <td className="py-1">
                        {b.inventory_item?.name || "—"}
                        {b.inventory_item?.sku && (
                          <span className="text-xs text-muted-foreground"> · {b.inventory_item.sku}</span>
                        )}
                      </td>
                      <td className="py-1 text-muted-foreground">{b.warehouse?.name || "—"}</td>
                      <td className={`py-1 text-right tabular-nums font-semibold ${disponible <= 0 ? "text-destructive" : ""}`}>
                        {formatNumber(disponible, 2)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {umbral === null ? "—" : formatNumber(umbral, 2)}
                      </td>
                      {/* Lo que la empresa dijo que compra cada vez. Sin ese dato no
                          se inventa una cantidad: se dice que falta. */}
                      <td className="py-1 text-right tabular-nums">
                        {Number(b.inventory_item?.reorder_qty ?? 0) > 0
                          ? formatNumber(Number(b.inventory_item!.reorder_qty), 2)
                          : <span className="text-xs text-muted-foreground">sin cantidad de pedido</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SimpleResource
        resource="stock_level"
        eyebrow="Comercio"
        title="Existencias"
        description="Saldo por artículo y almacén, con su costo promedio ponderado. «Reservado» es lo ya vendido que todavía no ha salido: lo disponible es la diferencia."
        emptyIcon="Layers3"
        columns={[
          { key: "inventory_item", header: "Artículo", kind: "ref" },
          { key: "warehouse", header: "Almacén", kind: "ref" },
          { key: "quantity", header: "Existencia", kind: "number", align: "right" },
          { key: "reserved", header: "Reservado", kind: "number", align: "right", hideOn: "md" },
          { key: "available", header: "Disponible", kind: "number", align: "right" },
          { key: "avg_cost", header: "Costo promedio", kind: "money", align: "right" },
          {
            key: "value", header: "Valor", align: "right",
            // Cantidad × costo promedio. El valor no está en la fila: es lo que
            // el motor calcula al mover, y aquí solo se multiplica.
            render: (l: any) => (
              <span className="font-semibold tabular-nums">
                {formatMoney(Number(l.quantity ?? 0) * Number(l.avg_cost ?? 0), valoracion?.currency || "usd")}
              </span>
            ),
          },
          { key: "last_movement_at", header: "Último movimiento", kind: "datetime", hideOn: "lg" },
        ]}
      />
    </div>
  );
}
