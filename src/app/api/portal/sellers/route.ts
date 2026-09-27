import { NextRequest } from "next/server";
import {
  requireTenant, tenantQuery, requireAtLeast, TenantError, esDeSocio, esAdminDeSocio,
} from "@/lib/tenant";
import { ok, fail, resolvePeriod } from "@/lib/api-response";
import { projectRows } from "@/lib/field-projection";
import { refId } from "@/lib/types";
import type { Commission, Order, Seller } from "@/lib/types";
import { leerTodoElRecurso } from "@/lib/barrido";

/**
 * EL EQUIPO DE VENTAS DEL TOUR CENTER, CON LO QUE HA VENDIDO CADA UNO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO VALE EL CRUD GENÉRICO
 *
 * `/api/erp/seller` devuelve la FICHA, y lo que esta pantalla necesita es la
 * ficha MÁS lo que esa persona vendió en el período y lo que se le ha
 * generado. Pedirlo desde el navegador serían tres llamadas y un cruce en el
 * cliente — y el cruce es justo lo que no puede vivir ahí: la decisión de qué
 * comisión es de quién acabaría escrita en una pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ÁMBITO NO SE REPITE AQUÍ
 *
 * Esta ruta no arma ningún filtro de socio por su cuenta: `tenantQuery` sobre
 * `seller` ya viene acotado por el ámbito —la tabla es PROPIA del socio desde
 * la Fase 5.1— y el recorte de columnas es el mismo que aplica el listado
 * genérico. Una ruta a medida que rehace el aislamiento es una ruta que un día
 * lo rehará mal; las dos que lo hicieron ya están en el registro.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;

    /**
     * ESTA PANTALLA ES DE QUIEN DIRIGE, NO DE QUIEN VENDE.
     *
     * Enseña lo que vendió cada compañero y lo que ha generado. Es exactamente
     * lo que el ámbito del vendedor existe para que un agente no vea, y aquí
     * ese ámbito NO se aplica solo: la consulta pide las órdenes de una LISTA
     * de vendedores, no pasa por el armador de filtros. Así que la puerta se
     * cierra a la entrada.
     *
     * Dentro del tour center manda quien administra su cuenta; desde la
     * operadora, gerencia para arriba.
     */
    let partnerId: string | null;
    if (esDeSocio(ctx)) {
      if (!esAdminDeSocio(ctx)) {
        throw new TenantError(
          "Solo quien administra la cuenta de tu empresa puede ver el desempeño del equipo",
          403
        );
      }
      partnerId = ctx.partnerId;
    } else {
      requireAtLeast(ctx, "manager");
      partnerId = sp.get("partner_id") || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const { from, to, label } = resolvePeriod(sp.get("period") || "month", sp.get("from"), sp.get("to"));

    const fichas = await tenantQuery<Seller>(ctx.companyId, "seller", {
      _filter: { partner: partnerId },
      _sort: { first_name: "asc" }, _limit: 200,
    });
    const ids = fichas.map((s) => s._id).filter(Boolean) as string[];

    /**
     * Sin equipo no se consulta nada más.
     *
     * Un `in: []` no es «ninguno» para todos los traductores de consulta: en
     * algunos es una condición que no se aplica, y entonces esta pantalla
     * enseñaría las ventas de la operadora entera. No se le da la ocasión.
     */
    const [ordenes, comisiones] = ids.length
      ? await Promise.all([
          // Enteras las dos: de aquí salen los TOTALES por vendedor —cuánto
          // vendió y cuánto devengó— y de eso cuelga lo que se le paga. Un
          // total corto no es una tabla incompleta: es una liquidación corta.
          leerTodoElRecurso<Order>("order", (limite, salto) =>
            tenantQuery(ctx.companyId, "order", {
              _filter: { seller: { in: ids }, createdAt: { gte: from, lte: to } },
              _sort: { createdAt: "desc", _id: "desc" },
              _limit: limite, _offset: salto,
            })),
          leerTodoElRecurso<Commission>("commission", (limite, salto) =>
            tenantQuery(ctx.companyId, "commission", {
              _filter: {
                seller: { in: ids }, beneficiary_type: "seller",
                status: { ne: "cancelled" },
                generated_at: { gte: from, lte: to },
              },
              _sort: { generated_at: "asc", _id: "asc" },
              _limit: limite, _offset: salto,
            })),
        ])
      : [[], []];

    const ventasPor = new Map<string, { ventas: number; importe: number }>();
    for (const o of ordenes) {
      const id = refId(o.seller);
      if (!id) continue;
      const acc = ventasPor.get(id) || { ventas: 0, importe: 0 };
      acc.ventas += 1;
      acc.importe += Number(o.total ?? 0);
      ventasPor.set(id, acc);
    }

    const comisionPor = new Map<string, number>();
    for (const c of comisiones) {
      const id = refId(c.seller);
      if (!id) continue;
      comisionPor.set(id, (comisionPor.get(id) ?? 0) + Number(c.amount ?? 0));
    }

    /**
     * El recorte de columnas, el mismo que el listado genérico.
     *
     * Se aplica aquí en vez de escribirse otra vez: dos copias de un recorte
     * acaban discrepando, y la que discrepe será la que enseñe de más. A quien
     * llega hasta aquí no le quita nada —ya se comprobó arriba que dirige—,
     * pero mantiene esta ruta dentro de la misma regla que las demás el día que
     * esa comprobación cambie.
     */
    const equipo = projectRows("seller", ctx, fichas as unknown as Record<string, unknown>[]);

    return ok({
      period: { from, to, label },
      sellers: equipo.map((s) => {
        const id = String(s._id);
        const venta = ventasPor.get(id) || { ventas: 0, importe: 0 };
        return {
          ...s,
          sales_count: venta.ventas,
          sales_amount: Math.round(venta.importe * 100) / 100,
          commission_amount: Math.round((comisionPor.get(id) ?? 0) * 100) / 100,
        };
      }),
    });
  } catch (err) {
    return fail(err);
  }
}
