import { describe, it, expect } from "vitest";
import {
  DEFAULT_DURATION_HOURS, VEHICLE_DOC_WARNING_DAYS,
  durationHours, departureWindow, resourceWindow, windowsOverlap,
  assignmentIsLive, resourceConflicts,
  vehicleBlock, vehicleWarnings, vehicleLabel,
  pickupOffsetMin, plannedPickupTime, pickupDiscrepancy,
  type ResourceUse,
} from "@/lib/dispatch";

/**
 * Lo que se prueba aquí es la mañana del despacho.
 *
 * Cada caso corresponde a algo que se paga en el muelle: una guagua marcada en
 * rojo sin motivo hasta que nadie mira los avisos, un choque real que pasa
 * desapercibido entre esas falsas alarmas, un vehículo sin seguro cargado de
 * turistas, y un cliente esperando en un lobby a una hora que nadie calculó.
 */

const TZ = "America/Santo_Domingo";
const HOY = "2026-09-16";

/** Santo Domingo está en UTC−4 todo el año: las 08:00 locales son las 12:00Z. */
const local = (dia: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${dia}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
};

describe("la ventana que ocupa una salida", () => {
  it("dura lo que dice el producto", () => {
    expect(durationHours({ product: { duration_hours: 4 } })).toBe(4);
  });

  it("cae al día completo cuando el producto no lo dice", () => {
    expect(durationHours({ product: { name: "Saona" } })).toBe(DEFAULT_DURATION_HOURS);
    expect(durationHours({})).toBe(DEFAULT_DURATION_HOURS);
  });

  it("ignora una duración absurda en vez de producir una ventana vacía", () => {
    expect(durationHours({ duration_hours: 0 })).toBe(DEFAULT_DURATION_HOURS);
    expect(durationHours({ duration_hours: -3 })).toBe(DEFAULT_DURATION_HOURS);
  });

  it("una salida sin hora no tiene ventana, y no una que empiece en 1970", () => {
    expect(departureWindow({ departure_at: null })).toBeNull();
    expect(departureWindow({ departure_at: "mañana temprano" })).toBeNull();
  });

  it("la ventana va de la salida a la salida más su duración", () => {
    const v = departureWindow({ departure_at: local(HOY, "08:00"), duration_hours: 5 })!;
    expect(v.end - v.start).toBe(5 * 3_600_000);
  });
});

describe("la ventana de un recurso dentro de la salida", () => {
  const salida = departureWindow({ departure_at: local(HOY, "08:00"), duration_hours: 8 })!;

  it("sin horas propias, ocupa la salida entera", () => {
    expect(resourceWindow({}, salida, TZ)).toEqual(salida);
  });

  it("con horas propias, ocupa solo las suyas", () => {
    const v = resourceWindow({ start_time: "08:00", end_time: "09:00" }, salida, TZ);
    expect(v.start).toBe(salida.start);
    expect(v.end - v.start).toBe(3_600_000);
  });

  it("las horas se leen en la zona de la empresa, no en UTC", () => {
    // Si se leyeran en UTC, «08:00» caería cuatro horas antes de la salida.
    const v = resourceWindow({ start_time: "08:00" }, salida, TZ);
    expect(v.start).toBe(salida.start);
  });

  it("una hora de fin anterior a la de inicio se descarta, no invierte la ventana", () => {
    // Una ventana invertida no solaparía con nada: el recurso desaparecería de
    // la detección de choques sin que nadie se entere.
    const v = resourceWindow({ start_time: "14:00", end_time: "09:00" }, salida, TZ);
    expect(v).toEqual(salida);
    expect(v.end).toBeGreaterThan(v.start);
  });

  it("una hora que no es una hora no rompe nada", () => {
    expect(resourceWindow({ start_time: "cuando llegue" }, salida, TZ)).toEqual(salida);
    expect(resourceWindow({ start_time: "99:99" }, salida, TZ)).toEqual(salida);
  });
});

