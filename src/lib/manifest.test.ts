import { describe, it, expect } from "vitest";
import {
  personName, pickupMinutes, formatPickupTime, manifestRow, sortByRoute, pickupStops,
  paxSummary, manifestAlerts, closeBlocker, closeTotals, CLOSE_BLOCK_MESSAGE,
} from "@/lib/manifest";

const booking = (over: Record<string, unknown> = {}) => ({
  _id: over._id as string ?? "b1",
  booking_number: "RSV-1",
  adults: 2, children: 0, infants: 0,
  balance_amount: 0,
  checkin_status: "pending",
  customer: { first_name: "Ana", last_name: "Pérez", phone: "809-555-0101", language: "es" },
  ...over,
});

describe("manifiesto — hora de recogida", () => {
  it("entiende las formas en que se teclea una hora", () => {
    expect(pickupMinutes("07:30")).toBe(450);
    expect(pickupMinutes("7:30")).toBe(450);
    expect(pickupMinutes("7.30")).toBe(450);
    expect(pickupMinutes("15:00")).toBe(900);
    expect(pickupMinutes("3:00 pm")).toBe(900);
    expect(pickupMinutes("12:15 am")).toBe(15);
  });

  it("lo que no se entiende no se inventa", () => {
    expect(pickupMinutes("")).toBeNull();
    expect(pickupMinutes("por la mañana")).toBeNull();
    expect(pickupMinutes("25:00")).toBeNull();
    expect(pickupMinutes("07:75")).toBeNull();
  });

  it("se muestra normalizada", () => {
    expect(formatPickupTime("7:05")).toBe("07:05");
    expect(formatPickupTime("7:5")).toBe("07:05");
    // Lo que no se entiende se enseña tal cual: es un dato que alguien escribió.
    expect(formatPickupTime("al amanecer")).toBe("al amanecer");
    expect(formatPickupTime("")).toBe("—");
  });

  it("no acepta a medias una hora con basura detrás", () => {
    // "7:30 y pico" no es una hora: devolver las 07:30 sería inventarse la
    // precisión que el texto no tiene.
    expect(pickupMinutes("7:30 y pico")).toBeNull();
    expect(pickupMinutes("0730")).toBeNull();
  });
});

describe("manifiesto — la fila de una reserva", () => {
  it("resuelve el nombre venga como venga", () => {
    expect(personName({ first_name: "Ana", last_name: "Pérez" })).toBe("Ana Pérez");
    expect(personName({ full_name: "Luis Gómez" })).toBe("Luis Gómez");
    expect(personName({ commercial_name: "Caribe Tours" })).toBe("Caribe Tours");
    expect(personName(null)).toBe("");
    expect(personName("uuid-suelto")).toBe("");
  });

  it("el bebé ocupa asiento aunque no pague", () => {
    // Una furgoneta de 15 con 14 pax y 2 bebés va llena: contar solo los que
    // pagan es como se deja gente en la acera.
    const row = manifestRow(booking({ adults: 2, children: 1, infants: 2 }));
    expect(row.seats).toBe(5);
  });

  it("sin desglose cae al total de pax de la reserva", () => {
    expect(manifestRow({ _id: "b", adults: 0, children: 0, infants: 0, pax_total: 4 }).seats).toBe(4);
  });

  it("prefiere el whatsapp al teléfono fijo: es por donde se avisa un retraso", () => {
    const row = manifestRow(booking({ customer: { first_name: "Ana", phone: "809-1", whatsapp: "829-2" } }));
    expect(row.phone).toBe("829-2");
  });

  it("junta los requerimientos de los acompañantes con la nota de la reserva", () => {
    const row = manifestRow(booking({
      notes: "Cumpleaños",
      participant: [
        { _id: "p1", full_name: "Ana Pérez" },
        { _id: "p2", full_name: "Luis Pérez", special_requirements: "Alérgico al marisco" },
      ],
    }));
    expect(row.requirements).toEqual(["Alérgico al marisco", "Cumpleaños"]);
  });

  it("cuenta los pasajeros que viajan sin nombre", () => {
    // El manifiesto sin nombres no sirve para el seguro ni para la autoridad.
    const row = manifestRow(booking({ adults: 3, participant: [{ _id: "p1", full_name: "Ana Pérez" }] }));
    expect(row.unnamed_pax).toBe(2);
  });

  it("una reserva sin saldo está pagada; un centavo de más, no", () => {
    expect(manifestRow(booking({ balance_amount: 0 })).paid).toBe(true);
    // Ruido por debajo del centavo: sigue pagada.
    expect(manifestRow(booking({ balance_amount: 0.004 })).paid).toBe(true);
    // Un centavo es un centavo: el guía tiene que cobrarlo.
    expect(manifestRow(booking({ balance_amount: 0.01 })).paid).toBe(false);
    expect(manifestRow(booking({ balance_amount: 25 })).paid).toBe(false);
  });

  it("quien vendió: el partner manda sobre el vendedor y el canal", () => {
    expect(manifestRow(booking({ partner: { commercial_name: "Caribe" }, seller: { first_name: "Jose" } }).valueOf() as never).sold_by)
      .toBe("Caribe");
    expect(manifestRow(booking({ channel: "web" })).sold_by).toBe("web");
  });
});

