import { describe, it, expect } from "vitest";
import {
  COMMISSION_STATES, ADJUSTMENT_REASONS, ADJUSTMENT_REASON_LABEL, isAdjustmentReason,
  MONEY_IS_OUT, VOIDABLE, adjustmentTotal, netCommission, cancellationEffect,
  canTransition, transitionBlocker, adjustmentBlocker,
} from "@/lib/commission-adjustments";

/**
 * Lo que se prueba aquí es el agujero que 0059 tapa: una comisión YA PAGADA
 * cuya venta se cae. Antes no pasaba nada —ni se anulaba ni se ajustaba— y la
 * liquidación del mes siguiente cuadraba con una venta que ya no existe.
 */

describe("el vocabulario", () => {
  it("los siete estados y los seis motivos, con su etiqueta", () => {
    expect(COMMISSION_STATES).toHaveLength(7);
    expect(ADJUSTMENT_REASONS).toHaveLength(6);
    for (const r of ADJUSTMENT_REASONS) expect(ADJUSTMENT_REASON_LABEL[r]).toBeTruthy();
    expect(isAdjustmentReason("clawback")).toBe(true);
    expect(isAdjustmentReason("porque_si")).toBe(false);
  });

  it("los estados en los que el dinero ya salió son exactamente dos", () => {
    // Esta lista decide si una cancelación anula o ajusta. Meter aquí un estado
    // de más haría que una comisión pendiente se «corrigiera» con un ajuste
    // negativo sobre dinero que nunca salió.
    expect([...MONEY_IS_OUT].sort()).toEqual(["paid", "settled"]);
    expect([...VOIDABLE].sort()).toEqual(["approved", "disputed", "held", "pending"]);
  });
});

describe("el neto", () => {
  it("sin ajustes, el neto es el importe", () => {
    expect(netCommission(30, [])).toBe(30);
    expect(netCommission(30, null)).toBe(30);
  });

  it("los ajustes suman con su signo", () => {
    expect(adjustmentTotal([{ amount: -10 }, { amount: 4 }])).toBe(-6);
    expect(netCommission(30, [{ amount: -10 }, { amount: 4 }])).toBe(24);
  });

  it("nunca baja de cero: una comisión no se vuelve una deuda del vendedor", () => {
    // Un neto negativo lo sumaría la pantalla de liquidaciones como si fuera
    // cobrable, y no lo es: lo pagado de más se persigue por otra vía.
    expect(netCommission(30, [{ amount: -100 }])).toBe(0);
  });

  it("un ajuste ilegible cuenta como cero y no rompe la suma", () => {
    expect(adjustmentTotal([{ amount: null }, { amount: undefined }, { amount: 5 }])).toBe(5);
  });
});

