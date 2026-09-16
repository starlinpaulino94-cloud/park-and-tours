"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SimpleResource } from "@/components/tf/simple-resource";
import { KpiCard } from "@/components/tf/kpi-card";
import { formatMoney, formatNumber } from "@/lib/format";

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

interface Valuation {
  currency: string;
  totals: { value: number; units: number; items: number };
  byWarehouse: { id: string; name: string; items: number; units: number; value: number }[];
}

export default function Page() {
  const [valoracion, setValoracion] = useState<Valuation | null>(null);

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
