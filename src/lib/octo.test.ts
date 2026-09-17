import { describe, it, expect } from "vitest";
import {
  parseCapabilities, capabilityCatalog, SUPPORTED_CAPABILITIES,
  localDateTime, localDate, offsetMinutes, utc, isLocalDate,
  unitAges, unitsOf, OCTO_UNITS,
  minorUnits, pricing,
  isOptionModality, optionsOf, cancellationCutoffHours, cutoffLabel, DEFAULT_CANCELLATION_HOURS, DEFAULT_OPTION_ID,
  toOctoProduct,
  availabilityStatus, cutoffAt, toOctoAvailability, toOctoCalendar,
  readReservation, paxOf, seatsOf, holderName, isUuid, newUuid,
  octoStatusOf, canTransition, cancellable, refundKind, toOctoBooking, fullContact,
  holdMinutesFor, MAX_HOLD_MINUTES, DEFAULT_HOLD_MINUTES, MAX_UNIT_ITEMS,
  octoErrorBody, OCTO_ERROR_STATUS,
  type ModalityLike, type ProductLike, type DepartureLike,
} from "@/lib/octo";

/**
 * Una integración con una OTA falla en silencio y se descubre tarde: el
 * revendedor sigue vendiendo con datos que ya no son ciertos, y quien se entera
 * es el cliente en el punto de encuentro. Lo que se prueba aquí son las formas
 * concretas en que eso pasa: la hora sin zona, el precio sin unidad mínima, el
 * estado que dice CANCELLED cuando fue EXPIRED y la plaza que se confirma
 * después de vencida.
 */

const PRODUCTO: ProductLike = {
  _id: "prod-1",
  name: "Isla Saona",
  code: "SAONA",
  short_description: "Día completo con almuerzo",
  duration_hours: 8,
  min_age: 0,
  base_price: 85,
  currency: "usd",
  status: "active",
  published: true,
  location: "Bayahíbe",
};

const SALIDA: DepartureLike = {
  _id: "dep-1",
  departure_at: "2026-11-17T13:00:00.000Z", // 09:00 en Santo Domingo (UTC-4)
  capacity: 40,
  available_pax: 30,
  cutoff_hours: 2,
  status: "available",
};

/* ───────────────────────────────────────────────────────── capacidades ── */

describe("capacidades", () => {
  it("ignora en silencio lo que no soportamos en vez de rechazar la petición", () => {
    // Un revendedor pide todo lo que sabe usar. Fallar aquí dejaría fuera a
    // media industria por pedir algo de más.
    const activas = parseCapabilities("octo/content, octo/pricing, octo/cart, octo/inventado");
    expect(activas).toEqual(["octo/content", "octo/pricing"]);
  });

  it("no anuncia ninguna capacidad que no esté en el catálogo", () => {
    const anunciadas = capabilityCatalog().map((c) => c.id);
    expect(anunciadas).toEqual(SUPPORTED_CAPABILITIES);
  });

  it("sin cabecera no hay capacidades activas", () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities("")).toEqual([]);
  });

  it("no repite una capacidad pedida dos veces", () => {
    expect(parseCapabilities("octo/pricing,octo/pricing")).toEqual(["octo/pricing"]);
  });
});

/* ───────────────────────────────────────────────────────────── fechas ── */

