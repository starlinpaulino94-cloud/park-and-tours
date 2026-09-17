import { describe, it, expect } from "vitest";
import {
  monthKey, monthsBetween, buildCohorts, repeatRate, averageCustomerValue,
  leadDays, leadDistribution, LEAD_BUCKETS,
  learnCurve, forecastOccupancy, MIN_CURVE_SAMPLE, MIN_CURVE_SHARE,
  departureAlerts, DEFAULT_THRESHOLDS,
  type PurchaseRow, type PastDeparture, type DepartureSnapshot,
} from "@/lib/analytics";

/**
 * Una analítica equivocada es peor que ninguna: se toman decisiones con ella.
 * Lo que se prueba aquí son las formas concretas de equivocarse que tiene este
 * tipo de cálculo — el cliente que cambia de cohorte al volver y hace que la
 * retención salga perfecta, y la división por una cuota minúscula que convierte
 * dos plazas vendidas en una salida llena.
 */

/* ─────────────────────────────────────────────────────── cohortes ── */

const COMPRAS: PurchaseRow[] = [
  // Ana: alta en enero, vuelve en marzo.
  { customerId: "ana", at: "2026-01-10T10:00:00Z", amount: 100 },
  { customerId: "ana", at: "2026-03-05T10:00:00Z", amount: 150 },
  // Luis: alta en enero, no vuelve.
  { customerId: "luis", at: "2026-01-20T10:00:00Z", amount: 80 },
  // Marta: alta en febrero, vuelve en febrero otra vez (mismo mes) y en abril.
  { customerId: "marta", at: "2026-02-02T10:00:00Z", amount: 200 },
  { customerId: "marta", at: "2026-02-20T10:00:00Z", amount: 50 },
  { customerId: "marta", at: "2026-04-01T10:00:00Z", amount: 120 },
];

describe("cohortes de clientes", () => {
  it("agrupa por el mes de la PRIMERA compra", () => {
    const cohortes = buildCohorts(COMPRAS);
    expect(cohortes.map((c) => c.cohort)).toEqual(["2026-01", "2026-02"]);
    expect(cohortes[0].customers).toBe(2);
    expect(cohortes[1].customers).toBe(1);
  });

  it("un cliente NO cambia de cohorte al volver", () => {
    // Es el error clásico: reasignarlo haría que la retención saliera siempre
    // perfecta, porque todo el mundo estaría siempre en su primer mes.
    const cohortes = buildCohorts(COMPRAS);
    const enero = cohortes.find((c) => c.cohort === "2026-01")!;
    // Ana vuelve en marzo = dos meses después de su alta.
    expect(enero.returning[2]).toBe(1);
    expect(enero.retention[2]).toBe(50);
    // Y en marzo NO aparece una cohorte nueva con Ana dentro.
    expect(cohortes.some((c) => c.cohort === "2026-03")).toBe(false);
  });

  it("el mes 0 son todos, por definición", () => {
    for (const cohorte of buildCohorts(COMPRAS)) {
      expect(cohorte.retention[0]).toBe(100);
    }
  });

  it("comprar dos veces el mismo mes no cuenta dos veces", () => {
    // La retención mide si VOLVIÓ, no cuánto compró.
    const febrero = buildCohorts(COMPRAS).find((c) => c.cohort === "2026-02")!;
    expect(febrero.returning[0]).toBe(1);
  });

  it("el ingreso se atribuye a la cohorte de alta, no al mes de la compra", () => {
    const enero = buildCohorts(COMPRAS).find((c) => c.cohort === "2026-01")!;
    expect(enero.revenue).toBe(330); // 100 + 150 de Ana + 80 de Luis
  });

  it("sin compras no hay cohortes", () => {
    expect(buildCohorts([])).toEqual([]);
  });

  it("los meses se cuentan de verdad, también cruzando el año", () => {
    expect(monthsBetween("2026-01", "2026-03")).toBe(2);
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
    expect(monthsBetween("2026-05", "2026-01")).toBe(-4);
  });

  it("el mes sale de la fecha en UTC y aguanta basura", () => {
    expect(monthKey("2026-01-10T10:00:00Z")).toBe("2026-01");
    expect(monthKey("no es fecha")).toBe("");
  });
});

