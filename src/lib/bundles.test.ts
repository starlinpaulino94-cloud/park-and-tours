import { describe, it, expect } from "vitest";
import {
  minutesOfDay, hhmm, dayOf, addDays,
  DEFAULT_DURATION_MIN, durationOf, slotFits, blockOf, clash, conflictsIn,
  validateItinerary, candidatesFor, autoResolve, byDay, spanDays,
  tightestSeats, startsAt, sellBlocker,
  type BundleItem, type Slot,
} from "@/lib/bundles";

/**
 * Un itinerario que «parece» válido y no lo es se descubre el día de la salida,
 * con el cliente en el lobby. Lo que se prueba aquí son las formas de armar uno
 * así: el margen que no se cuenta, la actividad de día completo que se coge
 * primero y bloquea todo, y las plazas que hay en dos de las tres actividades.
 */

const item = (o: Partial<BundleItem> & { id: string; productId: string }): BundleItem => ({
  productName: o.productId,
  dayOffset: 0,
  sortOrder: 0,
  ...o,
});

const slot = (
  productId: string, day: string, time: string, seatsLeft: number | null = 20
): Slot => ({
  departureId: `${productId}-${day}-${time}`,
  productId,
  at: `${day}T${time}:00.000Z`,
  seatsLeft,
  localDay: day,
  localTime: time,
});

const opts = (o: Partial<Parameters<typeof autoResolve>[2]> = {}) => ({
  startDay: "2026-11-10",
  pax: 2,
  bufferMin: 30,
  ...o,
});

describe("las horas", () => {
  it("lee y escribe HH:MM", () => {
    expect(minutesOfDay("09:30")).toBe(570);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(hhmm(570)).toBe("09:30");
    expect(hhmm(1_440)).toBe("00:00");   // da la vuelta al día
    expect(hhmm(-30)).toBe("23:30");
  });

  it("lo que no es una hora no es una hora", () => {
    // Tratar «por la mañana» como las 00:00 pondría la actividad de madrugada.
    expect(minutesOfDay("por la mañana")).toBeNull();
    expect(minutesOfDay("25:00")).toBeNull();
    expect(minutesOfDay(null)).toBeNull();
  });

  it("suma días sin que un huso cambie la fecha", () => {
    expect(addDays("2026-11-10", 2)).toBe("2026-11-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-10", 0)).toBe("2026-11-10");
  });

  it("el día local depende de la zona, y ahí está el fallo que se evita", () => {
    // Una salida a las 21:00 de Santo Domingo es del día 10 allí y del 11 en
    // UTC. Sin la zona, el itinerario pondría el combo en dos días distintos.
    const noche = "2026-11-11T01:00:00.000Z";
    expect(dayOf(noche)).toBe("2026-11-11");
    expect(dayOf(noche, "America/Santo_Domingo")).toBe("2026-11-10");
  });

  it("una zona inventada no rompe: cae a UTC", () => {
    expect(dayOf("2026-11-11T01:00:00.000Z", "Marte/Olympus")).toBe("2026-11-11");
  });
});

describe("la duración", () => {
  it("sin dato se asume media jornada", () => {
    // Quedarse corto produce itinerarios que parecen válidos y no lo son, que
    // es peor que rechazar uno bueno: el rechazado se ve.
    expect(DEFAULT_DURATION_MIN).toBe(240);
    expect(durationOf(item({ id: "a", productId: "saona" }))).toBe(240);
    expect(durationOf(item({ id: "a", productId: "saona", durationMin: 0 }))).toBe(240);
    expect(durationOf(item({ id: "a", productId: "saona", durationMin: 660 }))).toBe(660);
  });
});

