import { describe, it, expect } from "vitest";
import {
  saldoDe, puedeGastar, movimientoInvalido, modoDePago, esPrepago,
  SIGNO_DEL_MOVIMIENTO, TIPOS_DE_MOVIMIENTO,
} from "@/lib/monedero-socio";

describe("el saldo se suma, no se guarda", () => {
  it("recargas suman, ventas restan", () => {
    expect(saldoDe([
      { movement_type: "topup", amount: 1000, currency: "usd" },
      { movement_type: "consumption", amount: 240, currency: "usd" },
      { movement_type: "consumption", amount: 160, currency: "usd" },
    ])).toBe(600);
  });

  it("una cancelación devuelve lo que aquella venta gastó", () => {
    expect(saldoDe([
      { movement_type: "topup", amount: 500 },
      { movement_type: "consumption", amount: 200 },
      { movement_type: "refund", amount: 200 },
    ])).toBe(500);
  });

  it("un ajuste resta, y solo resta", () => {
    /**
     * Un ajuste que SUMA es una recarga, y tiene que entrar por la puerta de
     * las recargas, donde queda el número de la transferencia. Un ajuste
     * positivo sería la forma de regalarle saldo a un socio sin que se vea de
     * dónde salió.
     */
    expect(SIGNO_DEL_MOVIMIENTO.adjustment).toBe(-1);
    expect(saldoDe([{ movement_type: "topup", amount: 100 }, { movement_type: "adjustment", amount: 30 }])).toBe(70);
  });

  it("EL SIGNO ES DEL TIPO, NUNCA DEL NÚMERO", () => {
    /**
     * Con importes con signo, una recarga de −500 vacía el monedero sin que
     * nada parezca raro: en el listado se lee como una recarga. Aquí el valor
     * absoluto lo hace imposible incluso si la fila llega mal escrita.
     */
    expect(saldoDe([{ movement_type: "topup", amount: -500 }])).toBe(500);
    expect(saldoDe([{ movement_type: "consumption", amount: -40 }])).toBe(-40);
  });

  it("un tipo desconocido no cuenta, ni sumando ni restando", () => {
    /**
     * Si alguien añade un tipo a la base sin añadirlo aquí, contarlo como suma
     * le regala saldo al socio y contarlo como resta se lo quita. Dejarlo fuera
     * hace que el descuadre se vea comparando con el listado, que es lo único
     * que se puede arreglar.
     */
    expect(saldoDe([
      { movement_type: "topup", amount: 100 },
      { movement_type: "regalo", amount: 9999 },
    ])).toBe(100);
  });

  it("sin movimientos el saldo es cero, y eso sí es cero", () => {
    // A diferencia del cupo: aquí «no hay movimientos» significa literalmente
    // que no ha entrado dinero, que es un saldo de cero y no un desconocido.
    expect(saldoDe([])).toBe(0);
    expect(saldoDe(null)).toBe(0);
  });

  it("los céntimos no se van acumulando", () => {
    const movs = Array.from({ length: 3 }, () => ({ movement_type: "consumption", amount: 0.1 }));
    expect(saldoDe([{ movement_type: "topup", amount: 1 }, ...movs])).toBe(0.7);
  });
});

describe("si le llega el saldo", () => {
  it("le llega justo", () => {
    expect(puedeGastar(300, 300).allowed).toBe(true);
    expect(puedeGastar(300, 300).despues).toBe(0);
  });

  it("NO HAY DESCUBIERTO", () => {
    /**
     * Dejar pasar «solo esta» es cómo un depósito se convierte en un crédito
     * que nadie pactó. Quien quiera vender a deber tiene el otro modo.
     */
    const v = puedeGastar(300, 300.5);
    expect(v.allowed).toBe(false);
    // Y dice cuánto le falta, que es lo que el socio necesita para transferir.
    expect(v.reason).toContain("Te faltan 0.5");
    expect(v.despues).toBe(-0.5);
  });

  it("el céntimo de tolerancia, igual que en el crédito", () => {
    // Los redondeos de una venta con varias líneas no pueden tumbarla por
    // cuatro milésimas.
    expect(puedeGastar(300, 300.004).allowed).toBe(true);
    expect(puedeGastar(300, 300.02).allowed).toBe(false);
  });

  it("con saldo negativo no se vende nada", () => {
    // Puede pasar: un ajuste posterior a una venta ya consumida.
    expect(puedeGastar(-20, 1).allowed).toBe(false);
  });
});

describe("qué movimiento se puede escribir", () => {
  it("LA MONEDA TIENE QUE SER LA DEL MONEDERO", () => {
    /**
     * Un monedero en dólares al que se le apunta una recarga en pesos suma
     * 30.000 a un saldo de dólares: el socio cree que tiene treinta mil y la
     * operadora descubre el agujero liquidando. No se convierte — eso sería
     * inventarse un tipo de cambio que nadie pactó y enterrarlo en una fila.
     */
    expect(movimientoInvalido({ movement_type: "topup", amount: 100, currency: "dop" }, "usd"))
      .toContain("USD");
    expect(movimientoInvalido({ movement_type: "topup", amount: 100, currency: "USD" }, "usd")).toBeNull();
  });

  it("cero no es un movimiento y negativo es la puerta de atrás", () => {
    expect(movimientoInvalido({ movement_type: "topup", amount: 0, currency: "usd" }, "usd"))
      .toContain("mayor que cero");
    expect(movimientoInvalido({ movement_type: "topup", amount: -100, currency: "usd" }, "usd"))
      .toContain("mayor que cero");
  });

  it("un tipo que no existe no se escribe", () => {
    expect(movimientoInvalido({ movement_type: "regalo", amount: 100, currency: "usd" }, "usd"))
      .toContain("desconocido");
  });

  it("sin moneda declarada no se escribe nada", () => {
    // Ni la del movimiento ni la del monedero: adivinarla es el mismo fallo
    // con otro nombre.
    expect(movimientoInvalido({ movement_type: "topup", amount: 100 }, "usd")).toContain("moneda");
    expect(movimientoInvalido({ movement_type: "topup", amount: 100, currency: "usd" }, "")).toContain("moneda");
  });

  it("los cuatro tipos declarados se aceptan", () => {
    for (const tipo of TIPOS_DE_MOVIMIENTO) {
      expect(movimientoInvalido({ movement_type: tipo, amount: 1, currency: "usd" }, "usd"), tipo).toBeNull();
    }
  });
});

describe("cómo paga el socio", () => {
  it("LO DESCONOCIDO ES CRÉDITO", () => {
    /**
     * Es lo que hace hoy el sistema con todos los socios. Entender el hueco
     * como prepago les cortaría la venta a todos de golpe el día del
     * despliegue, con saldo cero — que es como nacerían todos los monederos.
     */
    expect(modoDePago(null)).toBe("credit");
    expect(modoDePago({})).toBe("credit");
    expect(modoDePago({ payment_mode: null })).toBe("credit");
    expect(modoDePago({ payment_mode: "cualquier_cosa" })).toBe("credit");
    expect(esPrepago(null)).toBe(false);
  });

  it("y prepago solo cuando lo dice", () => {
    expect(modoDePago({ payment_mode: "prepaid" })).toBe("prepaid");
    expect(esPrepago({ payment_mode: "prepaid" })).toBe(true);
  });
});