describe("qué pasa cuando se cae la venta", () => {
  it("si nada se ha cobrado, la comisión se anula", () => {
    const efecto = cancellationEffect({ status: "pending", amount: 30 }, [], "BK-1");
    expect(efecto.action).toBe("void");
  });

  it("si YA SE PAGÓ, no se anula: se ajusta en negativo por su neto vivo", () => {
    // Bajar el importe a cero dejaría el histórico diciendo que siempre fue
    // cero. El ajuste deja las dos cifras a la vista.
    const efecto = cancellationEffect({ status: "paid", amount: 30 }, [], "BK-1");
    expect(efecto.action).toBe("adjust");
    expect(efecto.amount).toBe(-30);
    expect(efecto.reason).toBe("Reserva BK-1 cancelada");
    expect(efecto.reasonCode).toBe("cancellation");
  });

  it("una comisión liquidada va por el mismo camino que una pagada", () => {
    expect(cancellationEffect({ status: "settled", amount: 50 }, [], "BK-2").action).toBe("adjust");
  });

  it("el ajuste descuenta el neto VIVO, no el importe original", () => {
    // Si ya se le había descontado la mitad por un reembolso parcial, volver a
    // descontar el importe entero le quitaría el doble.
    const efecto = cancellationEffect({ status: "paid", amount: 30 }, [{ amount: -12 }], "BK-3");
    expect(efecto.amount).toBe(-18);
  });

  it("cancelar dos veces no descuenta dos veces", () => {
    // Es el error clásico de un reintento del cron: el segundo pase encuentra
    // el neto ya en cero y no hace nada.
    const efecto = cancellationEffect({ status: "paid", amount: 30 }, [{ amount: -30 }], "BK-4");
    expect(efecto.action).toBe("none");
    expect(efecto.amount).toBe(0);
  });

  it("una comisión ya anulada no se toca", () => {
    expect(cancellationEffect({ status: "cancelled", amount: 30 }, [], "BK-5").action).toBe("none");
  });

  it("una comisión retenida o en disputa se anula, no se ajusta", () => {
    expect(cancellationEffect({ status: "held", amount: 30 }, [], "BK-6").action).toBe("void");
    expect(cancellationEffect({ status: "disputed", amount: 30 }, [], "BK-7").action).toBe("void");
  });

  it("sin estado declarado se trata como pendiente, no como pagada", () => {
    // Suponer que está pagada generaría un ajuste negativo sobre dinero que
    // nunca salió.
    expect(cancellationEffect({ amount: 30 }, [], "BK-8").action).toBe("void");
  });
});

describe("la máquina de estados", () => {
  it("el camino normal se puede recorrer entero", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("approved", "settled")).toBe(true);
    expect(canTransition("settled", "paid")).toBe(true);
  });

  it("pagada es terminal: de ahí no se sale", () => {
    for (const to of COMMISSION_STATES) expect(canTransition("paid", to)).toBe(false);
  });

  it("y el motivo lo dice en palabras, no con un «no permitido»", () => {
    // Un rechazo sin explicación hace que la persona lo intente por otro camino
    // —el editor de SQL, normalmente— y ahí ya no hay quien lo pare.
    expect(transitionBlocker("paid", "cancelled")).toContain("se hace con un ajuste");
    expect(transitionBlocker("settled", "cancelled")).toContain("dentro de una liquidación");
    expect(transitionBlocker("cancelled", "paid")).toContain("está anulada");
    expect(transitionBlocker("pending", "pending")).toContain("Ya está en ese estado");
  });

  it("no se salta la liquidación para pagar", () => {
    expect(canTransition("approved", "paid")).toBe(false);
    expect(canTransition("pending", "paid")).toBe(false);
  });

  it("una transición válida no da motivo", () => {
    expect(transitionBlocker("pending", "approved")).toBeNull();
  });
});

describe("un ajuste pedido a mano", () => {
  it("cero no ajusta nada", () => {
    expect(adjustmentBlocker({ amount: 0, reason: "porque sí" })).toContain("no ajusta nada");
    expect(adjustmentBlocker({ amount: "hola", reason: "porque sí" })).toContain("no ajusta nada");
  });

  it("sin motivo no se guarda", () => {
    // Dentro de un mes, un movimiento sin motivo es un descuadre que nadie sabe
    // explicar.
    expect(adjustmentBlocker({ amount: -10, reason: "" })).toContain("Escribe el motivo");
    expect(adjustmentBlocker({ amount: -10, reason: "  x " })).toContain("Escribe el motivo");
  });

  it("sobre una comisión anulada no hay nada que ajustar", () => {
    expect(adjustmentBlocker({ amount: -10, reason: "corrección", status: "cancelled" }))
      .toContain("está anulada");
  });

  it("un ajuste bien puesto pasa, suba o baje", () => {
    expect(adjustmentBlocker({ amount: -10, reason: "Se cayó el grupo", status: "paid" })).toBeNull();
    expect(adjustmentBlocker({ amount: 25, reason: "Premio pactado", status: "approved" })).toBeNull();
  });
});
