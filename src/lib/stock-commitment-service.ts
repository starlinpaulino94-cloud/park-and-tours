import "server-only";
import { tenantQuery, tenantUpdate, tenantCreate } from "@/lib/tenant";
import { postMovement } from "@/lib/inventory";
import { refId } from "@/lib/types";
import {
  commitmentFor, committedOf, transition, groupCommitments, canCommit,
  type StockableOffer, type StockAction, type CommittedLine,
} from "@/lib/stock-commitment";

/**
 * El compromiso de existencias contra la base.
 *
 * Dos decisiones que no son obvias:
 *
 *  · **Reservar NO escribe un movimiento.** Un almuerzo vendido para el jueves
 *    sigue en el almacén: apartarlo es subir `reserved`, no sacar mercancía.
 *    Escribir un movimiento al vender llenaría el libro de entradas y salidas
 *    que nunca ocurrieron, y el conteo físico del viernes no cuadraría con él.
 *
 *  · **Nada de esto puede tumbar una venta.** Si el almacén está mal
 *    configurado o falla, la reserva del cliente se hace igual y aquí se deja
 *    constancia en el log. Un ERP que no deja vender porque su módulo de
 *    inventario tiene un artículo sin almacén es un ERP que se desinstala.
 *    Vender POR ENCIMA de lo disponible sí se avisa —y no se aparta—, pero
 *    tampoco se bloquea: quien decide si hay comida es el operador, no la
 *    tabla.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

interface LevelRow {
  _id: string;
  quantity?: number | null;
  reserved?: number | null;
}

/** El saldo de un (almacén, artículo), o `null` si nunca hubo movimiento. */
async function levelOf(companyId: string, warehouseId: string, itemId: string): Promise<LevelRow | null> {
  const rows = await tenantQuery<LevelRow>(companyId, "stock_level", {
    _filter: { warehouse: warehouseId, inventory_item: itemId },
    _limit: 1,
  });
  return rows[0] ?? null;
}

/** Suma `delta` a lo reservado de un saldo, sin bajar de cero. */
async function bumpReserved(companyId: string, level: LevelRow, delta: number): Promise<void> {
  const reserved = Math.max(0, num(level.reserved) + delta);
  await tenantUpdate(companyId, "stock_level", level._id, {
    reserved,
    available: num(level.quantity) - reserved,
  });
}

export interface SoldExtra {
  /** El id de la fila `booking_extra` recién creada. */
  bookingExtraId: string;
  /** La oferta del catálogo, con su configuración de almacén. */
  offer: StockableOffer;
  /** Unidades vendidas de ese extra. */
  soldUnits: number;
}

/**
 * Aparta lo que acaba de venderse.
 *
 * Devuelve los avisos, que quien llama decide si enseña: «vendiste 4 almuerzos
 * y solo quedan 2» es información que el vendedor quiere ANTES de que el
 * cliente llegue al muelle, no una razón para no cobrarle.
 */
export async function reserveForSale(companyId: string, sold: SoldExtra[]): Promise<string[]> {
  const avisos: string[] = [];

  for (const item of sold) {
    try {
      const commitment = commitmentFor(item.offer, item.soldUnits);
      if (!commitment) continue;

      const level = await levelOf(companyId, commitment.warehouseId, commitment.itemId);
      if (level && !canCommit(level, commitment.quantity)) {
        const libre = num(level.quantity) - num(level.reserved);
        avisos.push(
          `Se vendieron ${commitment.quantity} unidades y solo quedan ${libre} disponibles.`
        );
      }

      // Se congela en la línea vendida, igual que el precio: si mañana cambian
      // el artículo o el almacén del extra, esta reserva tiene que devolver SUS
      // unidades a SU almacén.
      await tenantUpdate(companyId, "booking_extra", item.bookingExtraId, {
        inventory_item: commitment.itemId,
        warehouse: commitment.warehouseId,
        stock_quantity: commitment.quantity,
        stock_state: "reserved",
      });

      if (level) await bumpReserved(companyId, level, commitment.quantity);
      else {
        // Primer movimiento de ese par: se crea el saldo con la reserva puesta.
        await tenantCreate(companyId, "stock_level", {
          warehouse: commitment.warehouseId,
          inventory_item: commitment.itemId,
          quantity: 0,
          reserved: commitment.quantity,
          available: -commitment.quantity,
          avg_cost: 0,
        });
      }
    } catch (err) {
      // Nunca tumba la venta.
      console.error(`[stock] no se pudo apartar el extra ${item.bookingExtraId}:`, err);
    }
  }

  return avisos;
}

