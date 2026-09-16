import { describe, it, expect } from "vitest";
import {
  rescheduleBlocker, reschedulePatch, isForceable, MAX_RESCHEDULES,
  RESCHEDULE_BLOCK_MESSAGE, FORCEABLE_RESCHEDULE_BLOCKS,
} from "@/lib/reschedule";

/**
 * La regla que ordena todo este archivo: lo IMPOSIBLE no lo levanta nadie y lo
 * de POLÍTICA lo levanta un gerente. Confundirlas en cualquiera de los dos
 * sentidos tiene consecuencias concretas: si el plazo fuera inamovible, el
 * cambio se acabaría haciendo por fuera del sistema y el manifiesto del día
 * mentiría; si el cupo se pudiera forzar, el cliente se quedaría en el lobby.
 */

const ahora = new Date("2026-09-16T12:00:00Z");

const reserva = (over: Record<string, unknown> = {}) => ({
  status: "confirmed",
  travel_date: "2026-09-25T08:00:00Z",
  pax_total: 2,
  reschedule_count: 0,
  productId: "prod-1",
  departureId: "dep-1",
  ...over,
});

const destino = (over: Record<string, unknown> = {}) => ({
  id: "dep-2",
  productId: "prod-1",
  departure_at: "2026-09-30T08:00:00Z",
  status: "available",
  availableSeats: 10,
  ...over,
});

describe("cuándo se puede mover", () => {
  it("una reserva confirmada a otra salida del mismo producto, con cupo", () => {
    expect(rescheduleBlocker(reserva(), destino(), ahora)).toBeNull();
  });

  it("una reserva cancelada o reembolsada ya no tiene plaza que mover", () => {
    for (const status of ["cancelled", "refunded", "no_show"]) {
      expect(rescheduleBlocker(reserva({ status }), destino(), ahora)).toBe("cancelled");
    }
  });

  it("una que ya hizo check-in no se reprograma: se tomó", () => {
    expect(rescheduleBlocker(reserva({ status: "checked_in" }), destino(), ahora)).toBe("checked_in");
    expect(rescheduleBlocker(reserva({ checkin_status: "checked_in" }), destino(), ahora)).toBe("checked_in");
  });

  it("otra fecha del mismo producto, no otro producto", () => {
    // Mover una reserva de Saona a Hoyo Azul no es un cambio de fecha: es otra
    // venta, con otro precio y otra comisión.
    expect(rescheduleBlocker(reserva(), destino({ productId: "prod-2" }), ahora)).toBe("different_product");
  });

  it("a la misma salida no es un cambio", () => {
    expect(rescheduleBlocker(reserva(), destino({ id: "dep-1" }), ahora)).toBe("same_departure");
  });

  it("no se mueve al pasado", () => {
    expect(rescheduleBlocker(reserva(), destino({ departure_at: "2026-09-01T08:00:00Z" }), ahora)).toBe("past_target");
    expect(rescheduleBlocker(reserva(), destino({ departure_at: null }), ahora)).toBe("past_target");
  });

  it("no se mueve a una salida cerrada o cancelada", () => {
    for (const status of ["closed", "cancelled", "departed"]) {
      expect(rescheduleBlocker(reserva(), destino({ status }), ahora)).toBe("target_closed");
    }
  });

  it("no se mueve sin cupo: eso es dejar al cliente en el lobby", () => {
    expect(rescheduleBlocker(reserva({ pax_total: 4 }), destino({ availableSeats: 3 }), ahora)).toBe("no_capacity");
    // Justo el que cabe, cabe.
    expect(rescheduleBlocker(reserva({ pax_total: 3 }), destino({ availableSeats: 3 }), ahora)).toBeNull();
  });

  it("una salida sin cupo declarado no bloquea nada", () => {
    // `null` es «sin techo», no «cero»: es la misma regla que los límites del
    // plan, y tratarlo como cero impediría mover cualquier reserva de un
    // producto que no lleva control de plazas.
    expect(rescheduleBlocker(reserva(), destino({ availableSeats: null }), ahora)).toBeNull();
  });

  it("la reserva cuya fecha ya pasó no se mueve, se vende de nuevo", () => {
    expect(rescheduleBlocker(reserva({ travel_date: "2026-09-10T08:00:00Z" }), destino(), ahora))
      .toBe("already_travelled");
  });
});

describe("los bloqueos de política", () => {
  it("dentro del plazo de cambios avisa, y se puede levantar", () => {
    // Sale mañana y el plazo es de 48 horas.
    const block = rescheduleBlocker(reserva({ travel_date: "2026-09-17T08:00:00Z" }), destino(), ahora, 48);
    expect(block).toBe("cutoff");
    expect(isForceable(block!)).toBe(true);
  });

  it("con el plazo cumplido no hay bloqueo", () => {
    expect(rescheduleBlocker(reserva(), destino(), ahora, 48)).toBeNull();
  });

  it("al máximo de cambios se pide una decisión", () => {
    const block = rescheduleBlocker(reserva({ reschedule_count: MAX_RESCHEDULES }), destino(), ahora);
    expect(block).toBe("too_many");
    expect(isForceable(block!)).toBe(true);
  });

  it("lo imposible NO se puede forzar", () => {
    // Es la mitad que protege al cliente: ningún rol convierte una sobreventa
    // en una reprogramación válida.
    for (const block of ["no_capacity", "different_product", "past_target", "cancelled", "checked_in"] as const) {
      expect(isForceable(block), block).toBe(false);
    }
    expect(FORCEABLE_RESCHEDULE_BLOCKS).toEqual(["cutoff", "too_many"]);
  });

  it("cada bloqueo dice qué hacer, no solo que no se puede", () => {
    for (const [block, message] of Object.entries(RESCHEDULE_BLOCK_MESSAGE)) {
      expect(message.length, block).toBeGreaterThan(20);
      expect(message, block).toMatch(/\.$/);
    }
  });

  it("lo imposible se comprueba antes que lo de política", () => {
    // Decirle «pasó el plazo» a quien eligió el producto equivocado lo manda a
    // pedir permiso para algo que de todas formas no se puede hacer.
    const block = rescheduleBlocker(
      reserva({ travel_date: "2026-09-17T08:00:00Z", reschedule_count: 9 }),
      destino({ productId: "otro" }),
      ahora, 48
    );
    expect(block).toBe("different_product");
  });
});

describe("lo que se escribe al mover", () => {
  it("guarda de dónde viene, cuándo y por qué, y cuenta la vez", () => {
    const patch = reschedulePatch(reserva({ reschedule_count: 1 }), destino(), "  Lluvia  ", ahora);
    expect(patch.departure).toBe("dep-2");
    expect(patch.travel_date).toBe("2026-09-30T08:00:00Z");
    expect(patch.previous_departure).toBe("dep-1");
    expect(patch.reschedule_reason).toBe("Lluvia");
    expect(patch.reschedule_count).toBe(2);
    expect(patch.rescheduled_at).toBe(ahora.toISOString());
  });

  it("NO toca el número de reserva ni el voucher", () => {
    /**
     * El cliente tiene ese papel en la mano. El documento se imprime con la
     * fecha nueva, así que cambiarle el código solo conseguiría que el voucher
     * que ya tiene deje de servir en la puerta.
     */
    const patch = reschedulePatch(reserva(), destino(), "Cambio de hotel", ahora);
    expect(patch.booking_number).toBeUndefined();
    expect(patch.voucher_code).toBeUndefined();
  });
});
