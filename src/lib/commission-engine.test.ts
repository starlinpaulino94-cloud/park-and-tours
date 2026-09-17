import { describe, it, expect } from "vitest";

import { computeAmount, specificityOf, pickRule } from "@/lib/commission-engine";
import type { CommissionRule } from "@/lib/types";

/**
 * Una comisión mal calculada NO DA ERROR: da una cifra.
 *
 * Por eso `net_rate` y `markup` estuvieron dos años pagándose como si fueran un
 * porcentaje —se ofrecían en la pantalla y caían al `return` final— sin que
 * nadie lo reportara. Lo que se prueba aquí son las formas de equivocarse que
 * no avisan: el tipo que no se implementó, la regla que paga más de lo que
 * entró, y el escalón que mide lo que no debe.
 */

const rule = (r: Partial<CommissionRule>): CommissionRule =>
  ({ _id: "r", name: "r", status: "active", ...r } as CommissionRule);

const base = { companyId: "c", baseAmount: 100, currency: "usd" as const };

describe("los tipos que ya funcionaban", () => {
  it("porcentaje: el 10 % de 100 son 10", () => {
    const out = computeAmount(rule({ calc_type: "percentage", value: 10 }), base);
    expect(out.amount).toBe(10);
    expect(out.percentage).toBe(10);
    expect(out.breakdown).toBe("10 % sobre 100.00 USD (venta sin impuestos)");
  });

  it("monto fijo: 25, y deriva el porcentaje efectivo", () => {
    const out = computeAmount(rule({ calc_type: "fixed", value: 25 }), base);
    expect(out.amount).toBe(25);
    expect(out.percentage).toBe(25);
    expect(out.breakdown).toBe("25.00 USD fijos por venta");
  });

  it("escalonado: coge el escalón donde cae el importe", () => {
    const tiers = JSON.stringify([
      { from: 0, to: 100, value: 5 },
      { from: 100, to: null, value: 10 },
    ]);
    const out = computeAmount(rule({ calc_type: "tiered", tiers }), { ...base, baseAmount: 150 });
    expect(out.amount).toBe(15);
    expect(out.breakdown).toContain("escalón de 100 en adelante");
  });

  it("por volumen: el listón es lo acumulado del periodo, no esta venta", () => {
    const tiers = JSON.stringify([
      { from: 0, to: 1000, value: 4 },
      { from: 1000, to: null, value: 8 },
    ]);
    const out = computeAmount(rule({ calc_type: "volume", tiers }), { ...base, periodSales: 5000 });
    expect(out.amount).toBe(8);
    expect(out.breakdown).toContain("acumulados en el periodo");
  });
});

describe("los dos tipos que estaban pagando mal", () => {
  it("tarifa neta: lo suyo es la DIFERENCIA, no un porcentaje de la venta", () => {
    /**
     * El acuerdo real: «la agencia me deja 45 netos por pasajero». En un tour
     * de 240 con 2 pasajeros, a la agencia le corresponden 240 − 90 = 150.
     *
     * Antes de 0059 esto pagaba el 45 % de 240 = 108. Ni una cosa ni la otra,
     * y sin avisar.
     */
    const out = computeAmount(
      rule({ calc_type: "net_rate", value: 45 }),
      { ...base, baseAmount: 240, adults: 2, children: 0 }
    );
    expect(out.amount).toBe(150);
    expect(out.breakdown).toBe("Tarifa neta: 240.00 USD − 45.00 USD × 2 pasajeros");
  });

  it("tarifa neta: vender por debajo del neto da cero, no una deuda del vendedor", () => {
    const out = computeAmount(
      rule({ calc_type: "net_rate", value: 90 }),
      { ...base, baseAmount: 100, adults: 2 }
    );
    expect(out.amount).toBe(0);
  });

  it("tarifa neta sin pasajeros declarados lo DICE en vez de pagar la venta entera", () => {
    // Sin pasajeros, `venta − neto × 0` es la venta entera: el beneficiario se
    // llevaría el 100 %. Se topa igual, pero el desglose delata el dato que falta.
    const out = computeAmount(rule({ calc_type: "net_rate", value: 45 }), { ...base, baseAmount: 240 });
    expect(out.breakdown).toContain("no declara pasajeros");
  });

  it("markup: es la parte del precio que ES el margen, no el margen del total", () => {
    /**
     * Un precio de 120 que ya lleva dentro un markup del 20 % viene de un neto
     * de 100: el margen son 20, no 24. Calcularlo como `120 × 20 %` se pasa de
     * largo un 20 % — y es exactamente lo que hacía.
     */
    const out = computeAmount(rule({ calc_type: "markup", value: 20 }), { ...base, baseAmount: 120 });
    expect(out.amount).toBe(20);
    expect(out.breakdown).toBe("Markup del 20 % ya incluido en 120.00 USD");
  });

  it("markup de cero no es margen: cero", () => {
    expect(computeAmount(rule({ calc_type: "markup", value: 0 }), base).amount).toBe(0);
  });
});

