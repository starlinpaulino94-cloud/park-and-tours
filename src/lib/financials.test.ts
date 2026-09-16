import { describe, it, expect } from "vitest";
import {
  balanceOf, incomeStatement, balanceSheet, closingEntry,
  postingBlocker, periodTransition, previousPeriod, isPeriod, periodOf,
  trialBalanceCsv, STATEMENT_COLUMNS, RETAINED_EARNINGS, NORMAL_SIDE,
} from "@/lib/financials";

/**
 * Un estado financiero mal armado no falla: sale un número bonito y equivocado,
 * y quien lo lee toma una decisión con él. Lo que se prueba aquí son las formas
 * concretas en que sale equivocado: el signo cambiado de una cuenta de pasivo,
 * el descuento contado como gasto, el resultado del ejercicio que falta del
 * patrimonio, y el asiento de cierre que arrastra el año anterior.
 */

const cuentas = [
  { code: "1101", name: "Caja general", type: "asset", debit: 500_000, credit: 380_000 },
  { code: "1201", name: "Cuentas por cobrar", type: "asset", debit: 120_000, credit: 40_000 },
  { code: "2101", name: "Proveedores", type: "liability", debit: 30_000, credit: 110_000 },
  { code: "3101", name: "Capital", type: "equity", debit: 0, credit: 50_000 },
  { code: "4101", name: "Ingresos por excursiones", type: "revenue", debit: 0, credit: 300_000 },
  { code: "4201", name: "Descuentos y devoluciones", type: "contra", debit: 20_000, credit: 0 },
  { code: "5101", name: "Costo de servicios", type: "expense", debit: 150_000, credit: 0 },
  { code: "5204", name: "Gastos operativos", type: "expense", debit: 60_000, credit: 0 },
];

describe("el saldo lleva el signo de SU lado", () => {
  it("un activo es débito menos crédito", () => {
    expect(balanceOf(cuentas[0])).toBe(120_000);
  });

  it("un pasivo es crédito menos débito: devolver siempre la misma resta cambiaría el signo", () => {
    expect(balanceOf(cuentas[2])).toBe(80_000);
  });

  it("cada tipo tiene su lado declarado, y `contra` vive del lado del débito", () => {
    expect(NORMAL_SIDE.contra).toBe("debit");
    expect(NORMAL_SIDE.revenue).toBe("credit");
  });
});

describe("estado de resultados", () => {
  const er = incomeStatement(cuentas);

  it("el descuento RESTA de las ventas, no suma a los gastos", () => {
    // Si se tratara como gasto, las ventas serían 300 000 y los gastos 230 000:
    // el resultado neto cuadraría igual, pero el margen bruto saldría mal.
    expect(er.totalRevenue).toBe(280_000);
    expect(er.totalExpenses).toBe(210_000);
  });

  it("el resultado neto es ingresos menos gastos", () => {
    expect(er.netIncome).toBe(70_000);
  });

  it("el margen bruto descuenta solo el costo directo, no todo el gasto", () => {
    expect(er.grossMargin).toBe(280_000 - 150_000);
  });

  it("el porcentaje de margen sale sobre la venta", () => {
    expect(er.marginPct).toBeCloseTo((70_000 / 280_000) * 100, 2);
  });

  it("sin ventas el porcentaje es cero y no NaN ni infinito", () => {
    const vacio = incomeStatement([{ code: "5204", name: "Gastos", type: "expense", debit: 100, credit: 0 }]);
    expect(vacio.marginPct).toBe(0);
    expect(vacio.netIncome).toBe(-100);
  });

  it("no mete cuentas de balance en el resultado", () => {
    expect(er.revenue.map((r) => r.code)).not.toContain("1101");
    expect(er.expenses.map((r) => r.code)).not.toContain("2101");
  });
});

describe("balance general", () => {
  const bg = balanceSheet(cuentas);

  it("incluye el resultado del ejercicio en el patrimonio: sin él no cuadra nunca", () => {
    expect(bg.currentResult).toBe(70_000);
    expect(bg.totalEquity).toBe(50_000 + 70_000);
  });

  it("cuadra: activo igual a pasivo más patrimonio", () => {
    expect(bg.totalAssets).toBe(200_000);
    expect(bg.totalLiabilities).toBe(80_000);
    expect(bg.difference).toBe(0);
    expect(bg.balanced).toBe(true);
  });

  it("y avisa cuando NO cuadra, en vez de enseñar un número bonito", () => {
    const roto = balanceSheet([...cuentas, { code: "1999", name: "Fantasma", type: "asset", debit: 1_000, credit: 0 }]);
    expect(roto.balanced).toBe(false);
    expect(roto.difference).toBe(1_000);
  });
});

