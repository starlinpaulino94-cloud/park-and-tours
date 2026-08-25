import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_TIME_ZONE, companyTimeZone, dayBounds, dueLabel, humanizeElapsed,
  isDueToday, isOverdue, isSameZonedDay, isValidTimeZone, toValidDate, zoneOffsetMs, zonedParts,
} from "@/lib/time";

const RD = "America/Santo_Domingo";
const NY = "America/New_York";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DEFAULT_TIMEZONE;
});

describe("time — zona horaria de la empresa", () => {
  it("usa la zona configurada en la empresa", () => {
    expect(companyTimeZone({ timezone: NY })).toBe(NY);
  });

  it("cae al respaldo cuando la empresa no tiene zona", () => {
    expect(companyTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(companyTimeZone({ timezone: "   " })).toBe(DEFAULT_TIME_ZONE);
  });

  it("una zona inválida avisa y no rompe", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(companyTimeZone({ timezone: "Marte/Olympus" })).toBe(DEFAULT_TIME_ZONE);
    expect(warn).toHaveBeenCalled();
  });

  it("respeta DEFAULT_TIMEZONE del entorno antes que el literal", () => {
    process.env.DEFAULT_TIMEZONE = NY;
    expect(companyTimeZone(null)).toBe(NY);
  });

  it("valida zonas contra Intl", () => {
    expect(isValidTimeZone(RD)).toBe(true);
    expect(isValidTimeZone("nope/nope")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe("time — descomposición y desfase", () => {
  it("República Dominicana es UTC-4 todo el año", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), RD)).toBe(-4 * 3600_000);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), RD)).toBe(-4 * 3600_000);
  });

  it("Nueva York cambia con el horario de verano", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 3600_000);
  });

  it("descompone el instante en la hora de pared de la zona", () => {
    // 03:00Z del 25 son las 23:00 del 24 en RD.
    expect(zonedParts(new Date("2026-08-25T03:00:00Z"), RD)).toMatchObject({
      year: 2026, month: 8, day: 24, hour: 23,
    });
  });
});

describe("time — límites del día", () => {
  it("inicio y fin del día en la zona de la empresa", () => {
    const { start, end } = dayBounds(new Date("2026-08-25T15:00:00Z"), RD);
    expect(start.toISOString()).toBe("2026-08-25T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-26T03:59:59.999Z");
  });

  it("el día NO cambia a las 20:00 hora dominicana, aunque el servidor esté en UTC", () => {
    // 00:30Z del 25 = 20:30 del 24 en RD. Con la hora del servidor (UTC) el día
    // ya sería el 25; con la de la empresa sigue siendo el 24.
    const { start, end } = dayBounds(new Date("2026-08-25T00:30:00Z"), RD);
    expect(start.toISOString()).toBe("2026-08-24T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-25T03:59:59.999Z");
  });

  it("justo tras la medianoche local ya cuenta el día nuevo", () => {
    const { start } = dayBounds(new Date("2026-08-25T04:00:01Z"), RD);
    expect(start.toISOString()).toBe("2026-08-25T04:00:00.000Z");
  });

  it("resuelve el día de un cambio de horario de verano", () => {
    // 8 de marzo de 2026: Nueva York empieza a las 02:00 (EST -5 → EDT -4).
    const { start, end } = dayBounds(new Date("2026-03-08T18:00:00Z"), NY);
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });
});

describe("time — clasificación de vencimientos", () => {
  const now = new Date("2026-08-25T15:00:00Z"); // 11:00 en RD

  it("una tarea con fecha pasada está vencida", () => {
    expect(isOverdue("2026-08-25T14:59:00Z", now)).toBe(true);
  });

  it("una tarea futura no está vencida", () => {
    expect(isOverdue("2026-08-25T16:00:00Z", now)).toBe(false);
  });

  it("una tarea sin fecha nunca está vencida ni vence hoy", () => {
    expect(isOverdue(null, now)).toBe(false);
    expect(isDueToday(null, now, RD)).toBe(false);
    expect(isOverdue(undefined, now)).toBe(false);
  });

  it("una fecha inválida se ignora en vez de romper", () => {
    expect(toValidDate("no-es-una-fecha")).toBeNull();
    expect(isOverdue("no-es-una-fecha", now)).toBe(false);
    expect(isDueToday("no-es-una-fecha", now, RD)).toBe(false);
  });

  it("vence hoy solo dentro del día de la empresa y aún por delante", () => {
    expect(isDueToday("2026-08-25T23:00:00Z", now, RD)).toBe(true);   // 19:00 RD
    expect(isDueToday("2026-08-26T03:59:00Z", now, RD)).toBe(true);   // 23:59 RD
    expect(isDueToday("2026-08-26T04:00:00Z", now, RD)).toBe(false);  // ya es mañana
  });

  it("vencida y vence hoy son mutuamente excluyentes", () => {
    const cases = [
      "2026-08-25T10:00:00Z", "2026-08-25T14:59:00Z",
      "2026-08-25T15:00:01Z", "2026-08-26T03:00:00Z", "2026-08-27T12:00:00Z",
    ];
    for (const due of cases) {
      expect(isOverdue(due, now) && isDueToday(due, now, RD)).toBe(false);
    }
  });

  it("compara días de calendario en la zona, no en UTC", () => {
    // Ambos instantes son el 24 de agosto en RD aunque uno ya sea 25 en UTC.
    expect(isSameZonedDay(new Date("2026-08-25T02:00:00Z"), new Date("2026-08-24T18:00:00Z"), RD)).toBe(true);
  });
});

describe("time — etiquetas", () => {
  const now = new Date("2026-08-25T15:00:00Z");

  it("sin fecha lo dice con texto, no con color", () => {
    expect(dueLabel(null, now, RD)).toBe("Sin vencimiento");
  });

  it("vencida indica cuánto hace", () => {
    expect(dueLabel("2026-08-25T12:00:00Z", now, RD)).toBe("Vencida hace 3 h");
  });

  it("hoy y mañana llevan etiqueta relativa", () => {
    expect(dueLabel("2026-08-25T22:00:00Z", now, RD)).toMatch(/^Hoy /);
    expect(dueLabel("2026-08-26T22:00:00Z", now, RD)).toMatch(/^Mañana /);
  });

  it("más adelante muestra la fecha completa", () => {
    expect(dueLabel("2026-09-12T14:00:00Z", now, RD)).toMatch(/^12 sep 2026 · /);
  });

  it("humaniza el tiempo transcurrido", () => {
    expect(humanizeElapsed("2026-08-25T14:59:30Z", now)).toBe("hace instantes");
    expect(humanizeElapsed("2026-08-25T14:30:00Z", now)).toBe("hace 30 min");
    expect(humanizeElapsed("2026-08-23T15:00:00Z", now)).toBe("hace 2 d");
    expect(humanizeElapsed(null, now)).toBe("—");
  });
});
