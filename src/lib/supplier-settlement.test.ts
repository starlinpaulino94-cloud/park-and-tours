import { describe, it, expect } from "vitest";
import {
  costQuantity, costLines, costTotal, costBySupplier, reconcile,
  retentionsFor, DEFAULT_RETENTIONS, settlementTotals, payBlocker, stateAfterPayment,
  type CostTariff,
} from "@/lib/supplier-settlement";

const basis = { pax: 4, groups: 1, vehicles: 2, revenue: 1000 };

describe("cuántas unidades se le pagan a cada tarifa", () => {
  it("por persona son los pax", () => {
    expect(costQuantity("per_person", basis)).toBe(4);
  });

  it("por grupo, salida o fija es una", () => {
    expect(costQuantity("per_group", basis)).toBe(1);
    expect(costQuantity("per_departure", basis)).toBe(1);
    expect(costQuantity("fixed", basis)).toBe(1);
  });

  it("por vehículo son los vehículos asignados", () => {
    expect(costQuantity("per_vehicle", basis)).toBe(2);
  });

  it("un tipo desconocido se paga por persona, no se hace cero", () => {
    // Hacerlo cero haría desaparecer en silencio un costo que sí se paga.
    expect(costQuantity("loquesea", basis)).toBe(4);
    expect(costQuantity(null, basis)).toBe(4);
  });

  it("un cero explícito de vehículos no paga nada", () => {
    expect(costQuantity("per_vehicle", { pax: 4, vehicles: 0 })).toBe(0);
  });

  it("sin dato de vehículos se cobra una vez, que es lo único que se puede suponer al vender", () => {
    expect(costQuantity("per_vehicle", { pax: 4 })).toBe(1);
  });
});

describe("el desglose del costo por proveedor", () => {
  const tariffs: CostTariff[] = [
    { _id: "t1", supplier: "bus", concept: "Transporte", cost_type: "per_vehicle", amount: 600, currency: "dop" },
    { _id: "t2", supplier: "resto", concept: "Almuerzo", cost_type: "per_person", amount: 350, currency: "dop" },
    { _id: "t3", supplier: "parque", concept: "Entrada", cost_type: "per_person", amount: 150, currency: "dop" },
  ];

  it("cada línea sabe de quién es", () => {
    const lines = costLines(tariffs, basis, "dop");
    expect(lines.map((l) => [l.supplierId, l.amount])).toEqual([
      ["bus", 1200], ["resto", 1400], ["parque", 600],
    ]);
  });

  it("la suma de las líneas es el costo de la reserva", () => {
    expect(costTotal(costLines(tariffs, basis, "dop"))).toBe(3200);
  });

  it("una tarifa inactiva no se paga", () => {
    const lines = costLines([...tariffs, {
      _id: "t4", supplier: "otro", concept: "Viejo", cost_type: "per_person", amount: 999, status: "inactive",
    }], basis, "dop");
    expect(lines).toHaveLength(3);
  });

  it("un porcentaje se aplica sobre la venta, no sobre los pax", () => {
    const lines = costLines(
      [{ _id: "t5", supplier: "agencia", concept: "Fee", cost_type: "percentage", amount: 12 }],
      basis, "usd"
    );
    expect(lines[0]).toMatchObject({ quantity: 1, amount: 120 });
  });

  it("un porcentaje sin venta no cobra nada", () => {
    const lines = costLines(
      [{ _id: "t5", supplier: "agencia", cost_type: "percentage", amount: 12 }],
      { pax: 4 }, "usd"
    );
    expect(lines).toHaveLength(0);
  });

  it("agrupa por proveedor y moneda", () => {
    const groups = costBySupplier(costLines([
      { _id: "a", supplier: "bus", cost_type: "per_person", amount: 100, currency: "dop" },
      { _id: "b", supplier: "bus", cost_type: "per_group", amount: 500, currency: "dop" },
      { _id: "c", supplier: "bus", cost_type: "per_person", amount: 10, currency: "usd" },
    ], basis, "dop"));
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.currency === "dop")!.amount).toBe(900);
    expect(groups.find((g) => g.currency === "usd")!.amount).toBe(40);
  });

  it("una tarifa sin proveedor no se pierde: queda sin dueño y se ve", () => {
    const groups = costBySupplier(costLines(
      [{ _id: "x", concept: "Sin asignar", cost_type: "per_person", amount: 50 }], basis, "dop"
    ));
    expect(groups[0].supplierId).toBeNull();
    expect(groups[0].amount).toBe(200);
  });

  it("sin tarifas no hay nada que liquidar", () => {
    expect(costLines([], basis)).toEqual([]);
    expect(costTotal(null)).toBe(0);
  });
});

