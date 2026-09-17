/**
 * LA RECEPCIÓN DE MERCANCÍA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 *
 * La orden de compra existe desde 0013 con todo lo que hace falta —líneas,
 * `quantity_received`, estados «recibida parcialmente» y «recibida», almacén—
 * y RECIBIR no movía una sola unidad de stock. `stock_movement` tiene desde
 * entonces una columna `purchase_order_id` que nadie escribía nunca.
 *
 * Lo que pasaba de verdad: se marcaba la orden como recibida a mano y después
 * alguien registraba un ajuste de inventario a ojo. Las dos cifras —lo comprado
 * y lo que hay— nacían separadas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA VERDAD ESTÁ EN LOS MOVIMIENTOS, NO EN `quantity_received`
 *
 * `quantity_received` es editable desde el CRUD genérico, así que cualquiera
 * puede ponerlo en lo que quiera. Aquí se trata como lo que es —una copia para
 * leer rápido, igual que `stock_level` respecto de `stock_movement`— y lo
 * recibido de verdad se cuenta sumando los movimientos de esa línea. Si las dos
 * cifras discrepan, gana el movimiento: es el que tiene detrás una unidad
 * física.
 *
 * Este archivo es puro: decide qué se puede recibir y cuánto. Quien mueve el
 * stock es `inventory.ts`.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PurchaseStatus =
  | "draft" | "pending_approval" | "approved" | "sent"
  | "partially_received" | "received" | "invoiced" | "cancelled" | "rejected";

/**
 * Estados desde los que tiene sentido recibir.
 *
 * Un borrador no: nadie ha aprobado ese gasto y recibir contra él metería
 * mercancía —y su costo— por una puerta sin control. Una orden ya facturada
 * tampoco: si llega algo más, es otra orden o una nota del proveedor.
 */
export const RECEIVABLE_STATUS = new Set<string>(["approved", "sent", "partially_received"]);

export interface PurchaseLineLike {
  _id?: string | null;
  id?: string | null;
  description?: string | null;
  quantity?: number | null;
  quantity_received?: number | null;
  unit_cost?: number | null;
  inventory_item?: unknown;
}

export interface LineState {
  lineId: string;
  description: string;
  itemId: string | null;
  ordered: number;
  received: number;
  pending: number;
  unitCost: number;
  /** Una línea sin artículo es un servicio —flete, montaje— y no mueve stock. */
  movesStock: boolean;
}

/**
 * El estado de cada línea, contando lo recibido por los movimientos.
 *
 * `receivedByLine` viene del libro de movimientos. Si falta la entrada de una
 * línea —porque se recibió antes de que esto existiera— se cae en
 * `quantity_received`, que es lo único que hay de aquella época.
 */
export function lineStates(
  lines: PurchaseLineLike[],
  receivedByLine: Record<string, number> = {},
  refId: (v: unknown) => string | null = defaultRefId
): LineState[] {
  return lines.map((l) => {
    const lineId = String(l._id ?? l.id ?? "");
    const ordered = round3(Math.max(0, num(l.quantity)));
    const fromMovements = receivedByLine[lineId];
    const received = round3(
      Math.max(0, fromMovements === undefined ? num(l.quantity_received) : fromMovements)
    );
    const itemId = refId(l.inventory_item);
    return {
      lineId,
      description: String(l.description || "Sin descripción"),
      itemId,
      ordered,
      received,
      pending: round3(Math.max(0, ordered - received)),
      unitCost: round2(num(l.unit_cost)),
      movesStock: Boolean(itemId),
    };
  });
}

