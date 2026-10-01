import { describe, it, expect } from "vitest";
import {
  applyIssue, applyRedemption, applyRefund, giftCardBalance, giftCardBlocker,
  planDePagoConTarjeta, validateAmount, CLOSED_GIFT_CARD_STATUSES, GIFT_CARD_BLOCK_MESSAGE,
} from "@/lib/gift-cards";

const NOW = new Date("2026-06-15T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const ahead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe("gift cards — qué bloquea el consumo", () => {
  it("una tarjeta activa con saldo y vigente no bloquea", () => {
    expect(giftCardBlocker({ status: "active", balance: 50, expires_at: ahead(30) }, NOW)).toBeNull();
  });

  it("sin vencimiento declarado tampoco", () => {
    expect(giftCardBlocker({ status: "partially_used", balance: 10 }, NOW)).toBeNull();
  });

  it.each([...CLOSED_GIFT_CARD_STATUSES])("%s está cerrada", (status) => {
    expect(giftCardBlocker({ status, balance: 100 }, NOW)).toBe("closed");
  });

  it("el estado cerrado manda sobre el vencimiento y el saldo", () => {
    // Decir "está vencida" mandaría al cajero a pedir una prórroga que no
    // arreglaría nada: la tarjeta está anulada.
    expect(giftCardBlocker({ status: "void", balance: 0, expires_at: ago(10) }, NOW)).toBe("closed");
  });

  it("una tarjeta vencida se rechaza aunque el estado siga activo", () => {
    // `status` es un campo almacenado que se queda obsoleto solo.
    expect(giftCardBlocker({ status: "active", balance: 50, expires_at: ago(1) }, NOW)).toBe("expired");
  });

  it("sin saldo no hay nada que consumir", () => {
    expect(giftCardBlocker({ status: "active", balance: 0 }, NOW)).toBe("empty");
    expect(giftCardBlocker({ status: "active", balance: null }, NOW)).toBe("empty");
  });

  it("cada bloqueo tiene un mensaje para el cajero", () => {
    for (const block of ["closed", "empty", "expired"] as const) {
      expect(GIFT_CARD_BLOCK_MESSAGE[block]).toBeTruthy();
    }
  });
});

describe("gift cards — importe del movimiento", () => {
  it("acepta un importe positivo y lo redondea a centavos", () => {
    expect(validateAmount("25.456")).toEqual({ amount: 25.46 });
  });

  it("rechaza cero, negativos y lo que no es número", () => {
    expect(validateAmount(0)).toHaveProperty("error");
    expect(validateAmount(-5)).toHaveProperty("error");
    expect(validateAmount("hola")).toHaveProperty("error");
    expect(validateAmount(undefined)).toHaveProperty("error");
  });
});

describe("gift cards — consumo", () => {
  it("un consumo parcial deja la tarjeta parcialmente usada", () => {
    expect(applyRedemption({ status: "active", balance: 100 }, 30)).toEqual({
      amount: 30, balance_after: 70, status: "partially_used", movement_type: "redeem",
    });
  });

  it("consumir el saldo exacto la deja redimida", () => {
    expect(applyRedemption({ status: "partially_used", balance: 70 }, 70)).toEqual({
      amount: 70, balance_after: 0, status: "redeemed", movement_type: "redeem",
    });
  });

  it("pedir más de lo que queda se rechaza, no se recorta", () => {
    // Recortar en silencio dejaría la orden cobrada de menos sin que nadie lo
    // note: es justo el error que esta acción viene a cerrar.
    const out = applyRedemption({ status: "active", balance: 40 }, 50);
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("40.00");
  });

  it("los centavos no se desvían al encadenar consumos", () => {
    let balance = 100;
    for (const amount of [33.33, 33.33, 33.34]) {
      const plan = applyRedemption({ status: "active", balance }, amount) as { balance_after: number };
      balance = plan.balance_after;
    }
    expect(balance).toBe(0);
  });
});

describe("gift cards — devolución", () => {
  it("devolver saldo la reabre como parcialmente usada", () => {
    expect(applyRefund({ status: "redeemed", balance: 0, initial_amount: 100 }, 40)).toEqual({
      amount: -40, balance_after: 40, status: "partially_used", movement_type: "refund",
    });
  });

  it("no puede dejar un saldo por encima de lo emitido", () => {
    // Si no, la tarjeta se convierte en una fuente de dinero.
    const out = applyRefund({ status: "partially_used", balance: 80, initial_amount: 100 }, 50);
    expect(out).toHaveProperty("error");
  });

  it("devolver justo hasta lo emitido sí se permite", () => {
    expect(applyRefund({ status: "partially_used", balance: 80, initial_amount: 100 }, 20))
      .toMatchObject({ balance_after: 100 });
  });
});