describe("la conciliación de la factura", () => {
  it("mientras no factura, está pendiente", () => {
    expect(reconcile({ amount: 1000 }).verdict).toBe("pending");
    expect(reconcile({ amount: 1000, confirmed_amount: null }).verdict).toBe("pending");
  });

  it("factura lo mismo: cuadra", () => {
    expect(reconcile({ amount: 1000, confirmed_amount: 1000 }).verdict).toBe("match");
  });

  it("factura de más: hay que discutirlo", () => {
    const result = reconcile({ amount: 1000, confirmed_amount: 1200 });
    expect(result.verdict).toBe("over");
    expect(result.variance).toBe(200);
  });

  it("factura de menos: probablemente se le olvidó una salida", () => {
    const result = reconcile({ amount: 1000, confirmed_amount: 850 });
    expect(result.verdict).toBe("under");
    expect(result.variance).toBe(-150);
  });

  it("la tolerancia absorbe el redondeo, no una diferencia real", () => {
    expect(reconcile({ amount: 1000, confirmed_amount: 1005 }, 5).verdict).toBe("match");
    expect(reconcile({ amount: 1000, confirmed_amount: 1006 }, 5).verdict).toBe("over");
  });

  it("factura cero es una factura, no un pendiente", () => {
    expect(reconcile({ amount: 1000, confirmed_amount: 0 }).verdict).toBe("under");
  });
});

describe("las retenciones", () => {
  it("a una empresa formal no se le retiene por defecto", () => {
    const r = retentionsFor({ tax_regime: "company" }, 1180);
    expect(r.total).toBe(0);
  });

  it("a una persona física se le retiene ISR sobre la base e ITBIS sobre el impuesto", () => {
    // 1180 con 18% de ITBIS incluido: base 1000, impuesto 180.
    const r = retentionsFor({ tax_regime: "individual", tax_rate: 18 }, 1180);
    expect(r.base).toBe(1000);
    expect(r.tax).toBe(180);
    expect(r.isr).toBe(100);   // 10% de la base
    expect(r.itbis).toBe(180); // 100% del impuesto
    expect(r.total).toBe(280);
  });

  it("el ITBIS se SEPARA del bruto, no se suma encima", () => {
    // Aplicar las dos retenciones sobre el bruto retendría de más.
    const r = retentionsFor({ tax_regime: "individual", tax_rate: 18 }, 1180);
    expect(r.base + r.tax).toBe(1180);
  });

  it("sin ITBIS facturado no hay ITBIS que retener", () => {
    const r = retentionsFor({ tax_regime: "informal" }, 1000);
    expect(r.tax).toBe(0);
    expect(r.itbis).toBe(0);
    expect(r.isr).toBe(100);
  });

  it("los porcentajes del proveedor mandan sobre los del régimen", () => {
    const r = retentionsFor(
      { tax_regime: "individual", retention_isr_pct: 2, retention_itbis_pct: 30, tax_rate: 18 },
      1180
    );
    expect(r.isr).toBe(20);
    expect(r.itbis).toBe(54);
  });

  it("un cero explícito del proveedor no se reemplaza por el del régimen", () => {
    const r = retentionsFor({ tax_regime: "individual", retention_isr_pct: 0, tax_rate: 18 }, 1180);
    expect(r.isr).toBe(0);
    expect(r.itbis).toBe(180);
  });

  it("los porcentajes se acotan entre 0 y 100", () => {
    const r = retentionsFor({ retention_isr_pct: 500, retention_itbis_pct: -20, tax_rate: 18 }, 1180);
    expect(r.isr).toBe(1000);
    expect(r.itbis).toBe(0);
  });

  it("un régimen desconocido se trata como empresa", () => {
    expect(retentionsFor({ tax_regime: "loquesea" }, 1000).total).toBe(0);
  });

  it("los valores por defecto están declarados para los tres regímenes", () => {
    expect(Object.keys(DEFAULT_RETENTIONS).sort()).toEqual(["company", "individual", "informal"]);
  });
});

