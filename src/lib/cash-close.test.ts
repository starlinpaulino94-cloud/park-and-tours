import { describe, it, expect } from "vitest";
import {
  DENOMINATIONS, denominationsFor, isCoin, countTotal, invalidDenominations,
  movementDelta, summarizeCash, differenceOf, classifyDifference, needsApproval,
} from "@/lib/cash-close";

describe("denominaciones", () => {
  it("las del peso dominicano bajan de 2000 a 1", () => {
    expect(denominationsFor("dop")[0]).toBe(2000);
    expect(denominationsFor("dop").at(-1)).toBe(1);
  });

  it("cada moneda las declara de mayor a menor y sin repetir", () => {
    for (const [currency, values] of Object.entries(DENOMINATIONS)) {
      expect(new Set(values).size, `${currency} repite denominaciones`).toBe(values.length);
      const sorted = [...values].sort((a, b) => b - a);
      expect(values, `${currency} no está ordenada`).toEqual(sorted);
      expect(values.every((v) => v > 0), `${currency} tiene una denominación no positiva`).toBe(true);
    }
  });

  it("una moneda desconocida no rompe el conteo", () => {
    expect(denominationsFor(null)).toEqual(DENOMINATIONS.usd);
    expect(denominationsFor("xxx")).toEqual(DENOMINATIONS.usd);
  });

  it("separa billete de moneda en cada divisa", () => {
    expect(isCoin("dop", 25)).toBe(true);
    expect(isCoin("dop", 50)).toBe(false);
    expect(isCoin("usd", 0.25)).toBe(true);
    expect(isCoin("usd", 1)).toBe(false);
  });
});

describe("el conteo físico", () => {
  it("suma el desglose", () => {
    expect(countTotal([
      { denomination: 2000, quantity: 3 },
      { denomination: 500, quantity: 2 },
      { denomination: 25, quantity: 4 },
    ])).toBe(7100);
  });

  it("cuenta monedas pequeñas sin irse del céntimo", () => {
    // 300 × 0.05 en coma flotante da 15.000000000000009.
    expect(countTotal([{ denomination: 0.05, quantity: 300 }])).toBe(15);
    expect(countTotal([{ denomination: 0.01, quantity: 777 }])).toBe(7.77);
  });

  it("ignora cantidades vacías, negativas o fraccionarias", () => {
    expect(countTotal([
      { denomination: 100, quantity: 0 },
      { denomination: 100, quantity: -3 },
      { denomination: 100, quantity: 2.7 },
    ])).toBe(200);
  });

  it("no cuenta nada cuando no hay conteo", () => {
    expect(countTotal(null)).toBe(0);
    expect(countTotal([])).toBe(0);
  });

  it("delata una denominación que no existe en esa moneda", () => {
    expect(invalidDenominations([
      { denomination: 2000, quantity: 1 },
      { denomination: 250, quantity: 1 },
    ], "dop")).toEqual([250]);
  });

  it("no delata las que sí existen", () => {
    expect(invalidDenominations(
      DENOMINATIONS.dop.map((d) => ({ denomination: d, quantity: 1 })), "dop"
    )).toEqual([]);
  });

  it("una denominación errónea con cantidad cero no bloquea el cierre", () => {
    expect(invalidDenominations([{ denomination: 250, quantity: 0 }], "dop")).toEqual([]);
  });
});

describe("el signo de cada movimiento", () => {
  it("el fondo de apertura y el cierre no mueven el efectivo del turno", () => {
    expect(movementDelta({ movement_type: "opening", amount: 5000 })).toBe(0);
    expect(movementDelta({ movement_type: "closing", amount: 5000 })).toBe(0);
  });

  it("gastos y retiros restan aunque lleguen en positivo", () => {
    expect(movementDelta({ movement_type: "expense", amount: 300 })).toBe(-300);
    expect(movementDelta({ movement_type: "withdrawal", amount: 1000 })).toBe(-1000);
  });

  it("un reembolso resta aunque venga sin signo", () => {
    expect(movementDelta({ movement_type: "refund", amount: 250 })).toBe(-250);
    expect(movementDelta({ movement_type: "refund", amount: -250 })).toBe(-250);
  });

  it("el ajuste conserva su signo", () => {
    expect(movementDelta({ movement_type: "adjustment", amount: -40 })).toBe(-40);
    expect(movementDelta({ movement_type: "adjustment", amount: 40 })).toBe(40);
  });

  it("un tipo desconocido no mueve nada", () => {
    expect(movementDelta({ movement_type: "loquesea", amount: 999 })).toBe(0);
  });
});