describe("asiento de cierre del ejercicio", () => {
  it("salda cada cuenta de resultado por su lado contrario", () => {
    const lineas = closingEntry(cuentas);
    const ingreso = lineas.find((l) => l.account === "4101")!;
    const gasto = lineas.find((l) => l.account === "5101")!;
    expect(ingreso.debit).toBe(300_000);
    expect(gasto.credit).toBe(150_000);
  });

  it("la diferencia va a resultados acumulados, y cuadra", () => {
    const lineas = closingEntry(cuentas);
    const acumulados = lineas.find((l) => l.account === RETAINED_EARNINGS)!;
    expect(acumulados.credit).toBe(70_000);

    const debe = lineas.reduce((s, l) => s + (l.debit ?? 0), 0);
    const haber = lineas.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debe).toBe(haber);
  });

  it("una pérdida va al débito de acumulados", () => {
    const lineas = closingEntry([
      { code: "4101", name: "Ingresos", type: "revenue", debit: 0, credit: 10_000 },
      { code: "5204", name: "Gastos", type: "expense", debit: 25_000, credit: 0 },
    ]);
    const acumulados = lineas.find((l) => l.account === RETAINED_EARNINGS)!;
    expect(acumulados.debit).toBe(15_000);
    expect(acumulados.credit).toBeUndefined();
  });

  it("NO toca las cuentas de balance: caja y capital siguen igual el año que viene", () => {
    const codigos = closingEntry(cuentas).map((l) => l.account);
    expect(codigos).not.toContain("1101");
    expect(codigos).not.toContain("3101");
    expect(codigos).not.toContain("2101");
  });

  it("un ejercicio sin movimiento no genera un asiento en cero", () => {
    expect(closingEntry([{ code: "1101", name: "Caja", type: "asset", debit: 100, credit: 0 }])).toEqual([]);
    expect(closingEntry([])).toEqual([]);
  });

  it("una cuenta de resultado saldada no ensucia el asiento", () => {
    const lineas = closingEntry([
      { code: "4101", name: "Ingresos", type: "revenue", debit: 5_000, credit: 5_000 },
      { code: "5204", name: "Gastos", type: "expense", debit: 1_000, credit: 0 },
    ]);
    expect(lineas.map((l) => l.account)).toEqual(["5204", RETAINED_EARNINGS]);
  });
});

describe("cierre de periodo", () => {
  it("un periodo abierto o inexistente no bloquea nada", () => {
    expect(postingBlocker("2026-09", [])).toBeNull();
    expect(postingBlocker("2026-09", [{ period: "2026-09", status: "open" }])).toBeNull();
  });

  it("uno cerrado bloquea y dice que se puede reabrir", () => {
    const motivo = postingBlocker("2026-08", [{ period: "2026-08", status: "closed" }])!;
    expect(motivo).toMatch(/Reábrelo/);
  });

  it("uno declarado a la DGII bloquea y manda a la rectificativa, no a reabrir", () => {
    const motivo = postingBlocker("2026-07", [{ period: "2026-07", status: "locked" }])!;
    expect(motivo).toMatch(/rectificativa/);
    expect(motivo).not.toMatch(/Reábrelo/);
  });

  it("solo bloquea SU periodo, no los demás", () => {
    expect(postingBlocker("2026-09", [{ period: "2026-08", status: "locked" }])).toBeNull();
  });

  it("bloquear exige haber cerrado antes: si no, se salta la revisión del contador", () => {
    expect(periodTransition("open", "lock").ok).toBe(false);
    expect(periodTransition("closed", "lock")).toEqual({ ok: true, next: "locked" });
  });

  it("un periodo declarado no se reabre desde el sistema", () => {
    const r = periodTransition("locked", "reopen");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/rectificativa/);
  });

  it("un cerrado sí se reabre", () => {
    expect(periodTransition("closed", "reopen")).toEqual({ ok: true, next: "open" });
  });

  it("no se cierra dos veces", () => {
    expect(periodTransition("closed", "close").ok).toBe(false);
  });
});

describe("periodos", () => {
  it("el periodo sale de la fecha", () => {
    expect(periodOf("2026-09-16T10:00:00Z")).toBe("2026-09");
  });

  it("enero retrocede a diciembre del año anterior", () => {
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(previousPeriod("2026-09")).toBe("2026-08");
  });

  it("valida la forma: el mes 13 no existe", () => {
    expect(isPeriod("2026-09")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-00")).toBe(false);
    expect(isPeriod("septiembre")).toBe(false);
  });
});

describe("el archivo para el contador", () => {
  it("lleva el saldo ya con su signo: si no, lo vuelve a restar en Excel", () => {
    const csv = trialBalanceCsv(cuentas);
    const filas = csv.split("\n");
    expect(filas[0].split(",")).toHaveLength(STATEMENT_COLUMNS.length);
    // El pasivo sale en positivo del lado que le toca.
    const proveedores = filas.find((f) => f.startsWith("2101"))!;
    expect(proveedores.endsWith(",80000")).toBe(true);
  });

  it("cierra con los totales de débito y crédito", () => {
    const filas = trialBalanceCsv(cuentas).split("\n");
    expect(filas[filas.length - 1]).toContain("TOTALES");
  });
});
