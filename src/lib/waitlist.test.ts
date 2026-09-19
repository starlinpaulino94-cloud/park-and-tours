import { describe, it, expect } from "vitest";
import {
  OFFER_HOURS, queueOf, waitingPax, pickForSeats, offerDeadline, offerExpired,
  outcomeOf, summarize, contactName, contactChannel,
} from "@/lib/waitlist";

/**
 * Cada caso de aquí es una conversación con un cliente que se quedó fuera.
 * Equivocarse en el orden de la cola no es un error de cálculo: es llamar a la
 * pareja que llegó después y dejar colgada a la familia que llevaba tres días
 * esperando.
 */

const AHORA = new Date("2026-09-20T15:00:00Z");
const cuando = (min: number) => new Date(AHORA.getTime() + min * 60_000).toISOString();

const espera = (id: string, pax: number, over: Record<string, unknown> = {}) => ({
  _id: id, pax, status: "waiting", contact_phone: "+1 809 555 0000",
  created_at: cuando(0), ...over,
});

describe("la cola va por orden de llegada", () => {
  it("el que llegó antes va antes", () => {
    const cola = queueOf([
      espera("b", 2, { created_at: cuando(10) }),
      espera("a", 2, { created_at: cuando(0) }),
      espera("c", 2, { created_at: cuando(20) }),
    ]);
    expect(cola.map((e) => e._id)).toEqual(["a", "b", "c"]);
  });

  it("un empate al milisegundo no cambia de orden cada vez que se mira", () => {
    // Dos altas en la misma petición. Una cola que se reordena sola no es cola.
    const entradas = [espera("z", 2), espera("a", 2)];
    expect(queueOf(entradas).map((e) => e._id)).toEqual(["a", "z"]);
    expect(queueOf([...entradas].reverse()).map((e) => e._id)).toEqual(["a", "z"]);
  });

  it("solo está en la cola quien sigue esperando", () => {
    const cola = queueOf([
      espera("a", 2),
      espera("b", 2, { status: "offered" }),
      espera("c", 2, { status: "converted" }),
      espera("d", 2, { status: "cancelled" }),
      espera("e", 2, { status: "expired" }),
    ]);
    expect(cola.map((e) => e._id)).toEqual(["a"]);
  });

  it("sin estado se da por esperando: es el alta recién hecha", () => {
    expect(queueOf([{ _id: "a", pax: 2, created_at: cuando(0) }])).toHaveLength(1);
  });

  it("cuenta la gente que espera, no las filas", () => {
    expect(waitingPax([espera("a", 4), espera("b", 2), espera("c", 3, { status: "offered" })])).toBe(6);
  });

  it("una fecha ilegible va al final, no al principio", () => {
    // Al principio se colaría delante de todos los que sí tienen fecha.
    const cola = queueOf([espera("rota", 2, { created_at: "cuando sea" }), espera("buena", 2)]);
    expect(cola.map((e) => e._id)).toEqual(["buena", "rota"]);
  });
});

describe("a quién se le ofrecen las plazas que se liberan", () => {
  it("al primero que cabe", () => {
    const picks = pickForSeats([espera("a", 2), espera("b", 2)], 2);
    expect(picks.map((p) => p.entry._id)).toEqual(["a"]);
  });

  it("se salta a quien no cabe y sigue bajando", () => {
    /**
     * Una familia de cinco delante de una pareja, con tres plazas libres. Si la
     * cola se parara en el primero que no cabe, las tres plazas saldrían vacías
     * y los dos clientes se quedarían sin viajar.
     */
    const picks = pickForSeats([espera("familia", 5), espera("pareja", 2)], 3);
    expect(picks.map((p) => p.entry._id)).toEqual(["pareja"]);
  });

  it("NO parte una espera para rellenar el hueco", () => {
    // Ofrecerle tres plazas a una familia de cinco es ofrecerle dejar a dos en
    // tierra. Quien se apuntó por cinco quiere cinco.
    const picks = pickForSeats([espera("familia", 5)], 3);
    expect(picks).toEqual([]);
  });

  it("reparte entre varios hasta agotar las plazas", () => {
    const picks = pickForSeats([espera("a", 2), espera("b", 2), espera("c", 2)], 4);
    expect(picks.map((p) => p.entry._id)).toEqual(["a", "b"]);
    expect(picks.reduce((s, p) => s + p.pax, 0)).toBe(4);
  });

  it("no ofrece más plazas de las que hay", () => {
    const picks = pickForSeats([espera("a", 3), espera("b", 3)], 4);
    expect(picks.reduce((s, p) => s + p.pax, 0)).toBeLessThanOrEqual(4);
  });

  it("sin plazas libres no se ofrece nada", () => {
    expect(pickForSeats([espera("a", 2)], 0)).toEqual([]);
    expect(pickForSeats([espera("a", 2)], -3)).toEqual([]);
  });

  it("una espera de cero pax no consume una plaza fantasma", () => {
    const picks = pickForSeats([{ _id: "rara", pax: 0, created_at: cuando(0) }, espera("a", 2)], 2);
    expect(picks.map((p) => p.entry._id)).toEqual(["a"]);
  });

  it("a quien ya tiene oferta no se le ofrece otra vez", () => {
    const picks = pickForSeats([espera("a", 2, { status: "offered" }), espera("b", 2)], 2);
    expect(picks.map((p) => p.entry._id)).toEqual(["b"]);
  });
});

