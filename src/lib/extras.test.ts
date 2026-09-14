import { describe, it, expect } from "vitest";
import { chargeableUnits, priceExtra, priceExtras, unknownSelections } from "@/lib/extras";

const lunch = { _id: "e1", name: "Almuerzo langosta", price_type: "per_person", price: 35, cost: 18 };
const transfer = { _id: "e2", name: "Transfer privado", price_type: "per_booking", price: 120, cost: 70 };
const parkFee = { _id: "e3", name: "Entrada parque nacional", price_type: "per_person", price: 10, is_required: true };

describe("extras — cuántas unidades se cobran", () => {
  it("por persona, uno por pax que paga", () => {
    // El bebé no ocupa plaza de almuerzo porque no come menú: `billablePax` ya
    // lo excluye, y el extra hereda ese criterio en vez de inventar otro.
    expect(chargeableUnits(lunch, { extra_id: "e1" }, 4)).toBe(4);
  });

  it("por reserva, una vez, viajen los que viajen", () => {
    // Un transfer privado no se multiplica por cuatro porque viajen cuatro.
    expect(chargeableUnits(transfer, { extra_id: "e2" }, 4)).toBe(1);
  });

  it("una cantidad explícita manda sobre el automático", () => {
    expect(chargeableUnits(lunch, { extra_id: "e1", quantity: 2 }, 4)).toBe(2);
    // Dos transfers para un grupo que se parte en dos vehículos.
    expect(chargeableUnits(transfer, { extra_id: "e2", quantity: 2 }, 4)).toBe(2);
  });

  it("el tope del catálogo acota: nadie compra diez seguros para una reserva", () => {
    expect(chargeableUnits({ ...lunch, max_quantity: 2 }, { extra_id: "e1", quantity: 9 }, 8)).toBe(2);
    expect(chargeableUnits({ ...lunch, max_quantity: 2 }, { extra_id: "e1" }, 8)).toBe(2);
  });

  it("una cantidad absurda no produce un cobro absurdo", () => {
    expect(chargeableUnits(lunch, { extra_id: "e1", quantity: -3 }, 4)).toBe(4);
    expect(chargeableUnits(lunch, { extra_id: "e1", quantity: "x" as never }, 4)).toBe(4);
  });
});

describe("extras — precio de una línea", () => {
  it("multiplica precio por unidades y arrastra el coste", () => {
    const line = priceExtra(lunch, { extra_id: "e1" }, 3);
    expect(line).toMatchObject({ quantity: 3, unit_price: 35, total_amount: 105, cost_amount: 54 });
  });

  it("copia el nombre: el voucher de una reserva vieja sigue diciendo qué se compró", () => {
    // Si el extra se renombra o se retira, la reserva no puede quedarse muda.
    expect(priceExtra(lunch, { extra_id: "e1" }, 1).name).toBe("Almuerzo langosta");
  });

  it("sin coste declarado el margen no se inventa", () => {
    expect(priceExtra(parkFee, { extra_id: "e3" }, 2)).toMatchObject({ unit_cost: null, cost_amount: 0 });
  });
});

describe("extras — los de una reserva", () => {
  const offers = [lunch, transfer, parkFee];

  it("solo se cobra lo escogido", () => {
    const { lines, total } = priceExtras(offers, [{ extra_id: "e1" }], 2);
    // El almuerzo escogido (70) más la tasa obligatoria (20).
    expect(lines.map((l) => l.extra_id).sort()).toEqual(["e1", "e3"]);
    expect(total).toBe(90);
  });

  it("un extra obligatorio se añade aunque nadie lo marque", () => {
    // Es una tasa, no una opción: dejarla fuera significa cobrarla a mano en la
    // puerta o comérsela.
    const { lines } = priceExtras(offers, [], 2);
    expect(lines).toHaveLength(1);
    expect(lines[0].extra_id).toBe("e3");
  });

  it("un extra retirado del catálogo no se vende", () => {
    // Aunque siga en el carrito de una pestaña vieja.
    const { lines } = priceExtras([{ ...lunch, status: "inactive" }], [{ extra_id: "e1" }], 2);
    expect(lines).toEqual([]);
  });

  it("cantidad cero es 'no lo quiero': no se guarda una línea de importe cero", () => {
    const { lines } = priceExtras([lunch], [{ extra_id: "e1", quantity: 0 }], 0);
    expect(lines).toEqual([]);
  });

  it("suma el importe y el coste por separado", () => {
    const { total, cost } = priceExtras(offers, [{ extra_id: "e1" }, { extra_id: "e2" }], 2);
    expect(total).toBe(70 + 120 + 20);
    expect(cost).toBe(36 + 70);
  });

  it("sin ofertas ni selección, cero", () => {
    expect(priceExtras([], [], 4)).toEqual({ lines: [], total: 0, cost: 0 });
  });
});

describe("extras — lo que el catálogo no reconoce", () => {
  it("se delata en vez de ignorarse", () => {
    // Un extra de otro producto en el carrito significa que algo va mal, y
    // cobrar de menos en silencio es peor que fallar.
    expect(unknownSelections([lunch], [{ extra_id: "e1" }, { extra_id: "ajeno" }]))
      .toEqual(["ajeno"]);
  });

  it("uno inactivo cuenta como desconocido", () => {
    expect(unknownSelections([{ ...lunch, status: "inactive" }], [{ extra_id: "e1" }])).toEqual(["e1"]);
  });
});