describe("los choques", () => {
  const saona = item({ id: "i1", productId: "saona", productName: "Saona", durationMin: 600 });
  const buggy = item({ id: "i2", productId: "buggy", productName: "Buggy", durationMin: 180 });

  it("dos actividades el mismo día que se pisan chocan", () => {
    const a = blockOf(saona, slot("saona", "2026-11-10", "07:00"));
    const b = blockOf(buggy, slot("buggy", "2026-11-10", "14:00"));
    expect(clash(a, b, 30)).toBe(true);
  });

  it("EL MARGEN CUENTA: salir a las 12:00 y entrar a las 12:05 no es un itinerario", () => {
    const corta = item({ id: "i3", productId: "x", productName: "X", durationMin: 120 });
    const a = blockOf(corta, slot("x", "2026-11-10", "10:00"));   // 10:00 → 12:00
    const b = blockOf(buggy, slot("buggy", "2026-11-10", "12:05"));
    expect(clash(a, b, 30)).toBe(true);
    // Con margen cero sí cabría, y por eso el margen lo declara la operadora.
    expect(clash(a, b, 0)).toBe(false);
  });

  it("días distintos no chocan nunca", () => {
    const a = blockOf(saona, slot("saona", "2026-11-10", "07:00"));
    const b = blockOf(buggy, slot("buggy", "2026-11-11", "07:00"));
    expect(clash(a, b, 120)).toBe(false);
  });

  it("si CUALQUIERA de las dos admite solaparse, no chocan", () => {
    // Un pase de día a un parque no compite con una excursión de dos horas
    // dentro de ese mismo parque.
    const pase = item({ id: "i4", productId: "pase", productName: "Pase", durationMin: 600, allowOverlap: true });
    const a = blockOf(pase, slot("pase", "2026-11-10", "09:00"));
    const b = blockOf(buggy, slot("buggy", "2026-11-10", "11:00"));
    expect(clash(a, b, 30)).toBe(false);
  });

  it("el choque se explica con nombres y horas, no con ids", () => {
    const a = blockOf(saona, slot("saona", "2026-11-10", "07:00"));
    const b = blockOf(buggy, slot("buggy", "2026-11-10", "14:00"));
    const [conflicto] = conflictsIn([a, b], 30);
    expect(conflicto.message).toContain("«Saona»");
    expect(conflicto.message).toContain("«Buggy»");
    expect(conflicto.message).toContain("17:00");   // 07:00 + 600 min
    expect(conflicto.message).toContain("30 minutos");
  });

  it("validar un itinerario sin choques lo da por bueno", () => {
    const a = blockOf(saona, slot("saona", "2026-11-10", "07:00"));
    const b = blockOf(buggy, slot("buggy", "2026-11-11", "09:00"));
    expect(validateItinerary([a, b], 30).ok).toBe(true);
  });
});

describe("las salidas candidatas", () => {
  const buggy = item({ id: "i2", productId: "buggy", productName: "Buggy", durationMin: 180 });

  const universo = [
    slot("buggy", "2026-11-10", "09:00"),
    slot("buggy", "2026-11-10", "14:00"),
    slot("buggy", "2026-11-11", "09:00"),
    slot("saona", "2026-11-10", "07:00"),
  ];

  it("solo del producto, del día que le toca y con plazas", () => {
    const c = candidatesFor(buggy, universo, opts());
    expect(c.map((s) => s.localTime)).toEqual(["09:00", "14:00"]);
  });

  it("el día lo decide el desplazamiento del componente", () => {
    const segundoDia = item({ ...buggy, dayOffset: 1 });
    const c = candidatesFor(segundoDia, universo, opts());
    expect(c).toHaveLength(1);
    expect(c[0].localDay).toBe("2026-11-11");
  });

  it("una hora fija descarta todo lo demás", () => {
    const fijo = item({ ...buggy, fixedTime: "14:00" });
    expect(candidatesFor(fijo, universo, opts()).map((s) => s.localTime)).toEqual(["14:00"]);
  });

  it("una salida sin plazas para el grupo no es candidata", () => {
    const apretado = [slot("buggy", "2026-11-10", "09:00", 1)];
    expect(candidatesFor(buggy, apretado, opts({ pax: 4 }))).toEqual([]);
  });

  it("sin aforo declarado no hay techo", () => {
    const libre = [slot("buggy", "2026-11-10", "09:00", null)];
    expect(slotFits(libre[0], 400)).toBe(true);
    expect(candidatesFor(buggy, libre, opts({ pax: 40 }))).toHaveLength(1);
  });
});