describe("los tipos por pasajero", () => {
  const pax = { ...base, baseAmount: 300, adults: 3, children: 2 };

  it("por adulto: 10 × 3 adultos", () => {
    const out = computeAmount(rule({ calc_type: "per_adult", value: 10 }), pax);
    expect(out.amount).toBe(30);
    expect(out.breakdown).toBe("10.00 USD × 3 adultos");
  });

  it("por niño: 5 × 2 niños", () => {
    const out = computeAmount(rule({ calc_type: "per_child", value: 5 }), pax);
    expect(out.amount).toBe(10);
    expect(out.breakdown).toBe("5.00 USD × 2 niños");
  });

  it("por pasajero: suma adultos y niños", () => {
    const out = computeAmount(rule({ calc_type: "per_pax", value: 4 }), pax);
    expect(out.amount).toBe(20);
    expect(out.breakdown).toBe("4.00 USD × 5 pasajeros");
  });

  it("el singular se escribe en singular: «1 adulto», no «1 adultos»", () => {
    // Sale impreso en la liquidación que firma un vendedor. Un texto que suena
    // a plantilla mal hecha hace dudar de la cifra que lo acompaña.
    const out = computeAmount(rule({ calc_type: "per_adult", value: 10 }), { ...base, adults: 1 });
    expect(out.breakdown).toBe("10.00 USD × 1 adulto");
  });

  it("una venta sin niños no paga nada por niño", () => {
    expect(computeAmount(rule({ calc_type: "per_child", value: 5 }), { ...base, adults: 2 }).amount).toBe(0);
  });
});

describe("escalones por pasajeros, y no por importe", () => {
  const tiers = JSON.stringify([
    { from: 1, to: 10, value: 10 },
    { from: 11, to: null, value: 15 },
  ]);

  it("el acuerdo con el touroperador mide PASAJEROS", () => {
    // «De 1 a 10 pax, 10 %; de 11 en adelante, 15 %». Con escalones por importe,
    // un grupo de 20 en un tour barato cobraría menos que una pareja en uno caro
    // — lo contrario de lo pactado.
    const out = computeAmount(
      rule({ calc_type: "tiered", tier_basis: "pax", tiers }),
      { ...base, baseAmount: 600, adults: 14, children: 0 }
    );
    expect(out.amount).toBe(90); // 15 % de 600
    expect(out.breakdown).toContain("14 pasajeros");
  });

  it("el mismo grupo con escalones por importe cae en el otro escalón", () => {
    // La prueba de que la base del escalón cambia la cifra de verdad: 600 cae
    // en «de 11 en adelante» por importe y también por pax, así que se usa un
    // importe pequeño con mucha gente para que se separen.
    const out = computeAmount(
      rule({ calc_type: "tiered", tiers }),
      { ...base, baseAmount: 9, adults: 14, children: 0 }
    );
    expect(out.amount).toBe(0.9); // 10 % de 9: escalón [1,10] POR IMPORTE
  });

  it("el defecto sigue siendo por importe: ninguna regla ya guardada cambia de cálculo", () => {
    const out = computeAmount(
      rule({ calc_type: "tiered", tiers }),
      { ...base, baseAmount: 9, adults: 14 }
    );
    expect(out.breakdown).toContain("9.00 USD");
  });

  it("sin ningún escalón definido la comisión es cero y lo dice", () => {
    const out = computeAmount(rule({ calc_type: "tiered", tiers: "[]" }), base);
    expect(out.amount).toBe(0);
    expect(out.breakdown).toContain("no cae en ningún escalón");
  });
});