describe("recompra y valor del cliente", () => {
  it("la tasa de recompra se mide sobre CLIENTES, no sobre ventas", () => {
    // Diez ventas de diez personas y diez ventas de una sola son negocios
    // completamente distintos.
    // Ana y Marta repiten en otro mes; Luis no. 2 de 3.
    expect(repeatRate(COMPRAS)).toBe(66.67);
  });

  it("comprar tres veces el mismo mes no es repetir", () => {
    const mismoMes: PurchaseRow[] = [
      { customerId: "x", at: "2026-01-02T10:00:00Z", amount: 10 },
      { customerId: "x", at: "2026-01-09T10:00:00Z", amount: 10 },
      { customerId: "x", at: "2026-01-20T10:00:00Z", amount: 10 },
    ];
    expect(repeatRate(mismoMes)).toBe(0);
  });

  it("el valor medio suma TODO lo que compró cada cliente", () => {
    // Ana 250, Luis 80, Marta 370 → 700 / 3
    expect(averageCustomerValue(COMPRAS)).toBe(233.33);
  });

  it("sin clientes no hay medias que inventar", () => {
    expect(repeatRate([])).toBe(0);
    expect(averageCustomerValue([])).toBe(0);
  });
});

/* ──────────────────────────────────────────── curva de anticipación ── */

