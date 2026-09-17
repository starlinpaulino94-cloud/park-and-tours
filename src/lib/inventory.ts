import "server-only";
import { tenantCreate, tenantFindOne, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { notify } from "@/lib/notify-service";

/**
 * Perpetual inventory engine.
 *
 * Every quantity change goes through `postMovement`, which writes an immutable
 * `stock_movement` row and then rewrites the `stock_level` balance for that
 * (warehouse, item) pair. The movement is the ledger; the level is the cache.
 * Nothing else in the app is allowed to write `stock_level` directly.
 */

export type MovementType =
  | "receipt" | "sale" | "consumption" | "transfer_out" | "transfer_in"
  | "waste" | "adjustment" | "return" | "count";

/** Sign each movement type applies to the balance. `count` is absolute. */
const DIRECTION: Record<MovementType, 1 | -1 | 0> = {
  receipt: 1, transfer_in: 1, return: 1,
  sale: -1, consumption: -1, transfer_out: -1, waste: -1,
  adjustment: 1, // signed by the caller: a negative quantity reduces stock
  count: 0,      // sets the balance to the counted quantity
};

export interface MovementInput {
  warehouse: string;
  inventory_item: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost?: number | null;
  currency?: string | null;
  reason?: string | null;
  reference?: string | null;
  lot_code?: string | null;
  expires_at?: string | null;
  /** Destination warehouse — required for transfers. */
  to_warehouse?: string | null;
  order?: string | null;
  purchase_order?: string | null;
  /**
   * La LÍNEA de la orden de compra (0052).
   *
   * Con solo la orden no se puede saber cuánto se ha recibido de cada línea, y
   * sin eso lo recibido vive únicamente en `quantity_received`, que se puede
   * teclear a mano. Con la línea, lo recibido se cuenta sumando movimientos.
   */
  purchase_order_line?: string | null;
  /** El extra vendido que comprometió o consumió estas unidades (0052). */
  booking_extra?: string | null;
  work_order?: string | null;
  user?: string | null;
  moved_at?: string | null;
}

export interface StockLevel {
  _id: string;
  quantity?: number;
  reserved?: number;
  available?: number;
  avg_cost?: number;
}

/** Loads the balance row for a (warehouse, item) pair, creating it on first use. */
async function levelFor(companyId: string, warehouse: string, item: string): Promise<StockLevel> {
  const rows = await tenantQuery<StockLevel>(companyId, "stock_level", {
    _filter: { warehouse, inventory_item: item },
    _limit: 1,
  });
  if (rows.length > 0) return rows[0];

  console.log(`[inventory] creando saldo inicial para item=${item} almacén=${warehouse}`);
  return await tenantCreate<StockLevel>(companyId, "stock_level", {
    warehouse,
    inventory_item: item,
    quantity: 0,
    reserved: 0,
    available: 0,
    avg_cost: 0,
  });
}

/**
 * Applies one movement leg: writes the movement and updates the balance.
 * Returns the movement and the resulting balance.
 */
async function applyLeg(
  companyId: string,
  input: MovementInput,
  warehouse: string,
  type: MovementType,
  quantity: number,
  allowNegative: boolean
) {
  const level = await levelFor(companyId, warehouse, input.inventory_item);
  const direction = DIRECTION[type];
  const before = Number(level.quantity ?? 0);

  const after = direction === 0 ? quantity : before + direction * quantity;
  if (after < 0 && !allowNegative) {
    throw new TenantError(
      `Stock insuficiente: el saldo quedaría en ${after}. Habilita stock negativo en el almacén o registra la entrada primero.`,
      409
    );
  }

  const unitCost = Number(input.unit_cost ?? 0);
  // Weighted average cost, recalculated only on inbound movements that carry a cost.
  let avgCost = Number(level.avg_cost ?? 0);
  if (direction === 1 && unitCost > 0 && after > 0) {
    avgCost = (before * avgCost + quantity * unitCost) / (before + quantity || 1);
  }

  const movement = await tenantCreate<{ _id: string }>(companyId, "stock_movement", {
    warehouse,
    inventory_item: input.inventory_item,
    movement_type: type,
    quantity,
    unit_cost: unitCost || null,
    total_cost: unitCost ? unitCost * Math.abs(quantity) : null,
    currency: input.currency || null,
    moved_at: input.moved_at || new Date().toISOString(),
    balance_after: after,
    reason: input.reason || null,
    reference: input.reference || null,
    lot_code: input.lot_code || null,
    expires_at: input.expires_at || null,
    to_warehouse: input.to_warehouse || null,
    order: input.order || null,
    purchase_order: input.purchase_order || null,
    purchase_order_line: input.purchase_order_line || null,
    booking_extra: input.booking_extra || null,
    work_order: input.work_order || null,
    user: input.user || null,
  });

  const reserved = Number(level.reserved ?? 0);
  await tenantUpdate(companyId, "stock_level", level._id, {
    quantity: after,
    available: after - reserved,
    avg_cost: Number(avgCost.toFixed(4)),
    last_movement_at: new Date().toISOString(),
    ...(type === "count" ? { last_counted_at: new Date().toISOString() } : {}),
  });

  // Solo al BAJAR: una entrada de mercancía no puede disparar un aviso de
  // existencias bajas, y comprobarlo en cada movimiento costaría una consulta
  // por recepción sin decir nada nuevo.
  if (direction === -1) {
    const item = await tenantFindOne<Reorderable>(companyId, "inventory_item", input.inventory_item);
    if (isLowStock(after - reserved, item)) {
      // El nombre del almacén solo se busca cuando ya hay algo que avisar: en
      // un aviso que dice «quedan 2» sin decir dónde, la primera pregunta de
      // quien lo lee es justamente dónde.
      const store = await tenantFindOne<{ name?: string }>(companyId, "warehouse", warehouse).catch(() => null);
      await notify({
        companyId,
        event: "stock_low",
        entityType: "stock_level",
        entityId: level._id,
        // Una vez al mes por artículo y almacén: sin la semilla, un artículo
        // que baja, se repone y vuelve a bajar avisaría una sola vez en su
        // vida; con un aviso por movimiento, avisaría en cada salida del día.
        dedupeSeed: new Date().toISOString().slice(0, 7),
        vars: {
          articulo: item?.name || null,
          cantidad: after - reserved,
          minimo: reorderThreshold(item),
          almacen: store?.name || null,
        },
      });
    }
  }

  console.log(
    `[inventory] ${type} item=${input.inventory_item} almacén=${warehouse} ` +
    `cantidad=${quantity} saldo=${before}→${after}`
  );
  return { movementId: movement._id, before, after };
}

/**
 * Posts a movement. Transfers write both legs so the two balances always move
 * together; a failure on the inbound leg is reported rather than swallowed,
 * because a half-applied transfer is the worst possible outcome.
 */
export async function postMovement(companyId: string, input: MovementInput) {
  if (!input.warehouse) throw new TenantError("Falta el almacén", 400);
  if (!input.inventory_item) throw new TenantError("Falta el artículo", 400);

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new TenantError("La cantidad debe ser distinta de cero", 400);
  }
  if (!(input.movement_type in DIRECTION)) {
    throw new TenantError(`Tipo de movimiento inválido: ${input.movement_type}`, 400);
  }

  // `allows_negative` es booleano en la base (0013), no la cadena "yes": la
  // comparación anterior siempre daba falso, así que un almacén configurado
  // para admitir negativos igual bloqueaba la salida. Mismo fallo que ya se
  // había corregido en `approval_request.requires_two`.
  const source = await tenantFindOne<{ allows_negative?: boolean; name?: string }>(
    companyId, "warehouse", input.warehouse
  );
  const allowNegative = source.allows_negative === true;

  const isTransfer = input.movement_type === "transfer_out" || input.movement_type === "transfer_in";
  if (isTransfer && !input.to_warehouse) {
    throw new TenantError("Una transferencia necesita almacén destino", 400);
  }
  if (isTransfer && input.to_warehouse === input.warehouse) {
    throw new TenantError("El almacén destino debe ser distinto del origen", 400);
  }

  const out = await applyLeg(
    companyId, input, input.warehouse,
    isTransfer ? "transfer_out" : input.movement_type,
    Math.abs(quantity) * (input.movement_type === "adjustment" && quantity < 0 ? -1 : 1),
    allowNegative || input.movement_type === "adjustment"
  );

  if (!isTransfer) return { legs: [out] };

  // Inbound leg of the transfer.
  const dest = await tenantFindOne<{ allows_negative?: boolean }>(companyId, "warehouse", input.to_warehouse!);
  const inLeg = await applyLeg(
    companyId,
    { ...input, to_warehouse: input.warehouse },
    input.to_warehouse!,
    "transfer_in",
    Math.abs(quantity),
    dest.allows_negative === true
  );
  return { legs: [out, inLeg] };
}