describe("resolver el itinerario automáticamente", () => {
  const saona = item({ id: "i1", productId: "saona", productName: "Saona", durationMin: 600, dayOffset: 0 });
  const buggy = item({ id: "i2", productId: "buggy", productName: "Buggy", durationMin: 180, dayOffset: 0 });

  it("NO coge lo primero que encaja: mueve la actividad larga si hace falta", () => {
    /**
     * Es el caso que tumba a un algoritmo voraz. Saona ocupa todo el día 10, así
     * que si se coge primero el buggy de ese día ya no cabe. La respuesta
     * correcta es usar el buggy del día 10 por la mañana temprano… o, como aquí,
     * la única combinación que no choca.
     */
    const slots = [
      slot("saona", "2026-11-10", "07:00"),   // 07:00 → 17:00
      slot("buggy", "2026-11-10", "14:00"),   // choca
      slot("buggy", "2026-11-10", "18:00"),   // 18:00, cabe tras 17:00 + 30
    ];
    const r = autoResolve([saona, buggy], slots, opts());
    expect(r.ok).toBe(true);
    expect(r.blocks.find((b) => b.productId === "buggy")!.start).toBe(18 * 60);
  });

  it("prefiere menos tiempo muerto AUNQUE termine más tarde", () => {
    /**
     * Las dos cosas van casi siempre de la mano, y por eso hay que separarlas a
     * propósito para probar cuál manda. Aquí no coinciden:
     *
     *   · madrugar a las 06:00 deja el paquete listo a las 12:00, con DOS HORAS
     *     de espera en medio;
     *   · empezar a las 09:00 termina a las 13:30 con media hora de espera.
     *
     * Gana el segundo. Un turista esperando dos horas en un sitio que no
     * conoce, tras levantarse a las cinco, cuenta esas dos horas como el
     * paquete entero — y eso es lo que escribe en la reseña.
     */
    const a = item({ id: "ia", productId: "aaa", productName: "A", durationMin: 120 });
    const b = item({ id: "ib", productId: "bbb", productName: "B", durationMin: 120 });
    const slots = [
      slot("aaa", "2026-11-10", "06:00"),
      slot("aaa", "2026-11-10", "09:00"),
      slot("bbb", "2026-11-10", "10:00"),
      slot("bbb", "2026-11-10", "11:30"),
    ];
    const r = autoResolve([a, b], slots, opts());
    expect(r.ok).toBe(true);
    expect(r.blocks.find((x) => x.productId === "aaa")!.start).toBe(9 * 60);
    expect(r.blocks.find((x) => x.productId === "bbb")!.start).toBe(11 * 60 + 30);
  });

  it("devuelve alternativas, ordenadas de mejor a peor", () => {
    const corta = item({ id: "i3", productId: "corta", productName: "Corta", durationMin: 120 });
    const slots = [
      slot("corta", "2026-11-10", "09:00"),
      slot("buggy", "2026-11-10", "11:30"),
      slot("buggy", "2026-11-10", "15:00"),
      slot("buggy", "2026-11-10", "17:00"),
    ];
    const r = autoResolve([corta, buggy], slots, opts());
    expect(r.alternatives.length).toBeGreaterThan(0);
    const primera = r.alternatives[0].find((b) => b.productId === "buggy")!;
    expect(primera.start).toBe(15 * 60);   // la segunda mejor, no la peor
  });

  it("cuando NO hay combinación posible, enseña qué choca en vez de decir «no»", () => {
    // Decirle a alguien «no se puede» sin enseñarle qué choca no le deja
    // arreglarlo.
    const slots = [
      slot("saona", "2026-11-10", "07:00"),
      slot("buggy", "2026-11-10", "14:00"),
    ];
    const r = autoResolve([saona, buggy], slots, opts());
    expect(r.ok).toBe(false);
    expect(r.blocks).toHaveLength(2);
    expect(r.conflicts[0].message).toContain("no da tiempo");
  });

  it("un componente sin salida dice POR QUÉ, y el motivo decide qué se arregla", () => {
    const soloSaona = [slot("saona", "2026-11-10", "07:00")];
    const r = autoResolve([saona, buggy], soloSaona, opts());
    expect(r.ok).toBe(false);
    expect(r.unresolved[0].reason).toContain("no tiene ninguna salida programada");

    const otroDia = [slot("saona", "2026-11-10", "07:00"), slot("buggy", "2026-11-20", "09:00")];
    expect(autoResolve([saona, buggy], otroDia, opts()).unresolved[0].reason)
      .toContain("no sale el 2026-11-10");

    const sinPlazas = [slot("saona", "2026-11-10", "07:00"), slot("buggy", "2026-11-10", "09:00", 1)];
    expect(autoResolve([saona, buggy], sinPlazas, opts({ pax: 4 })).unresolved[0].reason)
      .toContain("no quedan 4 plazas juntas");

    const horaFija = [slot("buggy", "2026-11-10", "09:00")];
    expect(autoResolve([item({ ...buggy, fixedTime: "14:00" })], horaFija, opts()).unresolved[0].reason)
      .toContain("no sale a las 14:00");
  });

  it("un componente OPCIONAL sin salida no tumba el paquete", () => {
    const extra = item({ id: "i9", productId: "extra", productName: "Extra", isOptional: true });
    const slots = [slot("saona", "2026-11-10", "07:00")];
    const r = autoResolve([saona, extra], slots, opts());
    expect(r.ok).toBe(true);
    expect(r.blocks).toHaveLength(1);
    // Pero se dice que se quedó fuera: el cliente pagó por un paquete.
    expect(r.unresolved).toHaveLength(1);
  });

  it("un combo de varios días usa el día que le toca a cada componente", () => {
    const dia2 = item({ ...buggy, dayOffset: 1 });
    const slots = [
      slot("saona", "2026-11-10", "07:00"),
      slot("buggy", "2026-11-11", "09:00"),
    ];
    const r = autoResolve([saona, dia2], slots, opts());
    expect(r.ok).toBe(true);
    expect(spanDays(r.blocks)).toBe(2);
  });

  it("al llegar al tope de exploración lo DICE, en vez de fingir que es exhaustivo", () => {
    // Un mostrador con un cliente delante no espera, pero tampoco se le puede
    // decir que no hay nada mejor cuando no se ha mirado.
    const muchos: Slot[] = [];
    const items: BundleItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push(item({ id: `x${i}`, productId: `p${i}`, productName: `P${i}`, durationMin: 30, allowOverlap: true }));
      for (let h = 8; h < 14; h++) muchos.push(slot(`p${i}`, "2026-11-10", `${String(h).padStart(2, "0")}:00`));
    }
    const r = autoResolve(items, muchos, opts({ maxCombinations: 50 }));
    expect(r.truncated).toBe(true);
  });
});