describe("manifiesto — la hoja de ruta", () => {
  const rows = [
    manifestRow(booking({ _id: "b1", pickup_time: "08:15", pickup_hotel: { name: "Riu" } })),
    manifestRow(booking({ _id: "b2", pickup_time: "07:30", pickup_hotel: { name: "Barceló", zone: { name: "Bávaro" } } })),
    manifestRow(booking({ _id: "b3", customer: { first_name: "Zoe" } })),
    manifestRow(booking({ _id: "b4", pickup_time: "7:30", pickup_hotel: { name: "Barceló" } })),
  ];

  it("ordena por hora de recogida, no por orden de venta", () => {
    expect(sortByRoute(rows).map((r) => r.booking_id)).toEqual(["b2", "b4", "b1", "b3"]);
  });

  it("quien no tiene recogida va al final: se presenta en el punto de encuentro", () => {
    expect(sortByRoute(rows).at(-1)!.booking_id).toBe("b3");
  });

  it("dos reservas del mismo hotel y hora son una sola parada", () => {
    // El conductor para una vez y sube a todos: dos líneas serían dos paradas.
    const stops = pickupStops(rows);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ hotel: "Barceló", time: "07:30", seats: 4 });
    expect(stops[0].bookings.map((b) => b.booking_id)).toEqual(["b2", "b4"]);
    expect(stops[1]).toMatchObject({ hotel: "Riu", seats: 2 });
  });

  it("la zona del hotel viaja con la parada", () => {
    expect(pickupStops(rows)[0].zone).toBe("Bávaro");
  });
});

describe("manifiesto — el resumen del guía", () => {
  const rows = [
    manifestRow(booking({ _id: "b1", adults: 2, infants: 1, balance_amount: 50, customer: { language: "es" } })),
    manifestRow(booking({ _id: "b2", adults: 1, children: 2, checkin_status: "done", checked_in_pax: 3, customer: { language: "en" } })),
    manifestRow(booking({ _id: "b3", adults: 2, checkin_status: "no_show", customer: { first_name: "Sin idioma" } })),
  ];

  it("suma pax por categoría y plazas", () => {
    const s = paxSummary(rows);
    expect(s).toMatchObject({ bookings: 3, adults: 5, children: 2, infants: 1, seats: 8 });
  });

  it("un no-show no queda pendiente de check-in: ya está resuelto", () => {
    const s = paxSummary(rows);
    expect(s.checked_in).toBe(3);
    expect(s.no_show).toBe(2);
    expect(s.pending_checkin).toBe(3);   // solo la reserva b1
  });

  it("dice cuánto hay que cobrar a bordo", () => {
    expect(paxSummary(rows).to_collect).toBe(50);
    expect(paxSummary(rows).to_collect_by_currency).toEqual({ usd: 50 });
  });

  it("no suma divisas distintas: esa cifra no sería dinero", () => {
    // Pasa con el cliente local y el de hotel en la misma salida. Sumar 1:1 da
    // un número que no cuadra contra la caja ni le dice al guía qué traer.
    const mixed = [
      manifestRow(booking({ _id: "m1", balance_amount: 40, currency: "usd" })),
      manifestRow(booking({ _id: "m2", balance_amount: 3000, currency: "dop" })),
      manifestRow(booking({ _id: "m3", balance_amount: 60, currency: "usd" })),
    ];
    const s = paxSummary(mixed);
    expect(s.to_collect_by_currency).toEqual({ usd: 100, dop: 3000 });
    // La divisa dominante es en la que más queda por cobrar.
    expect(s.currency).toBe("dop");
    expect(s.to_collect).toBe(3000);
  });

  it("reparte los idiomas por plazas, para saber en cuál explicar el tour", () => {
    expect(paxSummary(rows).languages).toEqual({ es: 3, en: 3, "sin indicar": 2 });
  });

  it("una lista vacía no rompe las cuentas", () => {
    expect(paxSummary([])).toMatchObject({ bookings: 0, seats: 0, to_collect: 0, pending_checkin: 0 });
  });
});