export interface Reorderable {
  name?: string | null;
  min_stock?: number | null;
  reorder_point?: number | null;
}

/**
 * El umbral por debajo del cual un artículo se considera bajo.
 *
 * Es el punto de pedido si está puesto y, si no, el mínimo. Un artículo sin
 * ninguno de los dos NO tiene umbral: devolver 0 lo convertiría en "bajo" en
 * cuanto se agotara, y avisaría de cosas que a nadie le importan —el sistema
 * no sabe cuántas necesita esa empresa.
 */
export function reorderThreshold(item: Reorderable | null | undefined): number | null {
  const point = Number(item?.reorder_point ?? item?.min_stock ?? 0);
  return point > 0 ? point : null;
}

/** ¿Este saldo está en el umbral o por debajo? */
export function isLowStock(available: number, item: Reorderable | null | undefined): boolean {
  const threshold = reorderThreshold(item);
  return threshold !== null && Number(available) <= threshold;
}

/** Items at or below their reorder point — drives the purchasing suggestions. */
export async function lowStock(companyId: string, limit = 50) {
  const levels = await tenantQuery<any>(companyId, "stock_level", {
    inventory_item: true,
    warehouse: true,
    _sort: { available: "asc" },
    _limit: limit * 4,
  });
  return levels
    // El mismo criterio que el aviso automático: dos definiciones de «bajo»
    // acaban en una pantalla que señala lo que la campana calla.
    .filter((l) => isLowStock(Number(l.available ?? 0), l.inventory_item))
    .slice(0, limit);
}
