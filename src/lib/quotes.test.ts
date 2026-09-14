import { describe, it, expect } from "vitest";
import {
  lineGross, lineDiscount, lineTotal, lineCost, linePax, billableLines,
  totalsOf, quoteTotals, optionBreakdown, headerTotals, depositDue,
  isExpired, derivedStatus, sendBlocker, decideBlocker, convertBlocker, reviseBlocker,
  versionedCode, baseCode,
} from "@/lib/quotes";

describe("cotizaciones — importe de una línea", () => {
  it("multiplica cantidad por precio", () => {
    expect(lineGross({ quantity: 4, unit_price: 25.5 })).toBe(102);
  });

  it("aplica el descuento sobre el bruto", () => {
    expect(lineDiscount({ quantity: 4, unit_price: 25, discount_percent: 10 })).toBe(10);
    expect(lineTotal({ quantity: 4, unit_price: 25, discount_percent: 10 })).toBe(90);
  });

  it("un descuento fuera de rango no suma importe ni deja la línea en negativo", () => {
    expect(lineTotal({ quantity: 2, unit_price: 50, discount_percent: 150 })).toBe(0);
    expect(lineTotal({ quantity: 2, unit_price: 50, discount_percent: -20 })).toBe(100);
  });

  it("los campos vacíos valen cero, no NaN", () => {
    expect(lineTotal({})).toBe(0);
    expect(lineTotal({ quantity: null, unit_price: undefined })).toBe(0);
    expect(lineTotal({ quantity: "x" as unknown as number, unit_price: 10 })).toBe(0);
  });

  it("redondea a centavos", () => {
    expect(lineTotal({ quantity: 3, unit_price: 33.333 })).toBe(100);
  });

  it("el coste no se descuenta: el descuento se lo come el margen, no el proveedor", () => {
    expect(lineCost({ quantity: 4, unit_price: 25, unit_cost: 15, discount_percent: 50 })).toBe(60);
  });
});

describe("cotizaciones — totales", () => {
  const lines = [
    { quantity: 2, unit_price: 100, unit_cost: 60 },        // 200, coste 120
    { quantity: 1, unit_price: 50, discount_percent: 20 },   // 50 − 10 = 40
  ];

  it("suma el bruto y el descuento por separado", () => {
    expect(quoteTotals(lines)).toMatchObject({ subtotal: 250, discount: 10, total: 240 });
  });

  it("el impuesto tecleado se respeta en las cotizaciones antiguas", () => {
    expect(quoteTotals(lines, 43.2).total).toBe(283.2);
  });

  it("con tasa, el impuesto se calcula sobre la base y no sobre el bruto", () => {
    // 240 de base × 18% de ITBIS = 43.20. Calcularlo sobre 250 cobraría de más.
    const t = totalsOf(lines, { taxPercent: 18 });
    expect(t.tax).toBe(43.2);
    expect(t.total).toBe(283.2);
  });

  it("la tasa manda sobre el importe heredado", () => {
    expect(totalsOf(lines, { taxPercent: 0, fallbackTax: 43.2 }).tax).toBe(0);
  });

  it("el margen excluye impuesto y sale del coste real", () => {
    const t = totalsOf(lines, { taxPercent: 18 });
    expect(t.cost_total).toBe(120);
    expect(t.margin_amount).toBe(120);       // 240 de base − 120 de coste
    expect(t.margin_percent).toBe(50);
  });

  it("sin ingreso el margen porcentual no se puede calcular y no se inventa", () => {
    // Devolver 0 diría "margen cero", que es otra afirmación.
    expect(totalsOf([]).margin_percent).toBeNull();
  });

  it("un extra opcional se ofrece pero no se cobra", () => {
    const withExtra = [...lines, { quantity: 1, unit_price: 500, is_optional: true }];
    expect(billableLines(withExtra)).toHaveLength(2);
    expect(totalsOf(withExtra).total).toBe(240);
  });

  it("una cotización sin líneas vale cero", () => {
    expect(quoteTotals([])).toMatchObject({ subtotal: 0, discount: 0, total: 0 });
  });

  it("el total siempre cuadra con la suma de las líneas", () => {
    const { subtotal, discount, total } = quoteTotals(lines);
    expect(total).toBe(subtotal - discount);
    expect(lines.reduce((s, l) => s + lineTotal(l), 0)).toBe(total);
  });
});