export interface SettleResult {
  consumed: number;
  released: number;
  skipped: number;
  problems: string[];
}

/**
 * Cierra el compromiso de una reserva: consume al embarcar, libera al cancelar.
 *
 * Consumir escribe un movimiento de verdad —la mercancía sale— y baja la
 * reserva a la vez. Liberar solo baja la reserva: no hubo movimiento porque no
 * salió nada.
 */
export async function settleBookingStock(
  companyId: string,
  bookingId: string,
  action: StockAction,
  userId: string | null = null
): Promise<SettleResult> {
  const out: SettleResult = { consumed: 0, released: 0, skipped: 0, problems: [] };

  let lines: (CommittedLine & { _id?: string; id?: string; currency?: string | null })[] = [];
  try {
    lines = await tenantQuery(companyId, "booking_extra", {
      _filter: { booking: bookingId },
      _limit: 100,
    });
  } catch (err) {
    console.error(`[stock] no se pudieron leer los extras de ${bookingId}:`, err);
    return out;
  }

  for (const line of lines) {
    const lineId = String(line._id || line.id || "");
    const step = transition((line.stock_state ?? null) as never, action);
    if (step.ok === false) {
      if (step.noop) out.skipped += 1;
      else out.problems.push(`${line.name || "Extra"}: ${step.reason}`);
      continue;
    }

    const commitment = committedOf(line);
    if (!commitment) {
      out.skipped += 1;
      continue;
    }

    try {
      const level = await levelOf(companyId, commitment.warehouseId, commitment.itemId);

      if (action === "consume") {
        // Se suelta la reserva ANTES del movimiento: si no, `postMovement`
        // recalcularía `available` con la reserva todavía puesta y el
        // disponible saldría descontado dos veces.
        if (level) await bumpReserved(companyId, level, -commitment.quantity);
        await postMovement(companyId, {
          warehouse: commitment.warehouseId,
          inventory_item: commitment.itemId,
          movement_type: "consumption",
          quantity: commitment.quantity,
          reason: "Extra entregado al cliente",
          reference: line.name || null,
          booking_extra: lineId,
          user: userId,
        });
        out.consumed += 1;
      } else {
        if (level) await bumpReserved(companyId, level, -commitment.quantity);
        out.released += 1;
      }

      await tenantUpdate(companyId, "booking_extra", lineId, { stock_state: step.next });
    } catch (err) {
      console.error(`[stock] no se pudo ${action} el extra ${lineId}:`, err);
      out.problems.push(`${line.name || "Extra"}: no se pudo actualizar el almacén.`);
    }
  }

  if (out.consumed || out.released) {
    console.log(`[stock] reserva ${bookingId}: ${out.consumed} consumidos, ${out.released} liberados`);
  }
  return out;
}

/** Las ofertas de extras de un producto, con su configuración de almacén. */
export async function stockableOffers(companyId: string, extraIds: string[]): Promise<Map<string, StockableOffer>> {
  if (extraIds.length === 0) return new Map();
  const rows = await tenantQuery<StockableOffer & { _id: string }>(companyId, "product_extra", {
    _filter: { _id: { in: extraIds.slice(0, 200) } },
    inventory_item: true,
    warehouse: true,
    _limit: 200,
  });
  return new Map(rows.map((r) => [String(r._id), r]));
}

export { refId };
