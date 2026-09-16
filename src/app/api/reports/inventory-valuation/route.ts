import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { refId } from "@/lib/types";

/**
 * GET /api/reports/inventory-valuation — las existencias valoradas al costo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO Y NO UN ASIENTO
 *
 * La hoja de ruta pedía llevar el inventario «a contabilidad». Lo que NO se
 * hace aquí, a propósito, es escribir asientos de compra y de costo de ventas.
 *
 * El mayor de este sistema está declarado —y probado— como BASE CAJA:
 * `ledger-events.ts` lo dice en su cabecera y explica por qué, que cada asiento
 * refleje un movimiento real de dinero es lo que impide que la contabilidad se
 * separe de la realidad. Devengar la compra al recibirla y el costo al vender
 * es contabilidad de acumulación, y cambiar de base es una decisión del
 * contador de la empresa —tiene consecuencias fiscales— no un efecto colateral
 * de haber tocado el módulo de inventario.
 *
 * Lo que el contador necesita del inventario para cerrar un periodo es ESTO: el
 * valor de lo que hay en los estantes, al costo promedio con el que entró. Es
 * la cifra que va al balance, y con este informe sale del sistema en vez de
 * salir de un conteo a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL COSTO PROMEDIO ES EL QUE LLEVA EL MOTOR
 *
 * `avg_cost` lo recalcula `postMovement` en cada entrada con costo: recibir 10
 * a 200 y luego 10 a 250 deja el promedio en 225, y ese es el número con el que
 * se valoran las 20 unidades. Volver a calcularlo aquí sería una segunda
 * definición de «cuánto vale esto», y las dos acabarían discrepando.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface LevelRow {
  quantity?: number | null;
  reserved?: number | null;
  avg_cost?: number | null;
  warehouse?: unknown;
  inventory_item?: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "reports:valuation", ctx.userId), limit: 30, windowMs: 60_000 });
    // Lo que vale el almacén es dato de gestión, no de operación diaria.
    requireAtLeast(ctx, "manager");

    const warehouseFilter = req.nextUrl.searchParams.get("warehouse");
    const levels = await tenantQuery<LevelRow>(ctx.companyId, "stock_level", {
      _filter: warehouseFilter ? { warehouse: warehouseFilter } : {},
      warehouse: true,
      inventory_item: true,
      _limit: 2000,
    });

    const porAlmacen = new Map<string, { name: string; items: number; units: number; value: number }>();
    const items: {
      item: string; sku: string | null; warehouse: string;
      quantity: number; reserved: number; available: number;
      avgCost: number; value: number;
    }[] = [];

    let totalValue = 0;
    let totalUnits = 0;

    for (const level of levels) {
      const quantity = num(level.quantity);
      const avgCost = num(level.avg_cost);
      const value = round2(quantity * avgCost);
      const almacen = level.warehouse as { _id?: string; name?: string } | null;
      const articulo = level.inventory_item as { name?: string; sku?: string } | null;
      const wid = refId(level.warehouse) || "sin-almacen";
      const wname = almacen?.name || "Sin almacén";

      // Un saldo en cero no es una existencia: incluirlo llenaría el informe de
      // filas que no valen nada y escondería las que sí.
      if (quantity === 0) continue;

      const acc = porAlmacen.get(wid) || { name: wname, items: 0, units: 0, value: 0 };
      acc.items += 1;
      acc.units = round2(acc.units + quantity);
      acc.value = round2(acc.value + value);
      porAlmacen.set(wid, acc);

      totalValue = round2(totalValue + value);
      totalUnits = round2(totalUnits + quantity);

      items.push({
        item: articulo?.name || "Sin nombre",
        sku: articulo?.sku ?? null,
        warehouse: wname,
        quantity,
        reserved: num(level.reserved),
        available: round2(quantity - num(level.reserved)),
        avgCost,
        value,
      });
    }

    items.sort((a, b) => b.value - a.value);

    return ok({
      // La moneda es la base de la empresa: el costo promedio se guarda ya
      // convertido por `postMovement`, no por moneda de compra.
      currency: ctx.company?.base_currency || "usd",
      asOf: new Date().toISOString(),
      totals: { value: totalValue, units: totalUnits, items: items.length },
      byWarehouse: [...porAlmacen.entries()].map(([id, w]) => ({ id, ...w })),
      items: items.slice(0, 500),
    });
  } catch (err) {
    return fail(err);
  }
}