describe("cotizaciones — alternativas", () => {
  const options = [
    { _id: "a", name: "Hotel 4*", sort_order: 1 },
    { _id: "b", name: "Hotel 5*", sort_order: 2, is_recommended: true },
  ];
  const lines = [
    { quantity: 1, unit_price: 300 },                       // común: transporte
    { quantity: 1, unit_price: 700, option_id: "a" },
    { quantity: 1, unit_price: 1200, option_id: "b" },
    { quantity: 1, unit_price: 250, option_id: "b", is_optional: true }, // extra ofrecido
  ];

  it("cada opción suma lo común más lo suyo, sin duplicar el transporte", () => {
    const [a, b] = optionBreakdown(options, lines);
    expect(a.total).toBe(1000);
    expect(b.total).toBe(1500);
  });

  it("respeta el orden en que se presentan", () => {
    const [first] = optionBreakdown([...options].reverse(), lines);
    expect(first.name).toBe("Hotel 4*");
  });

  it("la cabecera no suma las alternativas: el cliente compra una", () => {
    // Sumarlas contaría 2.500 de negocio donde hay como mucho 1.500.
    const header = headerTotals(options, lines);
    expect(header.total).toBe(1500);          // la recomendada
    expect(header.option_id).toBe("b");
    expect([header.from, header.to]).toEqual([1000, 1500]);
  });

  it("la escogida manda sobre la recomendada", () => {
    const chosen = [{ ...options[0], is_selected: true }, options[1]];
    expect(headerTotals(chosen, lines).total).toBe(1000);
  });

  it("sin recomendada ni escogida vale la primera del orden", () => {
    const plain = [{ _id: "a", name: "A", sort_order: 1 }, { _id: "b", name: "B", sort_order: 2 }];
    expect(headerTotals(plain, lines).option_id).toBe("a");
  });

  it("sin alternativas, la cabecera es la suma de sus líneas", () => {
    const header = headerTotals([], [{ quantity: 2, unit_price: 100 }]);
    expect(header.total).toBe(200);
    expect(header.option_id).toBeNull();
  });
});

describe("cotizaciones — anticipo", () => {
  it("un porcentaje se calcula sobre el total", () => {
    expect(depositDue({ deposit_type: "percent", deposit_percent: 30 }, 1000))
      .toEqual({ deposit: 300, balance: 700 });
  });

  it("un importe fijo se respeta tal cual", () => {
    expect(depositDue({ deposit_type: "amount", deposit_amount: 250 }, 1000))
      .toEqual({ deposit: 250, balance: 750 });
  });

  it("sin anticipo pactado, todo es saldo", () => {
    expect(depositDue({ deposit_type: "none" }, 1000)).toEqual({ deposit: 0, balance: 1000 });
  });

  it("un anticipo mayor que el total se acota: el saldo nunca es negativo", () => {
    // Un documento que dice "anticipo 1.500, saldo −500" se contradice solo.
    expect(depositDue({ deposit_type: "amount", deposit_amount: 1500 }, 1000))
      .toEqual({ deposit: 1000, balance: 0 });
    expect(depositDue({ deposit_type: "percent", deposit_percent: 150 }, 1000).deposit).toBe(1000);
  });
});

describe("cotizaciones — vigencia", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  it("una propuesta pasada de plazo está vencida aunque siga diciendo 'enviada'", () => {
    const q = { status: "sent", valid_until: "2026-03-01T00:00:00Z" };
    expect(isExpired(q, now)).toBe(true);
    expect(derivedStatus(q, now)).toBe("expired");
  });

  it("sin plazo no vence", () => {
    expect(isExpired({ status: "sent" }, now)).toBe(false);
  });

  it("una cotización ya decidida no se 'vence' por la fecha", () => {
    // Fue aceptada en plazo: la fecha posterior no le quita la aceptación.
    expect(derivedStatus({ status: "accepted", valid_until: "2026-03-01T00:00:00Z" }, now)).toBe("accepted");
  });
});

