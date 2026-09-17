import { describe, it, expect } from "vitest";
import {
  applies, pickAllotment, allotmentState, saleBlocker, SALE_BLOCK_MESSAGE,
  shouldRelease, releasableSeats, allotmentMatrix, weekdayOf,
  HOLDS_SEATS, SELLABLE,
} from "@/lib/allotments";

/**
 * Un cupo mal calculado se paga dos veces: una cuando el socio vende una plaza
 * que no tenía, y otra cuando la operadora deja sin vender diez que el socio
 * nunca iba a usar. Lo que se prueba aquí son las formas concretas en que eso
 * pasa.
 */

const GARANTIZADO = {
  _id: "a1", allotment_type: "guaranteed", seats: 10, seats_used: 3, seats_released: 0,
  release_days: 3, partner: "p1", product: "prod1", status: "active",
};

describe("qué cupo aplica", () => {
  it("el de otro socio no aplica, por más que coincida todo lo demás", () => {
    expect(applies(GARANTIZADO, { partnerId: "p2", productId: "prod1" })).toBe(false);
  });

  it("un cupo inactivo no aplica", () => {
    expect(applies({ ...GARANTIZADO, status: "inactive" }, { partnerId: "p1", productId: "prod1" })).toBe(false);
  });

  it("respeta la temporada contratada", () => {
    const temporada = { ...GARANTIZADO, valid_from: "2026-06-01", valid_to: "2026-08-31" };
    expect(applies(temporada, { partnerId: "p1", productId: "prod1", travelDate: "2026-07-15" })).toBe(true);
    expect(applies(temporada, { partnerId: "p1", productId: "prod1", travelDate: "2026-09-01" })).toBe(false);
    expect(applies(temporada, { partnerId: "p1", productId: "prod1", travelDate: "2026-05-31" })).toBe(false);
  });

  it("una lista de días vacía significa TODOS los días, no ninguno", () => {
    // Al revés, un cupo al que nadie le puso días no vendería nunca.
    expect(applies({ ...GARANTIZADO, weekdays: [] }, { partnerId: "p1", productId: "prod1", travelDate: "2026-09-16" })).toBe(true);
  });

  it("con días puestos, solo esos días", () => {
    const soloFinDeSemana = { ...GARANTIZADO, weekdays: ["sat", "sun"] };
    expect(weekdayOf("2026-09-19")).toBe("sat");
    expect(applies(soloFinDeSemana, { partnerId: "p1", productId: "prod1", travelDate: "2026-09-19" })).toBe(true);
    expect(applies(soloFinDeSemana, { partnerId: "p1", productId: "prod1", travelDate: "2026-09-16" })).toBe(false);
  });

  it("un cupo atado a un producto no aplica a una consulta de otro producto", () => {
    expect(applies(GARANTIZADO, { partnerId: "p1", productId: "otro" })).toBe(false);
  });

  it("un cupo de salida concreta no aplica a otra salida", () => {
    const deSalida = { ...GARANTIZADO, departure: "dep1" };
    expect(applies(deSalida, { partnerId: "p1", departureId: "dep1" })).toBe(true);
    expect(applies(deSalida, { partnerId: "p1", departureId: "dep2" })).toBe(false);
  });

  it("un cupo sin producto ni salida aplica a todo lo del socio", () => {
    const global = { _id: "g", allotment_type: "free_sale", partner: "p1", status: "active" };
    expect(applies(global, { partnerId: "p1", productId: "cualquiera" })).toBe(true);
  });
});

describe("cuál manda cuando hay varios", () => {
  it("el de la salida concreta gana al del producto: es más específico", () => {
    const elegido = pickAllotment(
      [GARANTIZADO, { ...GARANTIZADO, _id: "a2", departure: "dep1" }],
      { partnerId: "p1", productId: "prod1", departureId: "dep1" }
    );
    expect(elegido?._id).toBe("a2");
  });

  it("entre iguales, gana el que caduca antes: es el más restrictivo", () => {
    const elegido = pickAllotment(
      [
        { ...GARANTIZADO, _id: "largo", valid_to: "2026-12-31" },
        { ...GARANTIZADO, _id: "corto", valid_to: "2026-09-30" },
      ],
      { partnerId: "p1", productId: "prod1", travelDate: "2026-09-16" }
    );
    expect(elegido?._id).toBe("corto");
  });

  it("sin candidatos devuelve null, no el primero de la lista", () => {
    expect(pickAllotment([GARANTIZADO], { partnerId: "otro" })).toBeNull();
  });
});