describe("el resumen del turno", () => {
  it("no mezcla monedas", () => {
    const rows = summarizeCash(
      [
        { movement_type: "opening", amount: 5000, currency: "dop" },
        { movement_type: "sale", amount: 3000, currency: "dop" },
        { movement_type: "sale", amount: 100, currency: "usd" },
      ],
      [],
    );
    expect(rows.map((r) => r.currency)).toEqual(["dop", "usd"]);
    expect(rows.find((r) => r.currency === "dop")!.expected).toBe(8000);
    expect(rows.find((r) => r.currency === "usd")!.expected).toBe(100);
  });

  it("la tarjeta no llega al cajón", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "opening", amount: 1000, currency: "dop" },
        { movement_type: "sale", amount: 2000, currency: "dop" },
        { movement_type: "sale", amount: 5000, currency: "dop" },
      ],
      [
        { method: "cash", amount: 2000, currency: "dop" },
        { method: "card", amount: 5000, currency: "dop" },
      ],
    );
    expect(row.card).toBe(5000);
    expect(row.expected).toBe(3000); // 1000 de fondo + 2000 en efectivo
  });

  it("transferencia, link, cheque y crédito tampoco", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "sale", amount: 100, currency: "usd" },
        { movement_type: "sale", amount: 200, currency: "usd" },
        { movement_type: "sale", amount: 300, currency: "usd" },
        { movement_type: "sale", amount: 400, currency: "usd" },
      ],
      [
        { method: "transfer", amount: 100, currency: "usd" },
        { method: "link", amount: 200, currency: "usd" },
        { method: "check", amount: 300, currency: "usd" },
        { method: "credit", amount: 400, currency: "usd" },
      ],
    );
    expect(row.transfer).toBe(300);      // transferencia + link
    expect(row.other_methods).toBe(700); // cheque + crédito
    expect(row.expected).toBe(0);
  });

  it("un reembolso con tarjeta no descuadra el cajón", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "opening", amount: 1000, currency: "dop" },
        { movement_type: "refund", amount: -500, currency: "dop" },
      ],
      [{ method: "card", amount: 500, currency: "dop", payment_type: "refund" }],
    );
    expect(row.card).toBe(-500);
    expect(row.expected).toBe(1000);
  });

  it("un reembolso en efectivo sí sale del cajón", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "opening", amount: 1000, currency: "dop" },
        { movement_type: "refund", amount: -500, currency: "dop" },
      ],
      [{ method: "cash", amount: 500, currency: "dop", payment_type: "refund" }],
    );
    expect(row.expected).toBe(500);
  });

  it("gastos y retiros bajan lo esperado", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "opening", amount: 10000, currency: "dop" },
        { movement_type: "expense", amount: 600, currency: "dop" },
        { movement_type: "withdrawal", amount: 5000, currency: "dop" },
        { movement_type: "deposit", amount: 2000, currency: "dop" },
      ],
      [],
    );
    expect(row.expenses).toBe(600);
    expect(row.withdrawals).toBe(5000);
    expect(row.deposits).toBe(2000);
    expect(row.expected).toBe(6400);
  });

  it("una caja abierta sin un solo movimiento aparece con su moneda", () => {
    const rows = summarizeCash([], [], ["dop"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: "dop", expected: 0, opening: 0 });
  });

  it("separa lo cobrado en efectivo de lo cobrado con tarjeta", () => {
    const [row] = summarizeCash(
      [
        { movement_type: "sale", amount: 2000, currency: "dop" },
        { movement_type: "sale", amount: 5000, currency: "dop" },
      ],
      [
        { method: "cash", amount: 2000, currency: "dop" },
        { method: "card", amount: 5000, currency: "dop" },
      ],
    );
    expect(row.sales).toBe(7000);      // todo lo que pasó por la caja
    expect(row.cash_sales).toBe(2000); // solo lo que entró al cajón
  });

  it("un reembolso con tarjeta no cuenta como devolución en efectivo", () => {
    const [row] = summarizeCash(
      [{ movement_type: "refund", amount: -500, currency: "dop" }],
      [{ method: "card", amount: 500, currency: "dop", payment_type: "refund" }],
    );
    expect(row.refunds).toBe(500);
    expect(row.cash_refunds).toBe(0);
  });

  it("lo esperado cuadra con la suma de sus partes", () => {
    const movements = [
      { movement_type: "opening", amount: 3000, currency: "dop" },
      { movement_type: "sale", amount: 4000, currency: "dop" },
      { movement_type: "sale", amount: 9000, currency: "dop" },
      { movement_type: "refund", amount: -700, currency: "dop" },
      { movement_type: "expense", amount: 250, currency: "dop" },
      { movement_type: "withdrawal", amount: 5000, currency: "dop" },
      { movement_type: "deposit", amount: 1200, currency: "dop" },
      { movement_type: "adjustment", amount: -30, currency: "dop" },
    ];
    const payments = [
      { method: "cash", amount: 4000, currency: "dop" },
      { method: "card", amount: 9000, currency: "dop" },
      { method: "cash", amount: 700, currency: "dop", payment_type: "refund" },
    ];
    const [row] = summarizeCash(movements, payments);
    const parts = row.opening + row.cash_sales - row.cash_refunds
      + row.deposits - row.expenses - row.withdrawals + row.adjustments;
    expect(row.expected).toBe(Math.round((parts + Number.EPSILON) * 100) / 100);
    expect(row.expected).toBe(2220);
  });

  it("la moneda se normaliza a minúsculas", () => {
    const rows = summarizeCash([{ movement_type: "sale", amount: 10, currency: "DOP" }], []);
    expect(rows[0].currency).toBe("dop");
  });
});

