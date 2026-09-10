import { describe, it, expect } from "vitest";
import {
  applyIssue, applyRedemption, applyRefund, giftCardBalance, giftCardBlocker,
  validateAmount, CLOSED_GIFT_CARD_STATUSES, GIFT_CARD_BLOCK_MESSAGE,
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