describe("el estado del cupo", () => {
  it("solo el garantizado aparta plazas", () => {
    expect(HOLDS_SEATS.has("guaranteed")).toBe(true);
    expect(HOLDS_SEATS.has("free_sale")).toBe(false);
    expect(allotmentState({ ...GARANTIZADO, allotment_type: "free_sale" }).holds).toBe(false);
  });

  it("lo liberado ya no es suyo: resta de lo que le queda", () => {
    // Contarlo como disponible prometería dos veces la misma plaza: una al
    // socio y otra a quien la compró después.
    const s = allotmentState({ ...GARANTIZADO, seats_used: 3, seats_released: 5 });
    expect(s.remaining).toBe(2);
  });

  it("sin cupo, el socio vende contra la capacidad de la salida", () => {
    const s = allotmentState(null);
    expect(s.remaining).toBe(Infinity);
    expect(s.sellable).toBe(true);
    expect(s.holds).toBe(false);
  });

  it("un cupo cerrado no vende", () => {
    expect(allotmentState({ ...GARANTIZADO, allotment_type: "closed" }).sellable).toBe(false);
    expect(SELLABLE.has("closed")).toBe(false);
  });

  it("«a petición» vende pero marca que hace falta confirmar", () => {
    const s = allotmentState({ ...GARANTIZADO, allotment_type: "on_request" });
    expect(s.sellable).toBe(true);
    expect(s.needsConfirmation).toBe(true);
    // Y no aparta plazas: por eso su tope es la capacidad de la salida.
    expect(s.remaining).toBe(Infinity);
  });

  it("un cupo sobrepasado no devuelve restante negativo", () => {
    expect(allotmentState({ ...GARANTIZADO, seats: 5, seats_used: 9 }).remaining).toBe(0);
  });
});

describe("si el socio puede vender", () => {
  it("con cupo cerrado, no", () => {
    const b = saleBlocker(allotmentState({ ...GARANTIZADO, allotment_type: "closed" }), 1);
    expect(b).toBe("closed");
    expect(SALE_BLOCK_MESSAGE[b!]).toMatch(/cerrado/);
  });

  it("no puede pasar de su cupo garantizado", () => {
    const s = allotmentState(GARANTIZADO); // 10 − 3 = 7
    expect(saleBlocker(s, 7)).toBeNull();
    expect(saleBlocker(s, 8)).toBe("no_seats");
  });

  it("con venta libre no hay tope propio: lo decide la capacidad de la salida", () => {
    const s = allotmentState({ ...GARANTIZADO, allotment_type: "free_sale" });
    expect(saleBlocker(s, 999)).toBeNull();
  });

  it("sin cupo tampoco hay tope propio", () => {
    expect(saleBlocker(allotmentState(null), 50)).toBeNull();
  });
});

describe("la liberación automática", () => {
  const AHORA = new Date("2026-09-16T12:00:00Z");

  it("libera cuando entra en la ventana de días", () => {
    // release_days = 3 → se libera desde 3 días antes.
    expect(shouldRelease(GARANTIZADO, "2026-09-18T08:00:00Z", AHORA)).toBe(true);
    expect(shouldRelease(GARANTIZADO, "2026-09-25T08:00:00Z", AHORA)).toBe(false);
  });

  it("sin días de liberación NO se libera nunca: hay contratos en firme", () => {
    expect(shouldRelease({ ...GARANTIZADO, release_days: null }, "2026-09-17T08:00:00Z", AHORA)).toBe(false);
  });

  it("con cero días se libera EL DÍA de la salida, no cuando ya arrancó", () => {
    // Medirlo en horas haría que con `release_days: 0` las plazas se liberaran
    // después de que el autobús saliera, que es cuando ya no sirven.
    expect(shouldRelease({ ...GARANTIZADO, release_days: 0 }, "2026-09-16T06:00:00Z", AHORA)).toBe(true);
    expect(shouldRelease({ ...GARANTIZADO, release_days: 0 }, "2026-09-16T20:00:00Z", AHORA)).toBe(true);
    expect(shouldRelease({ ...GARANTIZADO, release_days: 0 }, "2026-09-17T08:00:00Z", AHORA)).toBe(false);
  });

  it("la cuenta es por días de calendario: una salida a las 06:00 de dentro de 3 días ya entra", () => {
    // Con horas, 3 días menos 6 horas «no llega» a 3 días y no liberaría.
    expect(shouldRelease(GARANTIZADO, "2026-09-19T06:00:00Z", AHORA)).toBe(true);
    expect(shouldRelease(GARANTIZADO, "2026-09-20T06:00:00Z", AHORA)).toBe(false);
  });

  it("un cupo de venta libre no libera nada: no apartaba nada", () => {
    expect(shouldRelease({ ...GARANTIZADO, allotment_type: "free_sale" }, "2026-09-17T08:00:00Z", AHORA)).toBe(false);
  });

  it("libera lo NO vendido, nunca lo vendido", () => {
    expect(releasableSeats(GARANTIZADO)).toBe(7); // 10 − 3 vendidas
  });

  it("no libera dos veces lo ya liberado", () => {
    expect(releasableSeats({ ...GARANTIZADO, seats_released: 7 })).toBe(0);
  });

  it("un cupo agotado no tiene nada que liberar", () => {
    expect(releasableSeats({ ...GARANTIZADO, seats_used: 10 })).toBe(0);
  });
});

describe("la matriz del comercial", () => {
  it("responde «qué le queda a esta agencia» día a día", () => {
    const celdas = allotmentMatrix(
      [{ ...GARANTIZADO, valid_from: "2026-09-16", valid_to: "2026-09-17" }],
      "p1",
      ["2026-09-16", "2026-09-17", "2026-09-18"],
      "prod1"
    );
    expect(celdas[0].remaining).toBe(7);
    expect(celdas[1].remaining).toBe(7);
    // Fuera de temporada no hay cupo, y se ve como venta libre sin tope.
    expect(celdas[2].allotmentId).toBeNull();
    expect(celdas[2].remaining).toBe(-1);
  });
});
