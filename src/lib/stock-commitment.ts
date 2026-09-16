/**
 * VENDER, ENTREGAR Y DEVOLVER: EL CICLO DEL ARTÍCULO VENDIDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DATO QUE NADIE ESCRIBÍA
 *
 * `stock_level.reserved` existe desde 0013, la pantalla de existencias lo
 * enseña en una columna, y NADA lo ha escrito nunca: siempre cero. La columna
 * prometía distinguir «lo que hay» de «lo que puedo vender», y no distinguía
 * nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TRES PASOS Y NO UNO
 *
 * Un almuerzo vendido para el jueves no ha salido del almacén, pero tampoco se
 * le puede vender a otro. Descontarlo al vender diría que hay menos comida de
 * la que hay; descontarlo solo al embarcar dejaría vender cuarenta almuerzos
 * cuando quedan treinta.
 *
 *   vender   →  reserved += n     (las unidades siguen ahí, ya no son vendibles)
 *   embarcar →  reserved -= n, y sale un movimiento real de consumo
 *   cancelar →  reserved -= n     (vuelven a estar libres; no hubo movimiento)
 *
 * El archivo es puro: decide CUÁNTO se compromete y si la transición es
 * legítima. Quien toca la base es `stock-commitment-service.ts`.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** En qué punto del ciclo está lo vendido. `null` = nunca comprometió stock. */
export type StockState = "reserved" | "consumed" | "released" | null;

export interface StockableOffer {
  _id?: string | null;
  consumes_stock?: boolean | null;
  inventory_item?: unknown;
  warehouse?: unknown;
  stock_per_unit?: number | null;
}

export interface Commitment {
  itemId: string;
  warehouseId: string;
  /** Unidades de almacén comprometidas en total. */
  quantity: number;
}

function ref(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const row = v as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Cuánto almacén compromete vender `soldUnits` de este extra.
 *
 * Devuelve `null` cuando no compromete nada, y son cuatro casos distintos que
 * acaban igual: el extra no consume stock (una recogida en el hotel no sale de
 * ningún estante), no tiene artículo, no tiene almacén, o se vendieron cero
 * unidades. Hacer que los cuatro devuelvan `null` es lo que permite llamar a
 * esto para TODA venta sin preguntar antes.
 */
export function commitmentFor(offer: StockableOffer, soldUnits: number): Commitment | null {
  if (offer.consumes_stock !== true) return null;
  const itemId = ref(offer.inventory_item);
  const warehouseId = ref(offer.warehouse);
  if (!itemId || !warehouseId) return null;

  const perUnit = num(offer.stock_per_unit) > 0 ? num(offer.stock_per_unit) : 1;
  const quantity = round3(Math.max(0, num(soldUnits)) * perUnit);
  if (quantity <= 0) return null;

  return { itemId, warehouseId, quantity };
}

export interface CommittedLine {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  inventory_item?: unknown;
  warehouse?: unknown;
  stock_quantity?: number | null;
  stock_state?: string | null;
}

/** Lo que una línea ya vendida tiene comprometido, si algo. */
export function committedOf(line: CommittedLine): Commitment | null {
  const itemId = ref(line.inventory_item);
  const warehouseId = ref(line.warehouse);
  const quantity = round3(num(line.stock_quantity));
  if (!itemId || !warehouseId || quantity <= 0) return null;
  return { itemId, warehouseId, quantity };
}

export type StockAction = "consume" | "release";

/**
 * ¿Se puede mover esta línea a ese estado?
 *
 * Solo lo reservado avanza. Lo ya consumido no se vuelve a consumir —sería
 * descontar dos veces el mismo almuerzo— y lo liberado ya soltó sus unidades.
 * Una línea que nunca comprometió nada no es un error: es una recogida en el
 * hotel, y no hay nada que hacer con ella.
 */
export function transition(
  state: StockState | string | null | undefined,
  action: StockAction
): { ok: true; next: "consumed" | "released" } | { ok: false; reason: string; noop: boolean } {
  const s = (state ?? null) as StockState;
  if (s === null) return { ok: false, reason: "Esta línea no compromete existencias.", noop: true };
  if (s === "reserved") return { ok: true, next: action === "consume" ? "consumed" : "released" };
  if (s === "consumed") {
    return action === "consume"
      ? { ok: false, reason: "Estas unidades ya se entregaron.", noop: true }
      : {
          ok: false,
          // Devolver mercancía ya entregada es una devolución con su propio
          // movimiento, no una liberación de reserva: las unidades salieron de
          // verdad y volver a sumarlas sin rastro descuadraría el almacén.
          reason: "Estas unidades ya salieron: regístralo como devolución, no como liberación.",
          noop: false,
        };
  }
  return { ok: false, reason: "Estas unidades ya se habían liberado.", noop: true };
}

/**
 * Lo que hay que apartar, agrupado por artículo y almacén.
 *
 * Una reserva puede llevar dos extras del mismo artículo —«almuerzo» y «almuerzo
 * infantil» apuntando al mismo plato—: sumarlos evita dos escrituras sobre el
 * mismo saldo, que es donde se pierde una de las dos cuando llegan a la vez.
 */
export function groupCommitments(commitments: Commitment[]): Commitment[] {
  const by = new Map<string, Commitment>();
  for (const c of commitments) {
    const key = `${c.itemId}|${c.warehouseId}`;
    const acc = by.get(key);
    if (acc) acc.quantity = round3(acc.quantity + c.quantity);
    else by.set(key, { ...c });
  }
  return [...by.values()];
}

/** El saldo disponible después de apartar `quantity`. */
export function availableAfter(level: { quantity?: number | null; reserved?: number | null }, quantity: number): number {
  return round3(num(level.quantity) - num(level.reserved) - num(quantity));
}

/**
 * ¿Hay con qué servir esto?
 *
 * Se mira lo DISPONIBLE, no lo que hay: treinta almuerzos con veinticinco ya
 * vendidos dan para cinco, no para treinta.
 */
export function canCommit(
  level: { quantity?: number | null; reserved?: number | null },
  quantity: number,
  allowNegative = false
): boolean {
  return allowNegative || availableAfter(level, quantity) >= 0;
}