function defaultRefId(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const row = v as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** Por qué no se puede recibir esta orden, o `null` si sí se puede. */
export function receiveBlocker(status: string | null | undefined, warehouseId: string | null): string | null {
  const s = String(status || "draft").toLowerCase();
  if (s === "cancelled" || s === "rejected") return "Esta orden está cancelada.";
  if (s === "received") return "Esta orden ya se recibió completa.";
  if (s === "invoiced") return "Esta orden ya está facturada; lo que llegue después va en otra orden.";
  if (!RECEIVABLE_STATUS.has(s)) {
    return "Hay que aprobar la orden antes de recibir mercancía contra ella.";
  }
  if (!warehouseId) return "La orden no tiene almacén: sin él no se sabe dónde entra la mercancía.";
  return null;
}

export interface ReceiptRequestLine {
  lineId: string;
  quantity: number;
  /** El costo real de la factura del proveedor, si vino distinto del pedido. */
  unitCost?: number | null;
  lotCode?: string | null;
  expiresAt?: string | null;
}

export interface AcceptedLine extends LineState {
  receiving: number;
  /** Lo que se paga de verdad por unidad: el de la factura si vino, si no el del pedido. */
  cost: number;
  lotCode: string | null;
  expiresAt: string | null;
  /** Se está recibiendo más de lo pedido. */
  over: boolean;
}

export interface ReceiptPlan {
  accepted: AcceptedLine[];
  problems: { lineId: string; description: string; reason: string }[];
  /** Solo lo que mueve stock; el resto es servicio y solo cambia el estado. */
  movements: AcceptedLine[];
  totalCost: number;
}

/**
 * Qué se recibe de verdad, línea por línea.
 *
 * Tres reglas con motivo:
 *
 *  · **Cantidad cero o negativa no es recepción.** Se rechaza en vez de
 *    escribir un movimiento vacío que ensucie el libro.
 *
 *  · **Recibir de más se permite solo si se pide expresamente.** Un proveedor
 *    manda 12 en vez de 10 y eso pasa; lo que no puede pasar es que se cuele
 *    sin que nadie lo vea, porque esas 2 unidades también se pagan.
 *
 *  · **Una línea sin artículo no mueve stock.** El flete y el montaje son
 *    líneas legítimas de una orden de compra y no son mercancía.
 */
export function receiptPlan(
  states: LineState[],
  request: ReceiptRequestLine[],
  options: { allowOver?: boolean } = {}
): ReceiptPlan {
  const byId = new Map(states.map((s) => [s.lineId, s]));
  const accepted: AcceptedLine[] = [];
  const problems: ReceiptPlan["problems"] = [];

  for (const req of request) {
    const state = byId.get(req.lineId);
    if (!state) {
      problems.push({ lineId: req.lineId, description: "—", reason: "Esa línea no es de esta orden." });
      continue;
    }
    const qty = round3(num(req.quantity));
    if (qty <= 0) {
      problems.push({ lineId: state.lineId, description: state.description, reason: "La cantidad tiene que ser mayor que cero." });
      continue;
    }
    const over = round3(state.received + qty) > state.ordered;
    if (over && !options.allowOver) {
      problems.push({
        lineId: state.lineId,
        description: state.description,
        reason: `Se pidieron ${state.ordered} y ya hay ${state.received}: recibir ${qty} pasa lo pedido. Confirma la sobre-recepción si el proveedor mandó de más.`,
      });
      continue;
    }
    const cost = req.unitCost === null || req.unitCost === undefined ? state.unitCost : round2(num(req.unitCost));
    accepted.push({
      ...state,
      receiving: qty,
      cost,
      lotCode: req.lotCode ?? null,
      expiresAt: req.expiresAt ?? null,
      over,
    });
  }

  return {
    accepted,
    problems,
    movements: accepted.filter((a) => a.movesStock),
    totalCost: round2(accepted.reduce((s, a) => s + a.receiving * a.cost, 0)),
  };
}

/**
 * El estado de la orden después de recibir.
 *
 * `states` tiene que ser el estado YA actualizado. Se considera completa cuando
 * ninguna línea queda pendiente; una sola línea a medias la deja parcial,
 * porque el proveedor todavía debe algo.
 */
export function statusAfterReceipt(states: LineState[]): "partially_received" | "received" {
  if (states.length === 0) return "received";
  return states.every((s) => s.pending <= 0) ? "received" : "partially_received";
}

/** Aplica un plan sobre los estados, para saber cómo queda la orden. */
export function applyPlan(states: LineState[], plan: ReceiptPlan): LineState[] {
  const recibido = new Map(plan.accepted.map((a) => [a.lineId, a.receiving]));
  return states.map((s) => {
    const mas = recibido.get(s.lineId) ?? 0;
    const received = round3(s.received + mas);
    return { ...s, received, pending: round3(Math.max(0, s.ordered - received)) };
  });
}

/** Lo que queda por llegar de una orden, para la pantalla y los avisos. */
export function pendingSummary(states: LineState[]) {
  const pendientes = states.filter((s) => s.pending > 0);
  return {
    lines: pendientes.length,
    units: round3(pendientes.reduce((s, l) => s + l.pending, 0)),
    value: round2(pendientes.reduce((s, l) => s + l.pending * l.unitCost, 0)),
  };
}