describe("los totales de la liquidación", () => {
  it("mientras no factura, se paga lo devengado", () => {
    const totals = settlementTotals({ services: 3200 });
    expect(totals.confirmed).toBe(3200);
    expect(totals.net).toBe(3200);
  });

  it("en cuanto factura, manda su documento", () => {
    const totals = settlementTotals({ services: 3200, confirmed: 3000 });
    expect(totals.net).toBe(3000);
  });

  it("las retenciones bajan el neto", () => {
    const retentions = retentionsFor({ tax_regime: "individual", tax_rate: 18 }, 1180);
    const totals = settlementTotals({ services: 1180, confirmed: 1180, retentions });
    expect(totals.retentions).toBe(280);
    expect(totals.net).toBe(900);
  });

  it("un ajuste negativo descuenta", () => {
    expect(settlementTotals({ services: 1000, confirmed: 1000, adjustments: -150 }).net).toBe(850);
  });

  it("un ajuste que se come la liquidación no genera una transferencia al revés", () => {
    expect(settlementTotals({ services: 1000, confirmed: 1000, adjustments: -5000 }).net).toBe(0);
  });
});

describe("cuándo no se puede pagar", () => {
  it("una liquidación pagada no se paga dos veces", () => {
    expect(payBlocker({ status: "paid", commission_total: 100 })).toBe("already_paid");
  });

  it("una anulada tampoco", () => {
    expect(payBlocker({ status: "void", commission_total: 100 })).toBe("void");
  });

  it("una en disputa se resuelve antes de pagar", () => {
    expect(payBlocker({ status: "disputed", commission_total: 100 })).toBe("disputed");
  });

  it("sin nada pendiente no hay nada que pagar", () => {
    expect(payBlocker({ status: "approved", commission_total: 100, paid_total: 100 })).toBe("nothing_due");
  });

  it("a un proveedor no se le paga sin su comprobante", () => {
    expect(payBlocker({
      status: "approved", beneficiary_type: "supplier", net_total: 900,
    })).toBe("not_confirmed");
  });

  it("con comprobante sí", () => {
    expect(payBlocker({
      status: "approved", beneficiary_type: "supplier", net_total: 900,
      supplier_invoice_number: "A010010011500000123",
    })).toBeNull();
  });

  it("una liquidación de comisiones no necesita factura de nadie", () => {
    expect(payBlocker({ status: "approved", beneficiary_type: "partner", commission_total: 500 })).toBeNull();
  });

  it("el proveedor usa el neto y el socio el total de comisión", () => {
    // Un proveedor con neto cero tras retenciones no tiene nada que cobrar.
    expect(payBlocker({
      status: "approved", beneficiary_type: "supplier", net_total: 0,
      supplier_invoice_number: "X",
    })).toBe("nothing_due");
  });
});

describe("el abono parcial", () => {
  it("un abono deja la liquidación parcialmente pagada", () => {
    expect(stateAfterPayment(1000, 0, 400)).toEqual({ paid: 400, outstanding: 600, status: "partially_paid" });
  });

  it("el último abono la cierra", () => {
    expect(stateAfterPayment(1000, 600, 400)).toEqual({ paid: 1000, outstanding: 0, status: "paid" });
  });

  it("un abono de más no deja pagado más que el total", () => {
    expect(stateAfterPayment(1000, 0, 5000)).toEqual({ paid: 1000, outstanding: 0, status: "paid" });
  });

  it("un abono de cero no cambia el estado", () => {
    expect(stateAfterPayment(1000, 0, 0).status).toBe("pending");
  });

  it("el céntimo del redondeo no deja una liquidación abierta", () => {
    expect(stateAfterPayment(33.33, 11.11, 22.22).status).toBe("paid");
  });
});
