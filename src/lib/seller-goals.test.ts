import { describe, it, expect } from "vitest";
import {
  GOAL_PERIODS, PERIOD_LABEL, normalizePeriod, rangeOf, coversDate,
  GOAL_METRICS, METRIC_LABEL, MONEY_METRICS, progressOf, isAchieved, overallPct,
  achievementSnapshot,
  PAYOUT_KINDS, normalizePayoutKind, PAYABLE_BONUS, bonusTotals, payableTotal,
  bonusBlocker,
} from "@/lib/seller-goals";

/**
 * Dos cosas deciden dinero aquí: cuándo se da una meta por cumplida —porque
 * detrás va un premio— y qué parte de un bono se transfiere de verdad.
 *
 * La segunda es la que se equivoca en silencio: sumar un pase regalado al total
 * a pagar hace que la operadora transfiera dinero por algo que ya entregó, y el
 * vendedor no va a ser quien lo reporte.
 */

// Un martes, para que el corte de semana se note.
const MARTES = new Date("2026-09-15T12:00:00Z");

describe("el periodo", () => {
  it("cuatro periodos, con su etiqueta", () => {
    expect([...GOAL_PERIODS]).toEqual(["daily", "weekly", "monthly", "range"]);
    for (const p of GOAL_PERIODS) expect(PERIOD_LABEL[p]).toBeTruthy();
    expect(normalizePeriod("WEEKLY")).toBe("weekly");
    expect(normalizePeriod("cuando sea")).toBe("monthly");
  });

  it("la semana empieza el LUNES", () => {
    // En una operadora dominicana el fin de semana es el pico de ventas.
    // Cortar la semana en mitad del sábado partiría en dos el dato que más
    // importa.
    expect(rangeOf({ period: "weekly" }, MARTES)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("y un domingo sigue perteneciendo a la semana que empezó el lunes anterior", () => {
    const domingo = new Date("2026-09-20T12:00:00Z");
    expect(rangeOf({ period: "weekly" }, domingo)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("el mes llega hasta su último día de verdad, también en febrero", () => {
    expect(rangeOf({ period: "monthly" }, MARTES)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeOf({ period: "monthly" }, new Date("2028-02-10T00:00:00Z")))
      .toEqual({ from: "2028-02-01", to: "2028-02-29" }); // bisiesto
  });

  it("la diaria es un solo día", () => {
    expect(rangeOf({ period: "daily" }, MARTES)).toEqual({ from: "2026-09-15", to: "2026-09-15" });
  });

  it("el rango usa sus fechas", () => {
    const r = rangeOf({ period: "range", period_from: "2026-10-01", period_to: "2026-10-15" }, MARTES);
    expect(r).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });

  it("un rango SIN fechas cae al mes en vez de quedarse vacío", () => {
    // Un rango vacío no lo cumpliría nadie, y la meta parecería viva en el
    // listado mientras es imposible.
    expect(rangeOf({ period: "range" }, MARTES)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("saber si una fecha cae dentro", () => {
    const r = { from: "2026-09-01", to: "2026-09-30" };
    expect(coversDate(r, "2026-09-15T23:00:00Z")).toBe(true);
    expect(coversDate(r, "2026-10-01")).toBe(false);
    expect(coversDate(r, null)).toBe(false);
  });
});

describe("el progreso", () => {
  it("cinco dimensiones, y solo una es dinero", () => {
    expect([...GOAL_METRICS]).toEqual(["signups", "bookings", "sales", "pax", "revenue"]);
    for (const m of GOAL_METRICS) expect(METRIC_LABEL[m]).toBeTruthy();
    expect([...MONEY_METRICS]).toEqual(["revenue"]);
  });

  it("SOLO se pinta lo que la meta declara", () => {
    /**
     * Una meta de pasajeros no debe enseñar una barra de ingresos en cero. Esa
     * barra no significa nada y hace que el vendedor lea que va fatal en algo
     * que nadie le pidió.
     */
    const lineas = progressOf({ target_pax: 150 }, { pax: 90, revenue: 0, sales: 0 });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].metric).toBe("pax");
  });

  it("calcula el porcentaje, lo que falta y si está cumplida", () => {
    const [linea] = progressOf({ target_pax: 150 }, { pax: 90 });
    expect(linea.pct).toBe(60);
    expect(linea.remaining).toBe(60);
    expect(linea.met).toBe(false);
  });

  it("pasarse está bien, pero la barra no se sale", () => {
    // Se topa para pintar y se guarda sin topar para poder decir «160 %».
    const [linea] = progressOf({ target_sales: 10 }, { sales: 16 });
    expect(linea.pct).toBe(100);
    expect(linea.rawPct).toBe(160);
    expect(linea.met).toBe(true);
    expect(linea.remaining).toBe(0);
  });

  it("una meta de varias dimensiones se cumple cuando se cumplen TODAS", () => {
    // «40 ventas y 150 pasajeros» es UNA meta con dos condiciones. Dar por buena
    // la primera y pagar el premio sería regalarlo a medias.
    const meta = { target_sales: 40, target_pax: 150 };
    expect(isAchieved(progressOf(meta, { sales: 41, pax: 90 }))).toBe(false);
    expect(isAchieved(progressOf(meta, { sales: 41, pax: 151 }))).toBe(true);
  });

  it("una meta que no pide nada NO está cumplida", () => {
    // Devolver `true` aquí pagaría premios por nada.
    expect(isAchieved(progressOf({}, { sales: 100 }))).toBe(false);
  });

  it("el porcentaje global es la media de lo que la meta pide", () => {
    const lineas = progressOf({ target_sales: 10, target_pax: 100 }, { sales: 10, pax: 50 });
    expect(overallPct(lineas)).toBe(75);
    expect(overallPct([])).toBeNull();
  });

  it("la condición congelada lleva lo que se pidió y lo que se alcanzó", () => {
    // Dentro de seis meses, «Bono de septiembre · 100 USD» no se puede defender
    // sin esto: la meta pudo editarse o borrarse.
    const meta = { _id: "g1", name: "Playa septiembre", period: "monthly", target_pax: 150 };
    const lineas = progressOf(meta, { pax: 163 });
    const foto = achievementSnapshot(meta, lineas, { from: "2026-09-01", to: "2026-09-30" });
    expect(foto.goal_id).toBe("g1");
    expect(foto.metrics).toEqual([{ metric: "pax", target: 150, reached: 163 }]);
    expect(foto.from).toBe("2026-09-01");
  });
});

describe("los bonos: qué se transfiere y qué no", () => {
  it("dos formas de pagar, y el defecto es en efectivo", () => {
    expect([...PAYOUT_KINDS]).toEqual(["cash", "in_kind"]);
    expect(normalizePayoutKind("in_kind")).toBe("in_kind");
    // Equivocarse hacia «en especie» dejaría de transferirse dinero que sí se
    // debía, así que lo que no se reconoce es efectivo.
    expect(normalizePayoutKind(undefined)).toBe("cash");
    expect(normalizePayoutKind("regalo")).toBe("cash");
  });

  it("un premio en especie NO suma a lo que se transfiere", () => {
    /**
     * Es el fallo que esto evita: sumar un pase regalado al total a pagar hace
     * que la operadora transfiera dinero por algo que ya entregó — y el
     * vendedor no va a ser quien lo reporte.
     */
    const totales = bonusTotals([
      { amount: 100, payout_kind: "cash", status: "approved" },
      { amount: 80, payout_kind: "in_kind", status: "approved" },
    ]);
    expect(totales.cash).toBe(100);
    expect(totales.inKind).toBe(80);
    expect(totales.count).toBe(2);
  });

  it("solo cuentan los bonos que todavía se pueden pagar", () => {
    expect([...PAYABLE_BONUS].sort()).toEqual(["approved", "settled"]);
    const totales = bonusTotals([
      { amount: 100, status: "approved" },
      { amount: 50, status: "cancelled" },
      { amount: 70, status: "paid" },      // ya se pagó: no vuelve a pagarse
      { amount: 30, status: "pending" },   // todavía no lo aprobó nadie
    ]);
    expect(totales.cash).toBe(100);
    expect(totales.count).toBe(1);
  });

  it("el total a transferir es el NETO de las comisiones más los bonos en efectivo", () => {
    // El neto, no el importe: si hubo un ajuste por una venta cancelada, ese
    // dinero ya no se debe.
    const totales = bonusTotals([
      { amount: 100, payout_kind: "cash", status: "approved" },
      { amount: 80, payout_kind: "in_kind", status: "approved" },
    ]);
    expect(payableTotal(450, totales)).toBe(550);
  });

  it("sin bonos, el total es el de las comisiones", () => {
    expect(payableTotal(450, bonusTotals([]))).toBe(450);
  });
});

describe("dar de alta un bono", () => {
  it("hace falta una persona", () => {
    expect(bonusBlocker({ description: "Meta de agosto", amount: 100 })).toContain("a quién");
  });

  it("y una descripción: es lo que se lee en la liquidación", () => {
    expect(bonusBlocker({ sellerId: "s1", description: "", amount: 100 })).toContain("de qué es el bono");
  });

  it("un premio en especie también lleva su valor", () => {
    // Sin valor declarado no se puede poner en el expediente ni en la
    // declaración de la operadora.
    expect(bonusBlocker({ sellerId: "s1", description: "Dos pases a Saona", amount: 0, payoutKind: "in_kind" }))
      .toContain("también tiene un valor");
  });

  it("un bono en efectivo de cero sí se admite: hay premios simbólicos", () => {
    expect(bonusBlocker({ sellerId: "s1", description: "Reconocimiento del mes", amount: 0 })).toBeNull();
  });

  it("un importe negativo no", () => {
    // Para quitar se usa un ajuste de comisión, no un bono en negativo.
    expect(bonusBlocker({ sellerId: "s1", description: "x y z", amount: -10 })).toContain("no es válido");
  });

  it("un bono bien puesto pasa", () => {
    expect(bonusBlocker({ sellerId: "s1", description: "Meta de pasajeros de septiembre", amount: 100 })).toBeNull();
  });
});