describe("hasta cuándo se le guarda la plaza", () => {
  it("veinticuatro horas por defecto", () => {
    const limite = offerDeadline(AHORA, new Date("2026-12-01T00:00:00Z"));
    expect(Date.parse(limite) - AHORA.getTime()).toBe(OFFER_HOURS * 3_600_000);
  });

  it("nunca más allá de la salida", () => {
    // Una plaza guardada para un viaje que ya salió no la reclama nadie.
    const salida = new Date(AHORA.getTime() + 3 * 3_600_000);
    expect(offerDeadline(AHORA, salida)).toBe(salida.toISOString());
  });

  it("una oferta viva no está vencida", () => {
    expect(offerExpired({ status: "offered", offer_expires_at: cuando(60) }, AHORA)).toBe(false);
  });

  it("una oferta pasada sí", () => {
    expect(offerExpired({ status: "offered", offer_expires_at: cuando(-1) }, AHORA)).toBe(true);
  });

  it("quien no tiene oferta no puede tenerla vencida", () => {
    expect(offerExpired({ status: "waiting", offer_expires_at: cuando(-100) }, AHORA)).toBe(false);
  });

  it("una fecha ilegible no vence sola: se mira a mano", () => {
    // Darla por vencida le quitaría la plaza a alguien por un dato corrupto.
    expect(offerExpired({ status: "offered", offer_expires_at: "mañana" }, AHORA)).toBe(false);
  });
});

describe("cómo acaba cada espera", () => {
  it("convertida es la que PAGÓ, no la que tiene reserva", () => {
    /**
     * Una reserva creada por una oferta y nunca pagada es una plaza que se
     * guardó y se perdió. Contarla como venta recuperada le daría a la lista un
     * mérito que no tuvo — y ese número es justo el que la operadora va a mirar
     * para decidir si el módulo sirve.
     */
    const ofrecida = espera("a", 2, { status: "offered", offer_expires_at: cuando(60) });
    expect(outcomeOf(ofrecida, { status: "pending_payment", paid_amount: 0 }, AHORA)).toBe("offered");
    expect(outcomeOf(ofrecida, { status: "partially_paid", paid_amount: 50 }, AHORA)).toBe("converted");
  });

  it("si su reserva se cayó, la espera se dio por perdida", () => {
    const ofrecida = espera("a", 2, { status: "offered", offer_expires_at: cuando(60) });
    for (const estado of ["cancelled", "refunded", "partially_refunded"]) {
      expect(outcomeOf(ofrecida, { status: estado, paid_amount: 0 }, AHORA)).toBe("expired");
    }
  });

  it("una oferta que se pasó de plazo está vencida aunque nadie haya barrido", () => {
    const tarde = espera("a", 2, { status: "offered", offer_expires_at: cuando(-1) });
    expect(outcomeOf(tarde, null, AHORA)).toBe("expired");
  });

  it("lo que una persona decidió gana sobre el calendario", () => {
    // Una baja es una decisión: que su oferta siga en plazo no la revive.
    const baja = espera("a", 2, { status: "cancelled", offer_expires_at: cuando(60) });
    expect(outcomeOf(baja, null, AHORA)).toBe("cancelled");
  });

  it("una espera pagada sigue convertida aunque después se reembolse", () => {
    // El estado declarado manda: ya se anotó que la lista recuperó esa venta, y
    // lo que pasara después con la reserva es otra historia.
    const hecha = espera("a", 2, { status: "converted" });
    expect(outcomeOf(hecha, { status: "refunded", paid_amount: 0 }, AHORA)).toBe("converted");
  });
});

describe("el resumen que mide si la lista sirve", () => {
  it("cuenta cada desenlace y la gente que llegó a viajar", () => {
    const resumen = summarize([
      { entry: espera("a", 4) },
      { entry: espera("b", 2) },
      { entry: espera("c", 3, { status: "offered", offer_expires_at: cuando(60) }),
        booking: { status: "pending_payment", paid_amount: 0 } },
      { entry: espera("d", 5, { status: "offered", offer_expires_at: cuando(60) }),
        booking: { status: "paid", paid_amount: 500 } },
      { entry: espera("e", 2, { status: "cancelled" }) },
    ], AHORA);

    expect(resumen.waiting).toBe(2);
    expect(resumen.waitingPax).toBe(6);
    expect(resumen.offered).toBe(1);
    expect(resumen.converted).toBe(1);
    expect(resumen.convertedPax).toBe(5);
    expect(resumen.cancelled).toBe(1);
  });
});

describe("cómo se llama y por dónde se le avisa", () => {
  it("la ficha del cliente manda sobre lo tecleado a mano", () => {
    const e = espera("a", 2, {
      contact_name: "Laura G.", contact_phone: "+1 809 000 0000",
      customer: { first_name: "Laura", last_name: "Gutiérrez", whatsapp: "+34 600 111 222" },
    });
    expect(contactName(e)).toBe("Laura Gutiérrez");
    expect(contactChannel(e)).toBe("+34 600 111 222");
  });

  it("sin ficha se usa lo que el vendedor apuntó", () => {
    const e = espera("a", 2, { contact_name: "Michael", contact_phone: "+1 809 555 0101" });
    expect(contactName(e)).toBe("Michael");
    expect(contactChannel(e)).toBe("+1 809 555 0101");
  });

  it("una ficha a medias no deja a nadie sin nombre ni sin canal", () => {
    const e = espera("a", 2, { contact_name: "Michael", customer: { first_name: "", last_name: "" } });
    expect(contactName(e)).toBe("Michael");
    expect(contactChannel(e)).toBe("+1 809 555 0000");
  });

  it("sin nada, lo dice en vez de enseñar un hueco", () => {
    expect(contactName({ pax: 2 })).toBe("Sin nombre");
    expect(contactChannel({ pax: 2 })).toBeNull();
  });
});