describe("la hora local con su zona", () => {
  it("lleva el desplazamiento, no la hora pelada", () => {
    // Sin el offset, el revendedor interpreta la hora en SU zona y le enseña al
    // cliente una salida a las 3 de la mañana.
    const local = localDateTime("2026-11-17T13:00:00.000Z", "America/Santo_Domingo");
    expect(local).toBe("2026-11-17T09:00:00-04:00");
  });

  it("respeta el horario de verano de la zona, no una tabla fija", () => {
    const invierno = offsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York");
    const verano = offsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/New_York");
    expect(invierno).toBe(-300);
    expect(verano).toBe(-240);
  });

  it("el día local puede no ser el día UTC", () => {
    // 01:00 UTC del 18 son las 21:00 del 17 en Santo Domingo: el calendario
    // tiene que colgar esa salida del 17, que es cuando el cliente viaja.
    expect(localDate("2026-11-18T01:00:00.000Z", "America/Santo_Domingo")).toBe("2026-11-17");
  });

  it("una zona inválida no revienta la respuesta entera", () => {
    expect(() => localDateTime("2026-11-17T13:00:00.000Z", "Marte/Olympus")).not.toThrow();
  });

  it("utc devuelve null para lo vacío y lo inválido", () => {
    expect(utc(null)).toBeNull();
    expect(utc("no es fecha")).toBeNull();
    expect(utc("2026-11-17T13:00:00.000Z")).toBe("2026-11-17T13:00:00.000Z");
  });

  it("isLocalDate acepta el formato corto y nada más", () => {
    expect(isLocalDate("2026-11-17")).toBe(true);
    expect(isLocalDate("2026-11-17T09:00:00")).toBe(false);
    expect(isLocalDate(20261117)).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────────── unidades ── */

describe("unidades", () => {
  it("son exactamente tres, porque son las que la reserva sabe contar", () => {
    expect(OCTO_UNITS.map((u) => u.id)).toEqual(["adult", "child", "infant"]);
  });

  it("el infante no ocupa plaza", () => {
    const unidades = unitsOf(PRODUCTO, []);
    const infante = unidades.find((u) => u.id === "infant");
    expect(infante?.restrictions.paxCount).toBe(0);
    expect(infante?.restrictions.accompaniedBy).toEqual(["adult"]);
  });

  it("toma los tramos de edad de las modalidades cuando la operadora los definió", () => {
    const modalidades: ModalityLike[] = [
      { _id: "m1", name: "Niño", modality_type: "child", age_from: 4, age_to: 10, status: "active" },
    ];
    const edades = unitAges(PRODUCTO, modalidades);
    expect(edades.child).toEqual({ from: 4, to: 10 });
  });

  it("sin modalidades cae en tramos razonables y respeta la edad mínima del producto", () => {
    const edades = unitAges({ ...PRODUCTO, min_age: 6 }, []);
    expect(edades.child.from).toBe(6);
    expect(edades.adult.from).toBe(12);
  });
});

/* ────────────────────────────────────────────────────────────── precio ── */

describe("el precio en unidades mínimas", () => {
  it("25.50 son 2550, no 25.5", () => {
    // El error más caro de estas integraciones: mandar 25.5 vende la excursión
    // por veinticinco centavos.
    expect(minorUnits(25.5)).toBe(2550);
    expect(pricing(25.5, "usd").retail).toBe(2550);
  });

  it("redondea al centavo en vez de arrastrar el error del coma flotante", () => {
    expect(minorUnits(0.1 + 0.2)).toBe(30);
    expect(minorUnits(85.005)).toBe(8501);
  });

  it("la moneda sale en mayúsculas, como pide el estándar", () => {
    expect(pricing(10, "dop").currency).toBe("DOP");
  });
});

/* ──────────────────────────────────────────────────────────── opciones ── */

describe("opciones", () => {
  it("adulto, niño e infante NO son opciones: ya viajan como unidades", () => {
    // Si lo fueran, el revendedor podría pedir «opción: niño, unidad: adulto»,
    // que no significa nada y que el motor de precios resolvería en silencio.
    expect(isOptionModality({ _id: "m", modality_type: "child", status: "active" })).toBe(false);
    expect(isOptionModality({ _id: "m", modality_type: "adult", status: "active" })).toBe(false);
    expect(isOptionModality({ _id: "m", modality_type: "vip", status: "active" })).toBe(true);
  });

  it("una modalidad inactiva no se ofrece", () => {
    expect(isOptionModality({ _id: "m", modality_type: "vip", status: "inactive" })).toBe(false);
  });

  it("siempre hay una opción por defecto, aunque el producto no tenga modalidades", () => {
    const opciones = optionsOf({
      product: PRODUCTO, modalities: [], startTimes: ["09:00"],
      cancellationTiers: null, currency: "usd", capabilities: [],
    });
    expect(opciones).toHaveLength(1);
    expect(opciones[0].id).toBe(DEFAULT_OPTION_ID);
    expect(opciones[0].default).toBe(true);
  });

  it("la modalidad de opción se añade a la de por defecto y no la sustituye", () => {
    const opciones = optionsOf({
      product: PRODUCTO,
      modalities: [
        { _id: "m-vip", name: "VIP", modality_type: "vip", price: 150, status: "active", sort_order: 1 },
        { _id: "m-nino", name: "Niño", modality_type: "child", price: 45, status: "active", sort_order: 2 },
      ],
      startTimes: ["09:00"], cancellationTiers: null, currency: "usd", capabilities: ["octo/pricing"],
    });
    expect(opciones.map((o) => o.id)).toEqual([DEFAULT_OPTION_ID, "m-vip"]);
    expect(opciones[1].pricingFrom?.[0].retail).toBe(15000);
  });

  it("sin la capacidad de precios no se manda precio", () => {
    const [opcion] = optionsOf({
      product: PRODUCTO, modalities: [], startTimes: [],
      cancellationTiers: null, currency: "usd", capabilities: [],
    });
    expect(opcion.pricingFrom).toBeUndefined();
    expect(opcion.units[0].pricingFrom).toBeUndefined();
  });

  it("el infante sale a cero aunque el adulto cueste 85", () => {
    const [opcion] = optionsOf({
      product: PRODUCTO, modalities: [], startTimes: [],
      cancellationTiers: null, currency: "usd", capabilities: ["octo/pricing"],
    });
    const infante = opcion.units.find((u) => u.id === "infant");
    expect(infante?.pricingFrom?.[0].retail).toBe(0);
  });
});

describe("el corte de cancelación", () => {
  it("es el tramo más cercano a la salida que todavía devuelve todo", () => {
    const horas = cancellationCutoffHours([
      { hours_before: 72, refund_pct: 100 },
      { hours_before: 24, refund_pct: 100 },
      { hours_before: 12, refund_pct: 50 },
    ]);
    expect(horas).toBe(24);
  });

  it("sin política se contesta el supuesto de la industria", () => {
    expect(cancellationCutoffHours(null)).toBe(DEFAULT_CANCELLATION_HOURS);
    expect(cancellationCutoffHours([{ hours_before: 24, refund_pct: 50 }])).toBe(DEFAULT_CANCELLATION_HOURS);
  });

  it("se expresa en días cuando es múltiplo de 24", () => {
    expect(cutoffLabel(72)).toEqual({ amount: 3, unit: "day", label: "3 days" });
    expect(cutoffLabel(24)).toEqual({ amount: 1, unit: "day", label: "1 day" });
    expect(cutoffLabel(6)).toEqual({ amount: 6, unit: "hour", label: "6 hours" });
    expect(cutoffLabel(0.5)).toEqual({ amount: 30, unit: "minute", label: "30 minutes" });
  });
});

/* ──────────────────────────────────────────────────────────── producto ── */

describe("el producto que ve el revendedor", () => {
  const base = {
    product: PRODUCTO, modalities: [], startTimes: ["09:00"],
    cancellationTiers: null, currency: "usd", capabilities: [] as never[],
    timeZone: "America/Santo_Domingo", locale: "es",
  };

  it("un producto con salidas exige disponibilidad y no es venta libre", () => {
    const octo = toOctoProduct({ ...base, hasDepartures: true });
    expect(octo.availabilityRequired).toBe(true);
    expect(octo.allowFreesale).toBe(false);
  });

  it("un producto SIN salidas es venta libre y no exige disponibilidad", () => {
    // Al revés, el revendedor pide disponibilidad, recibe lista vacía y
    // concluye que la operadora está agotada todo el año.
    const octo = toOctoProduct({ ...base, hasDepartures: false });
    expect(octo.availabilityRequired).toBe(false);
    expect(octo.allowFreesale).toBe(true);
  });

  it("nunca promete confirmación instantánea: el ciclo es retener y confirmar", () => {
    expect(toOctoProduct({ ...base, hasDepartures: true }).instantConfirmation).toBe(false);
  });

  it("sin la capacidad de contenido no manda textos", () => {
    const octo = toOctoProduct({ ...base, hasDepartures: true });
    expect(octo.title).toBeUndefined();
    expect(octo.description).toBeUndefined();
  });

  it("con octo/content manda título, descripción y duración en minutos", () => {
    const octo = toOctoProduct({ ...base, hasDepartures: true, capabilities: ["octo/content"] as never });
    expect(octo.title).toBe("Isla Saona");
    expect(octo.durationMinutesFrom).toBe(480);
  });
});

/* ─────────────────────────────────────────────────────── disponibilidad ── */

describe("el estado de una fecha", () => {
  const ahora = new Date("2026-11-01T12:00:00Z");

  it("LIMITED por debajo de la mitad del cupo, que es el umbral del estándar", () => {
    expect(availabilityStatus({ ...SALIDA, available_pax: 19 }, ahora)).toBe("LIMITED");
    expect(availabilityStatus({ ...SALIDA, available_pax: 20 }, ahora)).toBe("AVAILABLE");
  });

  it("sin plazas es SOLD_OUT y sin capacidad declarada es venta libre", () => {
    expect(availabilityStatus({ ...SALIDA, available_pax: 0 }, ahora)).toBe("SOLD_OUT");
    expect(availabilityStatus({ ...SALIDA, capacity: 0 }, ahora)).toBe("FREESALE");
  });

  it("una salida cancelada o ya pasada está CLOSED", () => {
    expect(availabilityStatus({ ...SALIDA, status: "cancelled" }, ahora)).toBe("CLOSED");
    expect(availabilityStatus(SALIDA, new Date("2026-12-01T00:00:00Z"))).toBe("CLOSED");
  });

  it("el corte respeta las horas de cierre de la salida", () => {
    expect(cutoffAt(SALIDA)).toBe("2026-11-17T11:00:00.000Z");
    expect(cutoffAt({ ...SALIDA, cutoff_hours: 0 })).toBe("2026-11-17T13:00:00.000Z");
  });

  it("la disponibilidad lleva la hora local con zona y el cupo restante", () => {
    const disp = toOctoAvailability({
      departure: SALIDA, durationHours: 8, timeZone: "America/Santo_Domingo",
      currency: "usd", unitPrices: [{ unitId: "adult", amount: 85 }],
      capabilities: ["octo/pricing"], now: ahora,
    });
    expect(disp.localDateTimeStart).toBe("2026-11-17T09:00:00-04:00");
    expect(disp.localDateTimeEnd).toBe("2026-11-17T17:00:00-04:00");
    expect(disp.vacancies).toBe(30);
    expect(disp.available).toBe(true);
    expect(disp.unitPricing?.[0].retail).toBe(8500);
  });

  it("en venta libre las plazas restantes van nulas, nunca cero", () => {
    // Cero significaría agotado y el revendedor dejaría de vender.
    const disp = toOctoAvailability({
      departure: { ...SALIDA, capacity: 0 }, durationHours: 8, timeZone: "America/Santo_Domingo",
      currency: "usd", unitPrices: [], capabilities: [], now: ahora,
    });
    expect(disp.status).toBe("FREESALE");
    expect(disp.vacancies).toBeNull();
  });
});

describe("el calendario", () => {
  const ahora = new Date("2026-11-01T12:00:00Z");

  it("agrupa por día local y devuelve el MÁXIMO de plazas, no la suma", () => {
    // Decir «quedan 30» cuando son 10 en tres horarios hace que un grupo de 20
    // elija ese día y no quepa en ninguna salida.
    const dias = toOctoCalendar(
      [
        { ...SALIDA, _id: "d1", departure_at: "2026-11-17T13:00:00.000Z", available_pax: 10 },
        { ...SALIDA, _id: "d2", departure_at: "2026-11-17T17:00:00.000Z", available_pax: 10 },
        { ...SALIDA, _id: "d3", departure_at: "2026-11-17T21:00:00.000Z", available_pax: 10 },
      ],
      "America/Santo_Domingo",
      { now: ahora }
    );
    expect(dias).toHaveLength(1);
    expect(dias[0].localDate).toBe("2026-11-17");
    expect(dias[0].vacancies).toBe(10);
  });

  it("un día en el que todas las salidas están cerradas sale CLOSED y no disponible", () => {
    const dias = toOctoCalendar(
      [{ ...SALIDA, status: "cancelled" }],
      "America/Santo_Domingo",
      { now: ahora }
    );
    expect(dias[0].status).toBe("CLOSED");
    expect(dias[0].available).toBe(false);
  });

  it("las horas de apertura van del primer horario al último del día", () => {
    const dias = toOctoCalendar(
      [
        { ...SALIDA, _id: "d2", departure_at: "2026-11-17T21:00:00.000Z" },
        { ...SALIDA, _id: "d1", departure_at: "2026-11-17T13:00:00.000Z" },
      ],
      "America/Santo_Domingo",
      { now: ahora }
    );
    expect(dias[0].openingHours).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it("los días salen ordenados aunque lleguen desordenados", () => {
    const dias = toOctoCalendar(
      [
        { ...SALIDA, _id: "b", departure_at: "2026-11-20T13:00:00.000Z" },
        { ...SALIDA, _id: "a", departure_at: "2026-11-17T13:00:00.000Z" },
      ],
      "America/Santo_Domingo",
      { now: ahora }
    );
    expect(dias.map((d) => d.localDate)).toEqual(["2026-11-17", "2026-11-20"]);
  });
});

/* ─────────────────────────────────────────────────────── leer la reserva ── */

describe("leer una reserva del revendedor", () => {
  const cuerpo = {
    uuid: "11111111-1111-4111-8111-111111111111",
    productId: "prod-1",
    optionId: "default",
    availabilityId: "dep-1",
    unitItems: [{ unitId: "adult" }, { unitId: "adult" }, { unitId: "infant" }],
    contact: { firstName: "Ana", lastName: "Pérez", emailAddress: "ana@ejemplo.com" },
  };

  it("acepta una reserva bien formada", () => {
    const leido = readReservation(cuerpo);
    expect(leido.ok).toBe(true);
    if (leido.ok === true) {
      expect(leido.input.unitItems).toHaveLength(3);
      expect(leido.input.expirationMinutes).toBe(DEFAULT_HOLD_MINUTES);
    }
  });

  it("le pone uuid a la reserva y a cada unidad cuando el revendedor no lo manda", () => {
    const leido = readReservation({ ...cuerpo, uuid: undefined, unitItems: [{ unitId: "adult" }] });
    expect(leido.ok).toBe(true);
    if (leido.ok === true) {
      expect(isUuid(leido.input.uuid)).toBe(true);
      expect(isUuid(leido.input.unitItems[0].uuid)).toBe(true);
    }
  });

  it("un unitId desconocido es INVALID_UNIT_ID y señala cuál", () => {
    const leido = readReservation({ ...cuerpo, unitItems: [{ unitId: "senior" }] });
    expect(leido.ok).toBe(false);
    if (leido.ok === false) {
      expect(leido.problem.code).toBe("INVALID_UNIT_ID");
      expect(leido.problem.pointer?.unitId).toBe("senior");
    }
  });

  it("sin viajeros no hay reserva", () => {
    const leido = readReservation({ ...cuerpo, unitItems: [] });
    expect(leido.ok).toBe(false);
    if (leido.ok === false) expect(leido.problem.code).toBe("BAD_REQUEST");
  });

  it("un grupo desmedido se rechaza como no procesable, no como error de sintaxis", () => {
    const leido = readReservation({
      ...cuerpo,
      unitItems: Array.from({ length: MAX_UNIT_ITEMS + 1 }, () => ({ unitId: "adult" })),
    });
    expect(leido.ok).toBe(false);
    if (leido.ok === false) expect(leido.problem.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("falta el producto o la opción y lo dice con el código del estándar", () => {
    const sinProducto = readReservation({ ...cuerpo, productId: undefined });
    const sinOpcion = readReservation({ ...cuerpo, optionId: undefined });
    expect(sinProducto.ok === false && sinProducto.problem.code).toBe("INVALID_PRODUCT_ID");
    expect(sinOpcion.ok === false && sinOpcion.problem.code).toBe("INVALID_OPTION_ID");
  });

  it("un uuid que no es uuid se rechaza en vez de guardarse", () => {
    const leido = readReservation({ ...cuerpo, uuid: "GYG-88213" });
    expect(leido.ok).toBe(false);
    if (leido.ok === false) expect(leido.problem.code).toBe("INVALID_BOOKING_UUID");
  });

  it("recorta la retención al techo del estándar, no la acepta tal cual", () => {
    const leido = readReservation({ ...cuerpo, expirationMinutes: 99999 });
    expect(leido.ok === true && leido.input.expirationMinutes).toBe(MAX_HOLD_MINUTES);
  });

  it("ignora el precio aunque venga en el cuerpo", () => {
    // Una llave de API que además pudiera poner el precio sería una contraseña
    // que regala el margen de la operadora.
    const leido = readReservation({ ...cuerpo, pricing: { retail: 1 }, currency: "eur" });
    expect(leido.ok).toBe(true);
    if (leido.ok === true) {
      expect(Object.keys(leido.input)).not.toContain("pricing");
      expect(Object.keys(leido.input)).not.toContain("currency");
    }
  });

  it("un cuerpo que no es objeto no revienta", () => {
    expect(readReservation(null).ok).toBe(false);
    expect(readReservation("texto").ok).toBe(false);
  });
});

describe("contar viajeros", () => {
  const items = [{ unitId: "adult" }, { unitId: "adult" }, { unitId: "child" }, { unitId: "infant" }];

  it("reparte por tramo", () => {
    expect(paxOf(items)).toEqual({ adults: 2, children: 1, infants: 1 });
  });

  it("las plazas no cuentan al infante", () => {
    // Si contara, una madre con bebé no cabría en una salida con una plaza.
    expect(seatsOf(items)).toBe(3);
  });

  it("el titular sale del contacto de la reserva y, si no, del primer viajero", () => {
    expect(holderName({ fullName: "Ana Pérez" }, [])).toBe("Ana Pérez");
    expect(holderName({ firstName: "Ana", lastName: "Pérez" }, [])).toBe("Ana Pérez");
    expect(holderName(null, [{ uuid: "u", unitId: "adult", resellerReference: null, contact: { fullName: "Luis" } }]))
      .toBe("Luis");
    expect(holderName(null, [])).toBe("Cliente OTA");
  });

  it("newUuid genera uuids válidos y distintos", () => {
    const a = newUuid(), b = newUuid();
    expect(isUuid(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});

/* ────────────────────────────────────────────────── estado de la reserva ── */

describe("el estado que se le contesta al revendedor", () => {
  const ahora = new Date("2026-11-01T12:00:00Z");

  it("una retención vencida es EXPIRED aunque la columna siga diciendo ON_HOLD", () => {
    // El revendedor tiene que poder volver a vender esa plaza sin esperar a
    // nuestro cron de barrido.
    expect(octoStatusOf({
      stored: "ON_HOLD", internal: "pending_payment",
      holdUntil: "2026-11-01T11:00:00Z", now: ahora,
    })).toBe("EXPIRED");
  });

  it("una retención viva sigue siendo ON_HOLD", () => {
    expect(octoStatusOf({
      stored: "ON_HOLD", internal: "pending_payment",
      holdUntil: "2026-11-01T13:00:00Z", now: ahora,
    })).toBe("ON_HOLD");
  });

  it("EXPIRED y CANCELLED no se confunden, que es la diferencia que le importa a una OTA", () => {
    // Vencida por tiempo: es suya, no hay incidencia.
    expect(octoStatusOf({ stored: "EXPIRED", internal: "cancelled", holdUntil: null, now: ahora })).toBe("EXPIRED");
    // Cancelada de verdad: hay que decidir reembolso.
    expect(octoStatusOf({ stored: "CONFIRMED", internal: "cancelled", holdUntil: null, now: ahora })).toBe("CANCELLED");
  });

  it("una cancelación de mostrador le llega al revendedor aunque la columna diga CONFIRMED", () => {
    expect(octoStatusOf({ stored: "CONFIRMED", internal: "refunded", holdUntil: null, now: ahora })).toBe("CANCELLED");
  });

  it("embarcado es REDEEMED, que es lo que cierra la liquidación", () => {
    expect(octoStatusOf({ stored: "CONFIRMED", internal: "checked_in", holdUntil: null, now: ahora })).toBe("REDEEMED");
    expect(octoStatusOf({ stored: "CONFIRMED", internal: "completed", holdUntil: null, now: ahora })).toBe("REDEEMED");
  });

  it("pagada por dentro es CONFIRMED aunque nadie llamara a confirm", () => {
    expect(octoStatusOf({ stored: null, internal: "paid", holdUntil: null, now: ahora })).toBe("CONFIRMED");
  });
});

describe("transiciones", () => {
  it("no se confirma una reserva vencida", () => {
    // La plaza ya volvió a la venta y puede haberla comprado otro.
    const veredicto = canTransition("EXPIRED", "confirm");
    expect(veredicto.ok).toBe(false);
    expect(veredicto.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("confirmar dos veces no es un error: el revendedor reintenta", () => {
    expect(canTransition("CONFIRMED", "confirm").ok).toBe(true);
  });

  it("cancelar lo ya cancelado tampoco lo es", () => {
    expect(canTransition("CANCELLED", "cancel").ok).toBe(true);
  });

  it("una reserva embarcada no se cancela", () => {
    const veredicto = canTransition("REDEEMED", "cancel");
    expect(veredicto.ok).toBe(false);
    expect(veredicto.message).toContain("ya se usó");
  });

  it("solo se prorroga o se modifica lo que está retenido", () => {
    expect(canTransition("ON_HOLD", "extend").ok).toBe(true);
    expect(canTransition("CONFIRMED", "extend").ok).toBe(false);
    expect(canTransition("CONFIRMED", "update").ok).toBe(false);
  });
});

describe("cancelable y reembolso", () => {
  const ahora = new Date("2026-11-01T12:00:00Z");

  it("deja de ser cancelable dentro del corte de la política", () => {
    expect(cancellable("CONFIRMED", "2026-11-03T12:00:00Z", 24, ahora)).toBe(true);
    expect(cancellable("CONFIRMED", "2026-11-01T20:00:00Z", 24, ahora)).toBe(false);
  });

  it("lo ya cancelado o embarcado no es cancelable", () => {
    expect(cancellable("CANCELLED", "2026-12-01T00:00:00Z", 24, ahora)).toBe(false);
    expect(cancellable("REDEEMED", "2026-12-01T00:00:00Z", 24, ahora)).toBe(false);
  });

  it("clasifica el reembolso como el estándar espera", () => {
    expect(refundKind(0, 100)).toBe("NONE");
    expect(refundKind(50, 100)).toBe("PARTIAL");
    expect(refundKind(100, 100)).toBe("FULL");
  });
});

describe("la reserva tal como la ve el revendedor", () => {
  const base = {
    bookingId: "b1", uuid: "11111111-1111-4111-8111-111111111111", testMode: false,
    resellerReference: "GYG-88213", supplierReference: "RES-0001",
    status: "CONFIRMED" as const,
    createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:05:00Z",
    holdUntil: null, redeemedAt: null, confirmedAt: "2026-11-01T10:05:00Z",
    productId: "prod-1", optionId: "default", availabilityId: "dep-1", availability: null,
    contact: { firstName: "Ana", lastName: "Pérez" }, notes: null,
    unitItems: [
      { uuid: "u1", unitId: "adult", resellerReference: null, contact: null },
      { uuid: "u2", unitId: "infant", resellerReference: null, contact: null },
    ],
    travelDate: "2026-11-17T13:00:00Z", cutoffHours: 24,
    cancelledAt: null, cancelReason: null, refundAmount: 0, paidAmount: 170, totalAmount: 170,
    currency: "usd", voucherUrl: "https://ejemplo.test/v/abc",
    capabilities: ["octo/pricing"] as never,
    now: new Date("2026-11-01T12:00:00Z"),
  };

  it("devuelve los unitItems que mandó el revendedor, con sus uuids", () => {
    // Imprime un ticket por unidad: si se le devuelven otros uuids, no puede
    // casarlos con los suyos.
    const vista = toOctoBooking(base);
    expect(vista.unitItems.map((u) => u.uuid)).toEqual(["u1", "u2"]);
  });

  it("la retención solo se anuncia cuando la reserva está retenida", () => {
    expect(toOctoBooking(base).utcExpiresAt).toBeNull();
    expect(toOctoBooking({ ...base, status: "ON_HOLD", holdUntil: "2026-11-01T13:00:00Z" }).utcExpiresAt)
      .toBe("2026-11-01T13:00:00.000Z");
  });

  it("el voucher solo existe cuando hay algo que canjear", () => {
    expect(toOctoBooking({ ...base, status: "ON_HOLD" }).voucher).toBeNull();
    expect(toOctoBooking(base).voucher?.deliveryOptions[0].deliveryValue).toBe("https://ejemplo.test/v/abc");
  });

  it("la cancelación lleva el tipo de reembolso y el motivo", () => {
    const vista = toOctoBooking({
      ...base, status: "CANCELLED", cancelledAt: "2026-11-02T09:00:00Z",
      cancelReason: "El cliente no viaja", refundAmount: 170,
    });
    expect(vista.cancellation).toEqual({
      refund: "FULL", reason: "El cliente no viaja", utcCancelledAt: "2026-11-02T09:00:00.000Z",
    });
  });

  it("el infante va a cero en el desglose por unidad", () => {
    const vista = toOctoBooking(base);
    expect(vista.unitItems.find((u) => u.unitId === "infant")?.pricing?.retail).toBe(0);
    expect(vista.pricing?.retail).toBe(17000);
  });

  it("sin la capacidad de precios no se manda precio en ningún nivel", () => {
    const vista = toOctoBooking({ ...base, capabilities: [] as never });
    expect(vista.pricing).toBeUndefined();
    expect(vista.unitItems[0].pricing).toBeUndefined();
  });

  it("el contacto sale completo aunque llegue a medias", () => {
    const contacto = fullContact({ firstName: "Ana", lastName: "Pérez" });
    expect(contacto.fullName).toBe("Ana Pérez");
    expect(contacto.locales).toEqual([]);
    expect(contacto.emailAddress).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────── retención ── */

describe("el techo de retención", () => {
  it("una semana pedida se recorta al máximo de la operadora", () => {
    // Siete días con plazas bloqueadas sin cobro es regalar el inventario.
    expect(holdMinutesFor(10080, 60)).toBe(60);
  });

  it("sin máximo configurado se usa el del dominio", () => {
    expect(holdMinutesFor(10080, null)).toBe(MAX_HOLD_MINUTES);
  });

  it("lo que se pide por debajo del techo se respeta", () => {
    expect(holdMinutesFor(15, 60)).toBe(15);
  });

  it("nunca baja de un minuto", () => {
    expect(holdMinutesFor(0, 60)).toBe(DEFAULT_HOLD_MINUTES);
    expect(holdMinutesFor(-5, 1)).toBe(1);
  });
});

/* ───────────────────────────────────────────────────────────── errores ── */

describe("errores del estándar", () => {
  it("cada código viaja con su código HTTP", () => {
    expect(OCTO_ERROR_STATUS.UNAUTHORIZED).toBe(401);
    expect(OCTO_ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(OCTO_ERROR_STATUS.UNPROCESSABLE_ENTITY).toBe(422);
    expect(OCTO_ERROR_STATUS.INVALID_PRODUCT_ID).toBe(400);
  });

  it("el cuerpo lleva el campo señalado cuando lo hay", () => {
    const cuerpo = octoErrorBody("INVALID_OPTION_ID", "No existe", { productId: "p1", optionId: "o9" });
    expect(cuerpo).toEqual({ error: "INVALID_OPTION_ID", errorMessage: "No existe", productId: "p1", optionId: "o9" });
  });
});
