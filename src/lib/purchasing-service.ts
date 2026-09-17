import "server-only";
import { tenantFindOne, tenantQuery, tenantUpdate, TenantError } from "@/lib/tenant";
import { postMovement } from "@/lib/inventory";
import { refId } from "@/lib/types";
import {
  lineStates, receiptPlan, statusAfterReceipt, applyPlan, receiveBlocker, pendingSummary,
  type PurchaseLineLike, type ReceiptRequestLine, type LineState,
} from "@/lib/purchasing";

/**
 * Recibir mercancía, contra la base.
 *
 * El orden de las tres escrituras no es casual:
 *
 *  1. **El movimiento primero.** Es el hecho: unas unidades entraron. Si algo
 *     se cae después, el almacén ya dice la verdad y lo que queda mal es una
 *     copia que se puede reconstruir.
 *  2. **La línea después.** `quantity_received` es esa copia.
 *  3. **La cabecera al final**, con el estado que corresponda.
 *
 * Al revés —cabecera primero— una caída a medias dejaría una orden diciendo
 * «recibida» con el almacén vacío, y eso no se detecta hasta el inventario
 * físico de fin de mes.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

interface MovementRow {
  quantity?: number | null;
  movement_type?: string | null;
  purchase_order_line?: unknown;
}

/**
 * Cuánto se ha recibido de cada línea, según el libro de movimientos.
 *
 * Una devolución al proveedor resta: si se recibieron 10 y se devolvieron 2,
 * lo recibido son 8 y la línea vuelve a tener 2 pendientes. Contar solo las
 * entradas daría la orden por cerrada con mercancía que ya no está.
 */
export async function receivedByLine(companyId: string, purchaseOrderId: string): Promise<Record<string, number>> {
  const movimientos = await tenantQuery<MovementRow>(companyId, "stock_movement", {
    _filter: { purchase_order: purchaseOrderId },
    _limit: 2000,
  });
  const out: Record<string, number> = {};
  for (const m of movimientos) {
    const lineId = refId(m.purchase_order_line);
    if (!lineId) continue;
    const signo = m.movement_type === "return" ? -1 : 1;
    out[lineId] = (out[lineId] ?? 0) + signo * Math.abs(num(m.quantity));
  }
  return out;
}

/** El estado de una orden: sus líneas, lo recibido y lo que falta. */
export async function purchaseOrderState(companyId: string, purchaseOrderId: string) {
  const [order, lines] = await Promise.all([
    tenantFindOne<Record<string, unknown>>(companyId, "purchase_order", purchaseOrderId),
    tenantQuery<PurchaseLineLike>(companyId, "purchase_order_line", {
      _filter: { purchase_order: purchaseOrderId },
      inventory_item: true,
      _limit: 500,
    }),
  ]);
  const recibido = await receivedByLine(companyId, purchaseOrderId);
  const states = lineStates(lines, recibido, refId);
  return { order, states, pending: pendingSummary(states) };
}

export interface ReceiveResult {
  received: { lineId: string; description: string; quantity: number; movedStock: boolean }[];
  problems: { lineId: string; description: string; reason: string }[];
  status: string;
  totalCost: number;
}

/**
 * Registra una recepción.
 *
 * Lo que NO hace, a propósito: crear la cuenta por pagar. Una recepción es
 * mercancía que entra; la factura del proveedor puede llegar días después, con
 * otro importe y otro NCF, y atarlas aquí obligaría a inventar una factura que
 * todavía no existe. La orden guarda su `payable_id` para cuando llegue.
 */
export async function receivePurchaseOrder(
  companyId: string,
  userId: string,
  purchaseOrderId: string,
  request: ReceiptRequestLine[],
  options: { allowOver?: boolean; warehouse?: string | null; reference?: string | null } = {}
): Promise<ReceiveResult> {
  const { order, states } = await purchaseOrderState(companyId, purchaseOrderId);

  const warehouse = (options.warehouse || "").trim() || refId(order.warehouse);
  const blocker = receiveBlocker(order.status as string, warehouse);
  if (blocker) throw new TenantError(blocker, 409);

  const plan = receiptPlan(states, request, { allowOver: options.allowOver });
  if (plan.accepted.length === 0) {
    throw Object.assign(new TenantError("No se pudo recibir ninguna línea.", 400), {
      details: plan.problems,
    });
  }

  const currency = (order.currency as string) || "usd";
  const recibidas: ReceiveResult["received"] = [];

  for (const linea of plan.accepted) {
    if (linea.movesStock && linea.itemId) {
      await postMovement(companyId, {
        warehouse: warehouse!,
        inventory_item: linea.itemId,
        movement_type: "receipt",
        quantity: linea.receiving,
        unit_cost: linea.cost,
        currency,
        reason: linea.over ? "Recepción con exceso sobre lo pedido" : "Recepción de orden de compra",
        reference: options.reference || (order.code as string) || null,
        lot_code: linea.lotCode,
        expires_at: linea.expiresAt,
        purchase_order: purchaseOrderId,
        purchase_order_line: linea.lineId,
        user: userId,
      });
    }

    // La copia, después del hecho.
    await tenantUpdate(companyId, "purchase_order_line", linea.lineId, {
      quantity_received: linea.received + linea.receiving,
    });

    recibidas.push({
      lineId: linea.lineId,
      description: linea.description,
      quantity: linea.receiving,
      movedStock: linea.movesStock,
    });
  }

  const despues = applyPlan(states, plan);
  const status = statusAfterReceipt(despues);
  await tenantUpdate(companyId, "purchase_order", purchaseOrderId, {
    status,
    received_at: new Date().toISOString(),
    receipt_count: num(order.receipt_count) + 1,
    last_received_by: userId,
  });

  console.log(
    `[compras] orden ${order.code ?? purchaseOrderId}: ${recibidas.length} líneas recibidas, queda ${status}`
  );
  return { received: recibidas, problems: plan.problems, status, totalCost: plan.totalCost };
}

/** Las órdenes con algo pendiente de llegar, para la pantalla de recepción. */
export async function openPurchaseOrders(companyId: string, limit = 50) {
  const orders = await tenantQuery<Record<string, unknown>>(companyId, "purchase_order", {
    _filter: { status: { in: ["approved", "sent", "partially_received"] } },
    supplier: true,
    warehouse: true,
    _sort: { expected_at: "asc" },
    _limit: limit,
  });
  return orders;
}

export type { LineState };