describe("dos ventanas se pisan o no", () => {
  const a = { start: 100, end: 200 };

  it("se pisan cuando comparten cualquier instante", () => {
    expect(windowsOverlap(a, { start: 150, end: 250 })).toBe(true);
    expect(windowsOverlap({ start: 150, end: 250 }, a)).toBe(true);
  });

  it("tocarse en el borde NO es pisarse: es el relevo de siempre", () => {
    expect(windowsOverlap(a, { start: 200, end: 300 })).toBe(false);
    expect(windowsOverlap({ start: 0, end: 100 }, a)).toBe(false);
  });

  it("una dentro de otra sí se pisan", () => {
    expect(windowsOverlap(a, { start: 120, end: 130 })).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

const uso = (
  resourceId: string,
  departureId: string,
  desde: string,
  hasta: string,
  kind: "staff" | "vehicle" = "vehicle"
): ResourceUse => ({
  kind,
  resourceId,
  resourceName: resourceId === "bus-1" ? "Guagua 1" : resourceId,
  departureId,
  departureLabel: `${departureId} ${desde}`,
  window: { start: Date.parse(local(HOY, desde)), end: Date.parse(local(HOY, hasta)) },
});

describe("los choques del día son los que se pisan de verdad", () => {
  it("la guagua de la mañana y la de la tarde NO es un conflicto", () => {
    // Este es el caso que marcaba en rojo todos los días de la operación.
    const choques = resourceConflicts([
      uso("bus-1", "saona", "08:00", "14:00"),
      uso("bus-1", "catalina", "15:00", "19:00"),
    ]);
    expect(choques).toEqual([]);
  });

  it("dos salidas que se solapan sí lo es, y dice cuáles", () => {
    const choques = resourceConflicts([
      uso("bus-1", "saona", "08:00", "16:00"),
      uso("bus-1", "catalina", "14:00", "19:00"),
    ]);
    expect(choques).toHaveLength(1);
    expect(choques[0].departureIds.sort()).toEqual(["catalina", "saona"]);
    expect(choques[0].message).toContain("Guagua 1");
    expect(choques[0].message).toContain("se pisan");
  });

  it("el mismo recurso repetido DENTRO de una salida no es un choque de agenda", () => {
    const choques = resourceConflicts([
      uso("bus-1", "saona", "08:00", "16:00"),
      uso("bus-1", "saona", "08:00", "16:00"),
    ]);
    expect(choques).toEqual([]);
  });

  it("un recurso en cuatro salidas que se pisan produce UN aviso, no seis", () => {
    const choques = resourceConflicts([
      uso("bus-1", "a", "08:00", "18:00"),
      uso("bus-1", "b", "09:00", "18:00"),
      uso("bus-1", "c", "10:00", "18:00"),
      uso("bus-1", "d", "11:00", "18:00"),
    ]);
    expect(choques).toHaveLength(1);
    expect(choques[0].departureIds).toHaveLength(4);
  });

  it("una persona y un vehículo con el mismo identificador no se confunden", () => {
    const choques = resourceConflicts([
      uso("x", "saona", "08:00", "16:00", "vehicle"),
      uso("x", "catalina", "14:00", "19:00", "staff"),
    ]);
    expect(choques).toEqual([]);
  });

  it("un recurso sin identificador se ignora en vez de agruparse con los demás", () => {
    const choques = resourceConflicts([
      uso("", "saona", "08:00", "16:00"),
      uso("", "catalina", "14:00", "19:00"),
    ]);
    expect(choques).toEqual([]);
  });

  it("una asignación cancelada ya no ocupa al recurso", () => {
    expect(assignmentIsLive({ status: "cancelled" })).toBe(false);
    expect(assignmentIsLive({ status: "planned" })).toBe(true);
    expect(assignmentIsLive({})).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("el vehículo que no puede salir", () => {
  const bus = { name: "Guagua 1", plate: "A123456", status: "available" };

  it("con los papeles al día, sale", () => {
    expect(vehicleBlock({ ...bus, insurance_expiry: "2027-01-01", inspection_expiry: "2027-01-01" }, HOY)).toBeNull();
  });

  it("con el seguro vencido, NO sale", () => {
    const bloqueo = vehicleBlock({ ...bus, insurance_expiry: "2026-09-15" }, HOY);
    expect(bloqueo?.kind).toBe("insurance");
    expect(bloqueo?.reason).toContain("A123456");
  });

  it("con la inspección vencida, NO sale", () => {
    expect(vehicleBlock({ ...bus, inspection_expiry: "2026-01-01" }, HOY)?.kind).toBe("inspection");
  });

  it("el día del vencimiento todavía cubre: una póliza que vence el 16 vale el 16", () => {
    expect(vehicleBlock({ ...bus, insurance_expiry: HOY }, HOY)).toBeNull();
  });

  it("un papel a punto de vencer avisa pero NO bloquea", () => {
    // Bloquear por «vence en tres semanas» dejaría la operadora sin flota un
    // lunes cualquiera.
    const pronto = new Date(Date.parse(`${HOY}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(vehicleBlock({ ...bus, insurance_expiry: pronto }, HOY)).toBeNull();
    expect(vehicleWarnings({ ...bus, insurance_expiry: pronto }, HOY)).toContain("Seguro vence en 10 días");
  });

  it("en mantenimiento o fuera de servicio, NO sale", () => {
    expect(vehicleBlock({ ...bus, status: "maintenance" }, HOY)?.kind).toBe("status");
    expect(vehicleBlock({ ...bus, status: "out_of_service" }, HOY)?.kind).toBe("status");
    expect(vehicleBlock({ ...bus, status: "in_service" }, HOY)).toBeNull();
  });

  it("sin fechas de papeles no se inventa un bloqueo", () => {
    // Una operadora que todavía no cargó los seguros no puede quedarse sin
    // flota por eso; el hueco se avisa donde se carga el dato, no aquí.
    expect(vehicleBlock(bus, HOY)).toBeNull();
    expect(vehicleWarnings(bus, HOY)).toEqual([]);
  });

  it("avisa justo en el borde de la ventana y no un día antes", () => {
    const borde = new Date(Date.parse(`${HOY}T00:00:00Z`) + VEHICLE_DOC_WARNING_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    const fuera = new Date(Date.parse(`${HOY}T00:00:00Z`) + (VEHICLE_DOC_WARNING_DAYS + 1) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(vehicleWarnings({ ...bus, inspection_expiry: borde }, HOY)).toHaveLength(1);
    expect(vehicleWarnings({ ...bus, inspection_expiry: fuera }, HOY)).toEqual([]);
  });

  it("se nombra con lo que tenga: nombre, placa, o ambos", () => {
    expect(vehicleLabel({ name: "Guagua 1", plate: "A1" })).toBe("Guagua 1 (A1)");
    expect(vehicleLabel({ plate: "A1" })).toBe("A1");
    expect(vehicleLabel({})).toBe("Vehículo");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("la hora de recogida deja de ser un texto suelto", () => {
  it("el hotel manda sobre su zona", () => {
    expect(pickupOffsetMin({ pickup_offset_min: 45 }, { pickup_offset_min: 75 })).toBe(45);
  });

  it("sin desfase propio, hereda el de la zona", () => {
    expect(pickupOffsetMin({ name: "Hotel sin desfase" }, { pickup_offset_min: 75 })).toBe(75);
  });

  it("un cero puesto a propósito en el hotel gana sobre la zona", () => {
    // Cero significa «se recoge en el punto de salida»: es una decisión, no un
    // hueco, y heredar la zona la borraría.
    expect(pickupOffsetMin({ pickup_offset_min: 0 }, { pickup_offset_min: 75 })).toBe(0);
  });

  it("sin ninguno de los dos devuelve null, no un cero fabricado", () => {
    expect(pickupOffsetMin({}, {})).toBeNull();
    expect(pickupOffsetMin(null, null)).toBeNull();
  });

  it("calcula la hora en la zona de la empresa, no en UTC", () => {
    // La salida de las 08:00 de Santo Domingo son las 12:00Z. Calculado en UTC,
    // el conductor leería 11:00 para un hotel al que llega a las 07:00.
    expect(plannedPickupTime(local(HOY, "08:00"), 60, TZ)).toBe("07:00");
  });

  it("cruza la medianoche sin romperse", () => {
    expect(plannedPickupTime(local(HOY, "00:30"), 60, TZ)).toBe("23:30");
  });

  it("sin desfase no calcula nada", () => {
    expect(plannedPickupTime(local(HOY, "08:00"), null, TZ)).toBeNull();
  });

  it("una salida sin hora válida no produce una hora", () => {
    expect(plannedPickupTime("cuando sea", 60, TZ)).toBeNull();
    expect(plannedPickupTime(null, 60, TZ)).toBeNull();
  });
});

describe("lo prometido al cliente y lo que calcula el motor", () => {
  it("callan cuando coinciden", () => {
    expect(pickupDiscrepancy("07:15", "07:15")).toBeNull();
  });

  it("callan cuando todavía no se prometió nada", () => {
    expect(pickupDiscrepancy(null, "07:15")).toBeNull();
    expect(pickupDiscrepancy("", "07:15")).toBeNull();
  });

  it("avisan cuando difieren, nombrando las dos horas", () => {
    const aviso = pickupDiscrepancy("07:15", "07:00")!;
    expect(aviso).toContain("07:15");
    expect(aviso).toContain("07:00");
  });

  it("no confunde «07:15» con «07:15:00»", () => {
    expect(pickupDiscrepancy("07:15:00", "07:15")).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

import { buildRoutes } from "@/lib/dispatch";

/**
 * Armar el día es la tarea que hoy se hace a mano en una libreta, y donde se
 * cometen los errores caros: el cliente al que nadie pasó a buscar, la guagua
 * con más gente de la que cabe, la familia repartida en dos vehículos.
 */
const SALIDA = { _id: "saona", departure_at: local(HOY, "08:00"), product: { duration_hours: 8 } };

const hotel = (id: string, zona: string | null, offset?: number) => ({
  _id: id, name: `Hotel ${id}`, pickup_point: `Lobby ${id}`,
  zone: zona ? { _id: zona, name: `Zona ${zona}` } : null,
  ...(offset === undefined ? {} : { pickup_offset_min: offset }),
});

const recogida = (id: string, hotelId: string, pax: number, extra: Record<string, unknown> = {}) => ({
  _id: id, hotel: { _id: hotelId }, pax, ...extra,
});

const armar = (over: Partial<Parameters<typeof buildRoutes>[0]> = {}) =>
  buildRoutes({
    departure: SALIDA,
    pickups: [],
    hotels: [],
    zones: [],
    vehicles: [],
    timeZone: TZ,
    today: HOY,
    ...over,
  });

describe("armar las rutas del día", () => {
  const hoteles = [hotel("lejos", "este", 90), hotel("cerca", "este", 30), hotel("otra", "oeste", 60)];
  const zonas = [{ _id: "este", name: "Zona este" }, { _id: "oeste", name: "Zona oeste" }];

  it("agrupa por zona: una ruta por zona", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas,
      pickups: [recogida("p1", "lejos", 2), recogida("p2", "otra", 2)],
    });
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.zoneName).sort()).toEqual(["Zona este", "Zona oeste"]);
  });

  it("dentro de la zona ordena por hora: el más lejano es la primera parada", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas,
      pickups: [recogida("cercano", "cerca", 2), recogida("lejano", "lejos", 2)],
    });
    const ruta = routes.find((r) => r.zoneId === "este")!;
    expect(ruta.stops.map((s) => s.pickupId)).toEqual(["lejano", "cercano"]);
    expect(ruta.stops.map((s) => s.sequence)).toEqual([1, 2]);
    expect(ruta.stops[0].plannedTime).toBe("06:30");  // 08:00 − 90 min
    expect(ruta.stops[1].plannedTime).toBe("07:30");  // 08:00 − 30 min
  });

  it("la hora de la ruta es la de su primera parada", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas, pickups: [recogida("p1", "lejos", 2)],
    });
    expect(routes[0].startTime).toBe("06:30");
  });

  it("los contadores de la ruta se derivan, no se teclean", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas,
      pickups: [recogida("p1", "lejos", 3), recogida("p2", "cerca", 4)],
    });
    const ruta = routes.find((r) => r.zoneId === "este")!;
    expect(ruta.paxTotal).toBe(7);
    expect(ruta.stopsCount).toBe(2);
  });

  it("una recogida cancelada o no presentada no se va a buscar", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas,
      pickups: [
        recogida("viva", "lejos", 2),
        recogida("cancelada", "cerca", 2, { status: "cancelled" }),
        recogida("ausente", "cerca", 2, { status: "no_show" }),
      ],
    });
    expect(routes.flatMap((r) => r.stops.map((s) => s.pickupId))).toEqual(["viva"]);
  });

  it("un hotel sin zona no se pierde: va a «Sin zona»", () => {
    // Perderlo sería dejar al cliente esperando en el lobby sin que nadie lo
    // sepa, que es exactamente el error que esta pantalla existe para evitar.
    const { routes } = armar({
      hotels: [hotel("huerfano", null, 45)], zones: [],
      pickups: [recogida("p1", "huerfano", 2)],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].zoneName).toBe("Sin zona");
    expect(routes[0].stops[0].plannedTime).toBe("07:15");
  });

  it("el hotel sin margen avisa y su parada queda la última", () => {
    const { routes, warnings } = armar({
      hotels: [hotel("sinmargen", "este"), hotel("lejos", "este", 90)],
      zones: zonas,
      pickups: [recogida("sin", "sinmargen", 2), recogida("con", "lejos", 2)],
    });
    expect(warnings.join(" ")).toContain("No se sabe a qué hora pasar por Hotel sinmargen");
    expect(routes[0].stops.map((s) => s.pickupId)).toEqual(["con", "sin"]);
  });
});

describe("armar las rutas respetando los vehículos que hay", () => {
  const hoteles = [hotel("a", "este", 90), hotel("b", "este", 60), hotel("c", "este", 30)];
  const zonas = [{ _id: "este", name: "Zona este" }];
  const bus = (id: string, capacity: number, extra: Record<string, unknown> = {}) =>
    ({ _id: id, name: id, capacity, status: "available", ...extra });

  it("parte la zona cuando no cabe en el vehículo", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas, vehicles: [bus("mini", 4)],
      pickups: [recogida("p1", "a", 3), recogida("p2", "b", 3)],
    });
    expect(routes).toHaveLength(2);
    expect(routes[0].paxTotal).toBe(3);
    expect(routes[1].paxTotal).toBe(3);
    expect(routes.map((r) => r.autoKey)).toEqual(["z:este:1", "z:este:2"]);
  });

  it("usa primero el vehículo más grande", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas, vehicles: [bus("mini", 4), bus("grande", 40)],
      pickups: [recogida("p1", "a", 3), recogida("p2", "b", 3)],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].vehicleName).toBe("grande");
  });

  it("el vehículo con el seguro vencido no se propone, y se dice por qué", () => {
    const { routes, warnings } = armar({
      hotels: hoteles, zones: zonas,
      vehicles: [bus("vencido", 40, { insurance_expiry: "2026-01-01", plate: "A1" })],
      pickups: [recogida("p1", "a", 3)],
    });
    expect(routes[0].vehicleId).toBeNull();
    expect(warnings.join(" ")).toContain("seguro vencido");
  });

  it("sin vehículos suficientes NO reparte a la gente en guaguas que no existen", () => {
    // Lo contrario —repartir igual— haría que el problema apareciera en el
    // lobby a las siete de la mañana en vez de en la pantalla la tarde antes.
    const { routes, warnings } = armar({
      hotels: hoteles, zones: zonas, vehicles: [bus("unico", 4)],
      pickups: [recogida("p1", "a", 3), recogida("p2", "b", 3)],
    });
    expect(routes[0].vehicleId).toBe("unico");
    expect(routes[1].vehicleId).toBeNull();
    expect(routes[1].warnings.join(" ")).toContain("Sin vehículo disponible");
    expect(warnings.join(" ")).toContain("Faltan plazas para 3 pax");
  });

  it("una reserva que no cabe en ninguna guagua no se parte en dos", () => {
    // Partirla repartiría a una familia entre dos vehículos.
    const { routes } = armar({
      hotels: hoteles, zones: zonas, vehicles: [bus("mini", 4)],
      pickups: [recogida("familia", "a", 9)],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].stops).toHaveLength(1);
    expect(routes[0].paxTotal).toBe(9);
    expect(routes[0].warnings.join(" ")).toContain("no cabe");
  });

  it("sin vehículos no se parte por un límite inventado", () => {
    // Paradas pequeñas a propósito: con paradas grandes, cualquier límite
    // inventado lo absorbería la rama de «esta sola no cabe» y la prueba daría
    // verde con el corte puesto. Quince y quince caben en casi cualquier
    // límite fabricado, así que si se parte es porque hay uno.
    const { routes } = armar({
      hotels: hoteles, zones: zonas, vehicles: [],
      pickups: [recogida("p1", "a", 15), recogida("p2", "b", 15)],
    });
    expect(routes).toHaveLength(1);
    expect(routes[0].paxTotal).toBe(30);
  });

  it("un vehículo sin capacidad declarada tampoco parte la ruta", () => {
    const { routes } = armar({
      hotels: hoteles, zones: zonas, vehicles: [bus("sincapacidad", 0)],
      pickups: [recogida("p1", "a", 15), recogida("p2", "b", 15)],
    });
    expect(routes).toHaveLength(1);
  });

  it("dos zonas consumen vehículos distintos", () => {
    const { routes } = armar({
      hotels: [hotel("a", "este", 90), hotel("z", "oeste", 60)],
      zones: [{ _id: "este", name: "Zona este" }, { _id: "oeste", name: "Zona oeste" }],
      vehicles: [bus("uno", 40), bus("dos", 30)],
      pickups: [recogida("p1", "a", 3), recogida("p2", "z", 3)],
    });
    expect(routes).toHaveLength(2);
    expect(new Set(routes.map((r) => r.vehicleId)).size).toBe(2);
  });
});

describe("armar no pisa lo que el cliente ya tiene prometido", () => {
  it("la hora prometida sobrevive y la diferencia se avisa", () => {
    const { routes } = armar({
      hotels: [hotel("a", "este", 90)], zones: [{ _id: "este", name: "Zona este" }],
      pickups: [recogida("p1", "a", 2, { pickup_time: "06:45" })],
    });
    const parada = routes[0].stops[0];
    expect(parada.promisedTime).toBe("06:45");
    expect(parada.plannedTime).toBe("06:30");
    expect(parada.discrepancy).toContain("06:45");
    expect(routes[0].warnings.join(" ")).toContain("06:30");
  });

  it("cuando coinciden no dice nada", () => {
    const { routes } = armar({
      hotels: [hotel("a", "este", 90)], zones: [{ _id: "este", name: "Zona este" }],
      pickups: [recogida("p1", "a", 2, { pickup_time: "06:30" })],
    });
    expect(routes[0].stops[0].discrepancy).toBeNull();
    // Sin aviso de horas. El de «sin vehículo» sí sale, y debe salir: esta
    // salida no tiene flota asignada.
    expect(routes[0].warnings.filter((w) => w.includes("prometidas"))).toEqual([]);
  });
});

describe("armar el día es repetible", () => {
  it("dos veces seguidas produce exactamente lo mismo", () => {
    // Es lo que permite rehacer el día a media mañana cuando entran reservas
    // nuevas, sin duplicar rutas ni mover a quien ya estaba colocado.
    const entrada = {
      hotels: [hotel("a", "este", 90), hotel("b", "este", 60)],
      zones: [{ _id: "este", name: "Zona este" }],
      vehicles: [{ _id: "bus", name: "bus", capacity: 40, status: "available" }],
      pickups: [recogida("p1", "a", 3), recogida("p2", "b", 3)],
    };
    expect(armar(entrada)).toEqual(armar(entrada));
  });

  it("la huella de la ruta no depende del orden en que lleguen las recogidas", () => {
    const base = {
      hotels: [hotel("a", "este", 90), hotel("b", "este", 60)],
      zones: [{ _id: "este", name: "Zona este" }],
    };
    const ida = armar({ ...base, pickups: [recogida("p1", "a", 3), recogida("p2", "b", 3)] });
    const vuelta = armar({ ...base, pickups: [recogida("p2", "b", 3), recogida("p1", "a", 3)] });
    expect(ida.routes.map((r) => r.autoKey)).toEqual(vuelta.routes.map((r) => r.autoKey));
    expect(ida.routes[0].stops.map((s) => s.pickupId)).toEqual(vuelta.routes[0].stops.map((s) => s.pickupId));
  });
});
