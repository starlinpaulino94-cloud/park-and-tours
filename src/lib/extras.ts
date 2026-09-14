/**
 * Los extras que se venden con la excursión.
 *
 * El almuerzo langosta, la foto del salto, el traslado premium, la entrada al
 * parque nacional. En una operadora es donde está el margen —el tour compite por
 * precio y el extra no—, y hasta ahora no había forma de venderlos: o se creaba
 * un producto suelto que ensuciaba el catálogo y descuadraba la ocupación de las
 * salidas, o se cobraban por fuera del sistema.
 *
 * Aquí se decide lo único que tiene enjundia: cuánto cuesta cada uno según cómo
 * se cobre, y qué cantidad es válida.
 */

export type ExtraPriceType = "per_person" | "per_booking";

export interface ExtraOffer {
  _id: string;
  name?: string | null;
  price_type?: string | null;
  price?: number | null;
  cost?: number | null;
  currency?: string | null;
  is_required?: boolean | null;
  max_quantity?: number | null;
  status?: string | null;
  sort_order?: number | null;
}

export interface ExtraSelection {
  extra_id: string;
  quantity?: number | null;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Cuántas unidades se cobran.
 *
 * Un extra por persona se cobra por los pax que PAGAN: el bebé no ocupa plaza de
 * almuerzo porque no come menú. Uno por reserva se cobra una vez, diga lo que
 * diga la cantidad — un transfer privado no se multiplica por cuatro porque
 * viajen cuatro.
 */
export function chargeableUnits(
  offer: ExtraOffer,
  selection: ExtraSelection,
  billablePax: number
): number {
  const requested = Math.max(Math.floor(num(selection.quantity)), 0);
  if (offer.price_type === "per_booking") {
    // Aquí la cantidad SÍ significa "cuántos de estos": dos transfers privados
    // para un grupo que se parte en dos vehículos.
    const units = requested > 0 ? requested : 1;
    return capped(offer, units);
  }
  // Por persona: sin cantidad explícita, uno por pax que paga.
  const units = requested > 0 ? requested : Math.max(billablePax, 0);
  return capped(offer, units);
}

/** El tope del catálogo manda: nadie compra diez seguros para una reserva. */
function capped(offer: ExtraOffer, units: number): number {
  const max = offer.max_quantity;
  if (max === null || max === undefined) return units;
  const limit = Math.max(Math.floor(num(max)), 0);
  return limit > 0 ? Math.min(units, limit) : units;
}

export interface ExtraLine {
  extra_id: string;
  name: string;
  price_type: ExtraPriceType;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  total_amount: number;
  cost_amount: number;
  currency: string;
}

/** Una línea de extra ya valorada, tal y como se guarda con la reserva. */
export function priceExtra(offer: ExtraOffer, selection: ExtraSelection, billablePax: number): ExtraLine {
  const quantity = chargeableUnits(offer, selection, billablePax);
  const unitPrice = Math.max(num(offer.price), 0);
  const unitCost = offer.cost === null || offer.cost === undefined ? null : Math.max(num(offer.cost), 0);
  return {
    extra_id: offer._id,
    name: offer.name || "Extra",
    price_type: offer.price_type === "per_booking" ? "per_booking" : "per_person",
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    total_amount: round2(unitPrice * quantity),
    cost_amount: round2((unitCost ?? 0) * quantity),
    currency: offer.currency || "usd",
  };
}

export interface ExtrasResult {
  lines: ExtraLine[];
  total: number;
  cost: number;
}

/**
 * Los extras de una reserva: los escogidos más los obligatorios.
 *
 * Un extra `is_required` es una tasa, no una opción —la entrada al parque
 * nacional, el impuesto de muelle—: se añade aunque nadie lo marque, porque el
 * cliente tiene que pagarlo igual y dejarlo fuera significa cobrarlo a mano en
 * la puerta o comérselo.
 *
 * Las ofertas inactivas se ignoran: un extra retirado del catálogo no se vende
 * aunque siga en el carrito de una pestaña vieja.
 */
export function priceExtras(
  offers: ExtraOffer[],
  selections: ExtraSelection[],
  billablePax: number
): ExtrasResult {
  const active = offers.filter((o) => o.status !== "inactive");
  const chosen = new Map(selections.map((s) => [s.extra_id, s]));
  const lines: ExtraLine[] = [];

  for (const offer of active) {
    const selection = chosen.get(offer._id);
    if (!selection && !offer.is_required) continue;
    const line = priceExtra(offer, selection ?? { extra_id: offer._id }, billablePax);
    // Cantidad cero es "no lo quiero": no se guarda una línea de importe cero.
    if (line.quantity <= 0) continue;
    lines.push(line);
  }

  return {
    lines,
    total: round2(lines.reduce((s, l) => s + l.total_amount, 0)),
    cost: round2(lines.reduce((s, l) => s + l.cost_amount, 0)),
  };
}

/**
 * Extras seleccionados que el catálogo no reconoce.
 *
 * Se devuelven para rechazarlos en vez de ignorarlos: un extra de otro producto
 * en el carrito significa que algo va mal —una pestaña vieja, un payload a
 * mano— y cobrar de menos en silencio es peor que fallar.
 */
export function unknownSelections(offers: ExtraOffer[], selections: ExtraSelection[]): string[] {
  const known = new Set(offers.filter((o) => o.status !== "inactive").map((o) => o._id));
  return selections.map((s) => s.extra_id).filter((id) => id && !known.has(id));
}