describe("los topes, que son los que evitan pagar de más", () => {
  it("una regla que da más de lo que entró se topa a la base y lo explica", () => {
    // Un «fijo por venta» de 200 en un tour de 120 es siempre un error de
    // configuración. Topar y decirlo vale más que pagar y descubrirlo en la
    // liquidación.
    const out = computeAmount(rule({ calc_type: "fixed", value: 200 }), { ...base, baseAmount: 120 });
    expect(out.amount).toBe(120);
    expect(out.breakdown).toContain("topado a 120.00 USD");
    expect(out.percentage).toBe(100);
  });

  it("una venta sin ingreso no comisiona, y el desglose dice por qué", () => {
    const out = computeAmount(rule({ calc_type: "percentage", value: 10 }), { ...base, baseAmount: 0 });
    expect(out.amount).toBe(0);
    expect(out.percentage).toBe(0);
    expect(out.breakdown).toContain("no dejó ingreso");
  });

  it("nunca sale un importe negativo", () => {
    const out = computeAmount(
      rule({ calc_type: "net_rate", value: 500 }),
      { ...base, baseAmount: 100, adults: 2 }
    );
    expect(out.amount).toBe(0);
  });
});

describe("un tipo que este motor no conoce", () => {
  it("paga cero pero lo GRITA en el desglose, en vez de callarse", () => {
    /**
     * Es exactamente lo que pasó con `net_rate` y `markup`: el enum de la base
     * admitía tipos que el motor no implementaba, y el `default` pagaba en
     * silencio. Ahora ese texto acaba impreso en la liquidación del vendedor,
     * que es quien lo va a leer.
     */
    const out = computeAmount(rule({ calc_type: "inventado" as never, value: 10 }), base);
    expect(out.amount).toBe(0);
    expect(out.breakdown).toContain("no reconocido");
    expect(out.breakdown).toContain("revisa la regla");
  });
});

describe("qué regla gana (especificidad)", () => {
  it("vendedor + producto es la más específica (1)", () => {
    expect(specificityOf(rule({ seller: "s", product: "p" }))).toBe(1);
  });
  it("la de toda la empresa es la menos específica (8)", () => {
    expect(specificityOf(rule({}))).toBe(8);
  });
  it("solo canal va en 7", () => {
    expect(specificityOf(rule({ channel: "web" }))).toBe(7);
  });
});

describe("escoger la regla", () => {
  it("gana la más específica que encaje con el beneficiario", () => {
    const rules = [
      rule({ _id: "generica", beneficiary_type: "seller", product: "p", value: 5 }),
      rule({ _id: "especifica", beneficiary_type: "seller", product: "p", seller: "s1", value: 12 }),
    ];
    expect(pickRule(rules, { ...base, productId: "p", sellerId: "s1" }, "seller")?._id).toBe("especifica");
  });

  it("una prioridad explícita manda sobre la especificidad", () => {
    const rules = [
      rule({ _id: "a", beneficiary_type: "seller", product: "p", seller: "s1", priority: 50, value: 12 }),
      rule({ _id: "b", beneficiary_type: "seller", product: "p", priority: 1, value: 5 }),
    ];
    expect(pickRule(rules, { ...base, productId: "p", sellerId: "s1" }, "seller")?._id).toBe("b");
  });

  it("sin regla para ese beneficiario, nada", () => {
    expect(pickRule([rule({ beneficiary_type: "partner", value: 15 })], base, "seller")).toBeNull();
  });
});

describe("vigencia por fecha de VENTA, que no es la temporada de viaje", () => {
  const campana = rule({
    _id: "campana", beneficiary_type: "seller", value: 20,
    effective_from: "2026-10-01", effective_to: "2026-10-31",
  });

  it("una campaña de octubre aplica a lo vendido en octubre, viajen cuando viajen", () => {
    // La temporada acota por fecha de VIAJE. Esto acota por fecha de venta, y
    // hasta 0059 el segundo acuerdo no se podía expresar.
    const dentro = pickRule([campana], { ...base, saleDate: "2026-10-15", travelDate: "2027-02-01" }, "seller");
    expect(dentro?._id).toBe("campana");
  });

  it("y no a lo vendido en noviembre", () => {
    expect(pickRule([campana], { ...base, saleDate: "2026-11-01" }, "seller")).toBeNull();
  });

  it("el último día de la campaña cuenta entero", () => {
    // Comparar contra la medianoche del 31 dejaría fuera todo lo vendido ese
    // día, que es justo cuando más se vende en una campaña que acaba.
    const out = pickRule([campana], { ...base, saleDate: "2026-10-31T18:45:00Z" }, "seller");
    expect(out?._id).toBe("campana");
  });

  it("una fecha ilegible no deja la venta sin comisión", () => {
    const out = pickRule([campana], { ...base, saleDate: "el martes" }, "seller");
    expect(out?._id).toBe("campana");
  });

  it("una regla sin vigencia declarada aplica siempre", () => {
    const siempre = rule({ _id: "siempre", beneficiary_type: "seller", value: 10 });
    expect(pickRule([siempre], { ...base, saleDate: "2030-01-01" }, "seller")?._id).toBe("siempre");
  });
});