describe("cotizaciones — qué se puede hacer con ella", () => {
  const lines = [{ quantity: 1, unit_price: 100, product: "p1" }];
  const sendable = { status: "draft", customer: "c1", valid_until: "2030-01-01T00:00:00Z" };

  it("no se envía una propuesta sin líneas: no dice ningún precio", () => {
    expect(sendBlocker({ ...sendable }, [])).toBe("no_lines");
    expect(sendBlocker({ ...sendable }, [{ quantity: 1, unit_price: 100, is_optional: true }])).toBe("no_lines");
  });

  it("no se envía sin destinatario ni sin plazo", () => {
    expect(sendBlocker({ status: "draft", valid_until: "2030-01-01T00:00:00Z" }, lines)).toBe("no_recipient");
    expect(sendBlocker({ status: "draft", contact_email: "  " }, lines)).toBe("no_recipient");
    expect(sendBlocker({ status: "draft", customer: "c1" }, lines)).toBe("no_validity");
  });

  it("un correo de contacto basta cuando el cliente aún no está dado de alta", () => {
    expect(sendBlocker({ ...sendable, customer: undefined, contact_email: "grupo@colegio.do" }, lines)).toBeNull();
  });

  it("no se reenvía una decidida ni una reemplazada", () => {
    expect(sendBlocker({ ...sendable, status: "accepted" }, lines)).toBe("already_decided");
    expect(sendBlocker({ ...sendable, status: "superseded" }, lines)).toBe("superseded");
  });

  it("no se registra respuesta de algo que el cliente no ha recibido", () => {
    expect(decideBlocker({ status: "draft" })).toBe("not_sent");
    expect(decideBlocker({ status: "sent", valid_until: "2030-01-01T00:00:00Z" })).toBeNull();
    expect(decideBlocker({ status: "negotiating" })).toBeNull();
  });

  it("una propuesta vencida se bloquea, y ese bloqueo sí se puede forzar", () => {
    const blocked = decideBlocker({ status: "sent", valid_until: "2020-01-01T00:00:00Z" });
    expect(blocked).toBe("expired");
  });

  it("solo se convierte una aceptada, con cliente y con algo del catálogo", () => {
    expect(convertBlocker({ status: "sent", customer: "c1" }, lines)).toBe("not_accepted");
    expect(convertBlocker({ status: "accepted" }, lines)).toBe("no_customer");
    expect(convertBlocker({ status: "accepted", customer: "c1" }, [{ }])).toBe("no_sellable_line");
    expect(convertBlocker({ status: "accepted", customer: "c1" }, lines)).toBeNull();
  });

  it("no se convierte dos veces", () => {
    expect(convertBlocker({ status: "converted", customer: "c1" }, lines)).toBe("already_converted");
    expect(convertBlocker({ status: "accepted", customer: "c1", order: "o1" }, lines)).toBe("already_converted");
  });

  it("con alternativas hay que saber cuál escogió el cliente", () => {
    const options = [{ _id: "a" }, { _id: "b" }];
    const optLines = [{ product: "p1", option_id: "a" }, { product: "p2", option_id: "b" }];
    expect(convertBlocker({ status: "accepted", customer: "c1" }, optLines, options)).toBe("no_option_selected");
    // Y al convertir solo cuenta la escogida: si la otra es la que trae producto, no hay nada que reservar.
    const selected = [{ _id: "a", is_selected: true }, { _id: "b" }];
    expect(convertBlocker({ status: "accepted", customer: "c1" }, [{ product: "p2", option_id: "b" }], selected))
      .toBe("no_sellable_line");
    expect(convertBlocker({ status: "accepted", customer: "c1" }, optLines, selected)).toBeNull();
  });

  it("una cotización ya convertida no se revisa: su orden ya existe", () => {
    expect(reviseBlocker({ status: "converted" })).toBe("already_converted");
    expect(reviseBlocker({ status: "superseded" })).toBe("superseded");
    expect(reviseBlocker({ status: "rejected" })).toBeNull(); // rechazada sí: es la ronda siguiente
  });
});

describe("cotizaciones — versión y pax", () => {
  it("la revisión conserva el código base y añade la versión", () => {
    expect(versionedCode("COT-2609-ABC1234", 1)).toBe("COT-2609-ABC1234");
    expect(versionedCode("COT-2609-ABC1234", 3)).toBe("COT-2609-ABC1234-v3");
  });

  it("versionar dos veces no encadena sufijos", () => {
    // La v3 se calcula desde el código de la v2, no desde el original.
    expect(versionedCode("COT-2609-ABC1234-v2", 3)).toBe("COT-2609-ABC1234-v3");
    expect(baseCode("COT-2609-ABC1234-v2")).toBe("COT-2609-ABC1234");
  });

  it("sin desglose, la cantidad son adultos", () => {
    expect(linePax({ quantity: 4 })).toEqual({ adults: 4, children: 0, infants: 0 });
  });

  it("el desglose explícito manda sobre la cantidad", () => {
    expect(linePax({ quantity: 4, adults: 2, children: 2 })).toEqual({ adults: 2, children: 2, infants: 0 });
  });

  it("una línea nunca viaja sin nadie", () => {
    expect(linePax({ quantity: 0 })).toEqual({ adults: 1, children: 0, infants: 0 });
  });
});