describe("la diferencia", () => {
  it("positiva sobra, negativa falta", () => {
    expect(differenceOf(1000, 1050)).toBe(50);
    expect(differenceOf(1000, 940)).toBe(-60);
  });

  it("el redondeo no inventa un descuadre", () => {
    expect(differenceOf(0.1 + 0.2, 0.3)).toBe(0);
    expect(classifyDifference(differenceOf(0.1 + 0.2, 0.3))).toBe("balanced");
  });

  it("sin tolerancia, cualquier descuadre se ve", () => {
    expect(classifyDifference(-1)).toBe("short");
    expect(classifyDifference(1)).toBe("over");
    expect(classifyDifference(0)).toBe("balanced");
  });

  it("la tolerancia absorbe el vuelto, no el faltante", () => {
    expect(classifyDifference(-5, 5)).toBe("balanced");
    expect(classifyDifference(-5.5, 5)).toBe("short");
  });

  it("basta un descuadre en una moneda para pedir supervisor", () => {
    expect(needsApproval([0, 0, -200])).toBe(true);
    expect(needsApproval([0, 0, 0])).toBe(false);
    expect(needsApproval([-3, 0], 5)).toBe(false);
  });
});

describe("la comisión que el vendedor se quedó", () => {
  it("UN RETIRO CON COMISIÓN NO ES UN RETIRO A SECAS", () => {
    /**
     * Los dos sacan dinero del cajón, pero el primero es lo que el vendedor se
     * quedó y no tiene que entregar, y el segundo es dinero que salió a otro
     * sitio. Mezclarlos le dice que entregue de más y, al cuadrar, le apunta el
     * descuadre a él.
     */
    const [fila] = summarizeCash(
      [
        { movement_type: "sale", amount: 300, currency: "usd" },
        { movement_type: "withdrawal", amount: 45, currency: "usd", commission_id: "c-1" },
        { movement_type: "withdrawal", amount: 20, currency: "usd" },
      ],
      []
    );
    expect(fila.retained).toBe(45);
    expect(fila.withdrawals, "la comisión no es un retiro más").toBe(20);
  });

  it("pero sale del cajón igual: el esperado no cambia", () => {
    /**
     * Lo que cambia es qué se le enseña al vendedor, no cuánto hay. Si la
     * comisión dejara de restar, el arqueo le pediría el dinero que ya se
     * llevó.
     */
    const [fila] = summarizeCash(
      [
        { movement_type: "sale", amount: 300, currency: "usd" },
        { movement_type: "withdrawal", amount: 45, currency: "usd", commission_id: "c-1" },
      ],
      []
    );
    expect(fila.expected).toBe(255);
  });

  it("sin comisiones retenidas la línea es cero, no falta", () => {
    // Un turno de mostrador normal la trae en cero: es más fácil de leer que
    // una columna que a veces está y a veces no.
    const [fila] = summarizeCash([{ movement_type: "sale", amount: 100, currency: "usd" }], []);
    expect(fila.retained).toBe(0);
  });
});