describe("el resumen que ve una persona", () => {
  const saona = item({ id: "i1", productId: "saona", productName: "Saona", durationMin: 600 });
  const buggy = item({ id: "i2", productId: "buggy", productName: "Buggy", durationMin: 180, dayOffset: 1 });

  const bloques = [
    blockOf(buggy, slot("buggy", "2026-11-11", "09:00", 8)),
    blockOf(saona, slot("saona", "2026-11-10", "07:00", 30)),
  ];

  it("agrupa por día y ordena por hora dentro de cada uno", () => {
    const dias = byDay(bloques);
    expect(dias.map((d) => d.day)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(dias[0].blocks[0].productName).toBe("Saona");
  });

  it("las plazas del paquete son las de la actividad MÁS AJUSTADA", () => {
    // De nada sirve que dos actividades tengan 30 plazas si la tercera tiene 8.
    expect(tightestSeats(bloques)).toBe(8);
  });

  it("una actividad sin aforo declarado no baja el techo del paquete", () => {
    const conLibre = [...bloques, blockOf(saona, slot("saona", "2026-11-12", "07:00", null))];
    expect(tightestSeats(conLibre)).toBe(8);
    expect(tightestSeats([blockOf(saona, slot("saona", "2026-11-12", "07:00", null))])).toBeNull();
  });

  it("el paquete empieza en su primera actividad, no en la primera de la lista", () => {
    expect(startsAt(bloques)).toBe("2026-11-10T07:00:00.000Z");
    expect(startsAt([])).toBeNull();
  });
});

describe("qué impide vender el paquete", () => {
  const saona = item({ id: "i1", productId: "saona", productName: "Saona", durationMin: 600 });
  const buggy = item({ id: "i2", productId: "buggy", productName: "Buggy", durationMin: 180 });

  it("un componente sin salida", () => {
    const r = autoResolve([saona, buggy], [slot("saona", "2026-11-10", "07:00")], opts());
    expect(sellBlocker(r, 2)).toContain("no tiene ninguna salida");
  });

  it("un choque de horarios", () => {
    const r = autoResolve([saona, buggy], [
      slot("saona", "2026-11-10", "07:00"),
      slot("buggy", "2026-11-10", "14:00"),
    ], opts());
    expect(sellBlocker(r, 2)).toContain("no da tiempo");
  });

  it("plazas de sobra para dos pero no para el grupo entero", () => {
    // Las candidatas se filtran por `pax`, así que esto se comprueba sobre un
    // itinerario ya resuelto para un grupo menor: es el caso de quien amplía la
    // reserva después.
    const r = autoResolve([saona, buggy], [
      slot("saona", "2026-11-10", "07:00", 30),
      slot("buggy", "2026-11-10", "18:00", 5),
    ], opts({ pax: 2 }));
    expect(r.ok).toBe(true);
    expect(sellBlocker(r, 8)).toContain("Solo quedan 5 plazas");
  });

  it("un paquete que sí se puede vender no da motivo", () => {
    const r = autoResolve([saona, buggy], [
      slot("saona", "2026-11-10", "07:00"),
      slot("buggy", "2026-11-10", "18:00"),
    ], opts());
    expect(sellBlocker(r, 2)).toBeNull();
  });
});