describe("gift cards — emisión", () => {
  it("el saldo nace igual a lo emitido", () => {
    expect(applyIssue(500)).toEqual({
      amount: 500, balance_after: 500, status: "active", movement_type: "issue",
    });
  });

  it("una tarjeta recién emitida se puede consumir", () => {
    const issued = applyIssue(500);
    expect(giftCardBlocker({ status: issued.status, balance: issued.balance_after }, NOW)).toBeNull();
  });
});

describe("gift cards — saldo", () => {
  it("un saldo ausente es cero, no NaN", () => {
    expect(giftCardBalance({})).toBe(0);
    expect(giftCardBalance({ balance: null })).toBe(0);
  });
});

/**
 * EL PLAN DE PAGO: la única definición de «¿puede esta tarjeta pagar esto?».
 *
 * La comparten `/api/payments`, la acción del cajón y el punto de venta. Lo que
 * se prueba aquí es lo que el mostrador va a ofrecer y lo que el servidor va a
 * aceptar, que tienen que ser la misma cosa.
 */
describe("gift cards — plan de pago con tarjeta", () => {
  const vale = { status: "active", balance: 100, currency: "dop", expires_at: ahead(30) };

  it("una tarjeta buena con importe dentro del saldo devuelve el plan", () => {
    const r = planDePagoConTarjeta(vale, 40, "dop", NOW);
    expect("plan" in r).toBe(true);
    if (!("plan" in r)) return;
    expect(r.plan.amount).toBe(40);
    expect(r.plan.balance_after).toBe(60);
    expect(r.plan.status).toBe("partially_used");
    expect(r.plan.movement_type).toBe("redeem");
  });

  it("un importe mal escrito es culpa de quien llama: 400", () => {
    for (const malo of [0, -5, "hola", null, undefined]) {
      const r = planDePagoConTarjeta(vale, malo, "dop", NOW);
      expect("error" in r).toBe(true);
      if ("error" in r) expect(r.status).toBe(400);
    }
  });

  it("una tarjeta que no se puede consumir es un estado del mundo: 409", () => {
    for (const card of [
      { ...vale, status: "void" },
      { ...vale, expires_at: ago(1) },
      { ...vale, balance: 0 },
    ]) {
      const r = planDePagoConTarjeta(card, 10, "dop", NOW);
      expect("error" in r).toBe(true);
      if ("error" in r) expect(r.status).toBe(409);
    }
  });

  it("el importe se comprueba ANTES del estado de la tarjeta", () => {
    // Si el orden se invirtiera, un importe de cero sobre una tarjeta anulada
    // contestaría 409 y quien llama creería que el problema es la tarjeta.
    const r = planDePagoConTarjeta({ ...vale, status: "void" }, 0, "dop", NOW);
    expect("error" in r && r.status).toBe(400);
  });

  it("la moneda no se convierte: tarjeta y cobro tienen que coincidir", () => {
    const r = planDePagoConTarjeta(vale, 40, "usd", NOW);
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.status).toBe(409);
    // El mensaje nombra LAS DOS monedas: con una sola no se sabe qué cambiar.
    expect(r.error).toContain("DOP");
    expect(r.error).toContain("USD");
  });

  it("sin moneda declarada en la tarjeta no se inventa un desajuste", () => {
    const r = planDePagoConTarjeta({ ...vale, currency: null }, 40, "usd", NOW);
    expect("plan" in r).toBe(true);
  });

  it("pedir más saldo del que hay se rechaza con 409, no se recorta", () => {
    const r = planDePagoConTarjeta(vale, 140, "dop", NOW);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.status).toBe(409);
      // El mensaje dice CUÁNTO hay: sin eso el cajero prueba importes a ciegas.
      expect(r.error).toContain("100.00");
    }
  });

  it("consumir el saldo exacto la deja redimida", () => {
    const r = planDePagoConTarjeta(vale, 100, "dop", NOW);
    expect("plan" in r && r.plan.status).toBe("redeemed");
    expect("plan" in r && r.plan.balance_after).toBe(0);
  });
});

describe("gift cards — la vigencia del plan de pago se mide contra un instante dado", () => {
  const card = { status: "active", balance: 100, currency: "dop", expires_at: NOW.toISOString() };

  it("un día antes de vencer, la tarjeta paga", () => {
    const r = planDePagoConTarjeta(card, 10, "dop", new Date(NOW.getTime() - 86_400_000));
    expect("plan" in r).toBe(true);
  });

  it("un día después, no", () => {
    const r = planDePagoConTarjeta(card, 10, "dop", new Date(NOW.getTime() + 86_400_000));
    expect("error" in r && r.status).toBe(409);
    expect("error" in r && r.error).toBe(GIFT_CARD_BLOCK_MESSAGE.expired);
  });
});