describe("antelación", () => {
  it("cuenta días naturales, no instantes", () => {
    expect(leadDays("2026-03-01T23:00:00Z", "2026-03-03T01:00:00Z")).toBe(2);
  });

  it("reservar el mismo día es cero, y no hay negativos", () => {
    expect(leadDays("2026-03-03T08:00:00Z", "2026-03-03T20:00:00Z")).toBe(0);
    expect(leadDays("2026-03-05T08:00:00Z", "2026-03-03T08:00:00Z")).toBe(0);
  });

  it("los tramos cortos existen porque ahí pasa casi todo", () => {
    // Un tramo de «0 a 30» escondería justo la parte que hay que gestionar.
    expect(LEAD_BUCKETS.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it("reparte las plazas por tramo y calcula su peso", () => {
    const dist = leadDistribution([
      { bookedAt: "2026-03-03T08:00:00Z", travelAt: "2026-03-03T08:00:00Z", seats: 2 },
      { bookedAt: "2026-03-02T08:00:00Z", travelAt: "2026-03-03T08:00:00Z", seats: 2 },
      { bookedAt: "2026-02-01T08:00:00Z", travelAt: "2026-03-03T08:00:00Z", seats: 6 },
    ]);
    expect(dist[0].seats).toBe(2);   // mismo día
    expect(dist[1].seats).toBe(2);   // 1 día
    expect(dist[0].share).toBe(20);
    expect(dist.find((b) => b.from === 30)?.seats).toBe(6);
  });

  it("sin reservas, todos los pesos son cero y no NaN", () => {
    for (const bucket of leadDistribution([])) {
      expect(bucket.share).toBe(0);
    }
  });
});

describe("aprender la curva de la operadora", () => {
  /** Una salida donde la mitad se vendió a 10 días y la otra mitad el día antes. */
  const salida = (travelAt: string): PastDeparture => ({
    travelAt,
    finalSeats: 20,
    bookings: [
      { bookedAt: new Date(new Date(travelAt).getTime() - 10 * 86_400_000).toISOString(), seats: 10 },
      { bookedAt: new Date(new Date(travelAt).getTime() - 1 * 86_400_000).toISOString(), seats: 10 },
    ],
  });

  it("a 10 días vista la mitad estaba vendida, y a 0 todo", () => {
    const curva = learnCurve([salida("2026-03-10T12:00:00Z")]);
    expect(curva.share[0]).toBe(1);
    expect(curva.share[10]).toBe(0.5);
    expect(curva.share[20]).toBe(0);
  });

  it("la curva nunca sube al alejarse, y eso sale de cómo se construye", () => {
    // Es la propiedad de la que depende la previsión: si subiera al alejarse,
    // dividir convertiría dos plazas en cien. No hace falta corregirla porque
    // cada salida aporta una serie ya no creciente — y esto lo comprueba.
    const curva = learnCurve([
      salida("2026-03-10T12:00:00Z"),
      { travelAt: "2026-04-10T12:00:00Z", finalSeats: 10, bookings: [{ bookedAt: "2026-04-05T12:00:00Z", seats: 10 }] },
    ]);
    for (let d = 1; d < curva.share.length; d++) {
      expect(curva.share[d], `día ${d}`).toBeLessThanOrEqual(curva.share[d - 1]);
    }
  });

  it("promedia por SALIDA y no por plaza", () => {
    // Si no, una sola salida grande impondría su forma a todas las demás.
    const grande: PastDeparture = {
      travelAt: "2026-05-10T12:00:00Z", finalSeats: 200,
      bookings: [{ bookedAt: "2026-05-09T12:00:00Z", seats: 200 }],
    };
    const curva = learnCurve([salida("2026-03-10T12:00:00Z"), grande]);
    // La pequeña tenía 0,5 a 10 días y la grande 0: el promedio es 0,25.
    expect(curva.share[10]).toBe(0.25);
    expect(curva.sample).toBe(2);
  });

  it("una salida sin ventas no enseña nada", () => {
    const curva = learnCurve([{ travelAt: "2026-03-10T12:00:00Z", finalSeats: 0, bookings: [] }]);
    expect(curva.sample).toBe(0);
    expect(curva.share).toEqual([]);
  });
});

describe("previsión de ocupación", () => {
  const curva = { share: Array.from({ length: 91 }, (_, d) => Math.max(0, 1 - d / 40)), sample: 30 };

  it("divide lo vendido por la cuota que corresponde a esa distancia", () => {
    // A 20 días la curva dice 0,5: 10 vendidas apuntan a 20 finales.
    const previsto = forecastOccupancy({ soldSeats: 10, capacity: 40, daysOut: 20, curve: curva });
    expect(previsto.expectedSeats).toBe(20);
    expect(previsto.expectedPct).toBe(50);
    expect(previsto.confidence).toBe("high");
  });

  it("nunca prevé por encima de la capacidad", () => {
    const previsto = forecastOccupancy({ soldSeats: 30, capacity: 40, daysOut: 20, curve: curva });
    expect(previsto.expectedSeats).toBe(40);
  });

  it("a mucha distancia NO divide: dos plazas no son cien", () => {
    // A 80 días la curva está por debajo del mínimo; dividir entre 0,02
    // convertiría dos plazas en cien.
    const previsto = forecastOccupancy({ soldSeats: 2, capacity: 40, daysOut: 80, curve: curva });
    expect(previsto.confidence).toBe("none");
    expect(previsto.expectedSeats).toBe(2);
    expect(previsto.note).toContain("demasiado tiempo");
  });

  it("el umbral de la cuota es el que decide ese corte", () => {
    const justoDebajo = { share: [1, MIN_CURVE_SHARE - 0.001], sample: 30 };
    expect(forecastOccupancy({ soldSeats: 2, capacity: 40, daysOut: 1, curve: justoDebajo }).confidence).toBe("none");
    const justoEncima = { share: [1, MIN_CURVE_SHARE], sample: 30 };
    expect(forecastOccupancy({ soldSeats: 2, capacity: 40, daysOut: 1, curve: justoEncima }).confidence).not.toBe("none");
  });

  it("sin historia no se inventa un pronóstico", () => {
    // Decir «va al 92 %» con dos salidas pasadas sería una cifra con la
    // autoridad de un cálculo y la fiabilidad de una corazonada.
    const previsto = forecastOccupancy({ soldSeats: 10, capacity: 40, daysOut: 5, curve: { share: [], sample: 0 } });
    expect(previsto.confidence).toBe("none");
    expect(previsto.note).toContain("salidas pasadas");
  });

  it("con muestra corta se avisa en vez de presentarlo como un cálculo", () => {
    const pocas = { share: curva.share, sample: MIN_CURVE_SAMPLE - 1 };
    const previsto = forecastOccupancy({ soldSeats: 10, capacity: 40, daysOut: 20, curve: pocas });
    expect(previsto.confidence).toBe("low");
    expect(previsto.note).toContain("indicio");
  });

  it("sin capacidad declarada no hay porcentaje que dar", () => {
    const previsto = forecastOccupancy({ soldSeats: 10, capacity: 0, daysOut: 5, curve: curva });
    expect(previsto.confidence).toBe("none");
    expect(previsto.expectedPct).toBe(0);
  });
});

/* ──────────────────────────────────────────────────────── alertas ── */

describe("alertas de ocupación", () => {
  const curva = { share: Array.from({ length: 91 }, (_, d) => Math.max(0, 1 - d / 40)), sample: 30 };
  const salida = (over: Partial<DepartureSnapshot> = {}): DepartureSnapshot => ({
    id: "d1", product: "Saona", travelAt: "2026-03-20T12:00:00Z",
    capacity: 40, soldSeats: 10, daysOut: 10, ...over,
  });

  it("la sobreventa es crítica y no necesita previsión", () => {
    const alertas = departureAlerts([salida({ soldSeats: 45 })], curva);
    expect(alertas[0].kind).toBe("over_capacity");
    expect(alertas[0].severity).toBe("critical");
  });

  it("cero ventas a pocos días se avisa aunque no haya curva", () => {
    // Es un hecho, no un pronóstico.
    const alertas = departureAlerts([salida({ soldSeats: 0, daysOut: 2 })], { share: [], sample: 0 });
    expect(alertas[0].kind).toBe("no_pickup");
  });

  it("una salida lejana no genera alertas: hoy no se puede hacer nada", () => {
    // A 30 días la curva SÍ sabe prever (0,25) y esta salida iría al 40 %: sin
    // el horizonte saldría una alerta que nadie puede accionar todavía.
    const fuera = salida({ soldSeats: 4, daysOut: 30 });
    expect(forecastOccupancy({ soldSeats: 4, capacity: 40, daysOut: 30, curve: curva }).expectedPct)
      .toBeLessThan(DEFAULT_THRESHOLDS.lowPct);
    expect(fuera.daysOut).toBeGreaterThan(DEFAULT_THRESHOLDS.horizonDays);
    expect(departureAlerts([fuera], curva)).toEqual([]);
  });

  it("una previsión sin confianza NO dispara alerta de ocupación baja", () => {
    // «Cancela el autobús» basándose en dos salidas pasadas es peor que no
    // decir nada.
    const alertas = departureAlerts([salida({ soldSeats: 4, daysOut: 15 })], { share: [], sample: 0 });
    expect(alertas.filter((a) => a.kind === "low_occupancy")).toEqual([]);
  });

  it("avisa de la que va camino de llenarse, para asegurar vehículo y guía", () => {
    // A 10 días la curva está en 0,75: 34 vendidas apuntan a 45 → tope 40.
    const alertas = departureAlerts([salida({ soldSeats: 34 })], curva);
    expect(alertas[0].kind).toBe("almost_full");
  });

  it("avisa de la que va camino de vacía", () => {
    const alertas = departureAlerts([salida({ soldSeats: 4 })], curva);
    expect(alertas[0].kind).toBe("low_occupancy");
    expect(alertas[0].expectedPct).toBeLessThan(DEFAULT_THRESHOLDS.lowPct);
  });

  it("lo más grave y lo más próximo va primero", () => {
    // Una lista ordenada por id es una lista que nadie termina de leer.
    // La grave va MÁS TARDE que la leve a propósito: si el orden se apoyara
    // solo en la fecha, esta prueba pasaría sin comprobar la gravedad.
    const alertas = departureAlerts(
      [
        salida({ id: "a", soldSeats: 4, daysOut: 5, travelAt: "2026-03-15T12:00:00Z" }),
        salida({ id: "b", soldSeats: 50, daysOut: 15, travelAt: "2026-03-25T12:00:00Z" }),
      ],
      curva
    );
    expect(alertas[0].departureId).toBe("b");
    expect(alertas[0].severity).toBe("critical");
    expect(alertas[1].departureId).toBe("a");
  });

  it("la baja ocupación urge más cuando ya casi sale", () => {
    const lejos = departureAlerts([salida({ soldSeats: 4, daysOut: 15 })], curva)[0];
    const cerca = departureAlerts([salida({ soldSeats: 2, daysOut: 2 })], curva)[0];
    expect(lejos.severity).toBe("info");
    expect(cerca.severity).toBe("warning");
  });
});