describe("manifiesto — lo que hay que resolver antes de salir", () => {
  const rows = [manifestRow(booking({ adults: 10 }))];

  it("avisa cuando no caben en el vehículo asignado", () => {
    const alerts = manifestAlerts(rows, { vehicleSeats: 8, vehicles: 1, guides: 1 });
    expect(alerts[0]).toMatchObject({ level: "danger" });
    expect(alerts[0].message).toContain("10 plazas necesarias para 8");
  });

  it("avisa de la salida sin vehículo y sin guía", () => {
    const messages = manifestAlerts(rows, {}).map((a) => a.message);
    expect(messages).toContain("La salida no tiene vehículo asignado");
    expect(messages).toContain("La salida no tiene guía asignado");
  });

  it("la sobreventa sobre el cupo es un bloqueo, no un aviso", () => {
    const alert = manifestAlerts(rows, { capacity: 6, vehicles: 1, guides: 1, vehicleSeats: 20 })
      .find((a) => a.message.startsWith("Sobreventa"));
    expect(alert).toMatchObject({ level: "danger" });
  });

  it("avisa del dinero que se cobra a bordo, divisa por divisa", () => {
    const withBalance = [
      manifestRow(booking({ _id: "a", balance_amount: 120, currency: "usd" })),
      manifestRow(booking({ _id: "b", balance_amount: 500, currency: "dop" })),
    ];
    const alert = manifestAlerts(withBalance, { vehicles: 1, guides: 1 })
      .find((a) => a.message.includes("saldo pendiente"));
    expect(alert!.message).toContain("120 USD");
    expect(alert!.message).toContain("500 DOP");
  });

  it("avisa de las recogidas que faltan solo si las demás sí la tienen", () => {
    const mixed = [
      manifestRow(booking({ _id: "b1", pickup_hotel: { name: "Riu" }, pickup_time: "08:00" })),
      manifestRow(booking({ _id: "b2" })),
    ];
    expect(manifestAlerts(mixed, { vehicles: 1, guides: 1 }).some((a) => a.message.includes("sin recogida")))
      .toBe(true);
    // Si NADIE tiene recogida, es un tour con punto de encuentro: no hay nada que avisar.
    const none = [manifestRow(booking({ _id: "b1" })), manifestRow(booking({ _id: "b2" }))];
    expect(manifestAlerts(none, { vehicles: 1, guides: 1 }).some((a) => a.message.includes("sin recogida")))
      .toBe(false);
  });

  it("una salida limpia no inventa avisos", () => {
    expect(manifestAlerts(
      [manifestRow(booking({ participant: [{ _id: "p1", full_name: "Ana" }, { _id: "p2", full_name: "Luis" }] }))],
      { vehicles: 1, guides: 1, vehicleSeats: 20, capacity: 20 }
    )).toEqual([]);
  });
});

describe("manifiesto — cierre de la salida", () => {
  const past = { status: "available", departure_at: "2026-01-10T08:00:00Z" };
  const now = new Date("2026-01-10T18:00:00Z");
  const done = [manifestRow(booking({ checkin_status: "done", checked_in_pax: 2 }))];

  it("no se cierra una salida que todavía no ha partido", () => {
    expect(closeBlocker({ status: "available", departure_at: "2030-01-01T08:00:00Z" }, done, now))
      .toBe("not_departed");
  });

  it("no se cierra con la lista a medio marcar", () => {
    expect(closeBlocker(past, [manifestRow(booking())], now)).toBe("pending_checkin");
  });

  it("no se cierra dos veces, ni se cierra una cancelada", () => {
    expect(closeBlocker({ ...past, closed_at: "2026-01-10T19:00:00Z" }, done, now)).toBe("already_closed");
    expect(closeBlocker({ ...past, status: "completed" }, done, now)).toBe("already_closed");
    expect(closeBlocker({ ...past, status: "cancelled" }, done, now)).toBe("cancelled");
  });

  it("con todo resuelto y ya partida, se cierra", () => {
    expect(closeBlocker(past, done, now)).toBeNull();
  });

  it("cada bloqueo tiene un mensaje que dice qué hacer", () => {
    for (const message of Object.values(CLOSE_BLOCK_MESSAGE)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it("los pax reales son los embarcados, no los vendidos", () => {
    // Un no-show se vendió pero no viajó: sumarlo infla la ocupación de la que
    // sale la rentabilidad.
    const rows = [
      manifestRow(booking({ _id: "b1", adults: 3, checkin_status: "done", checked_in_pax: 3 })),
      manifestRow(booking({ _id: "b2", adults: 2, checkin_status: "no_show", balance_amount: 40 })),
      manifestRow(booking({ _id: "b3", adults: 1, checkin_status: "done", checked_in_pax: 1, balance_amount: 25 })),
    ];
    // Lo que no pagó el no-show no es deuda de esta salida: no viajó.
    expect(closeTotals(rows)).toEqual({ actual_pax: 4, no_show_pax: 2, uncollected: { usd: 25 } });
  });
});
