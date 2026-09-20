import { describe, it, expect } from "vitest";
import {
  bandOf, npsOf, askVerdict, askAt, expiresAt, canAnswer, nextStep, summarize, groupNps,
  SURVEY_FATIGUE_DAYS, SURVEY_EXPIRY_DAYS, DEFAULT_DURATION_HOURS,
} from "@/lib/voice";

/**
 * LA VOZ DEL CLIENTE, REGLA A REGLA.
 *
 * Cada una de estas decide si a una persona se le escribe o no, y qué se le
 * enseña cuando contesta. No son aritmética: equivocarse en una es escribirle a
 * quien canceló, pedirle una reseña pública a quien acaba de poner un 3, o
 * contarle a un guía la nota de otro.
 */

const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

describe("la escala", () => {
  it("el 7 y el 8 NO son aprobados", () => {
    // Un pasivo vuelve si no encuentra nada mejor y no te defiende delante de
    // nadie. Contarlo como contento es cómo un panel dice que todo va bien
    // mientras la reputación baja.
    expect(bandOf(7)).toBe("passive");
    expect(bandOf(8)).toBe("passive");
    expect(bandOf(9)).toBe("promoter");
    expect(bandOf(10)).toBe("promoter");
    expect(bandOf(6)).toBe("detractor");
    expect(bandOf(0)).toBe("detractor");
  });

  it("una nota fuera de la escala no es ninguna banda", () => {
    for (const malo of [-1, 11, NaN, null, undefined, "muy bien", {}]) {
      expect(bandOf(malo), `${String(malo)} no debería caer en ninguna banda`).toBeNull();
    }
  });

  it("sin respuestas el NPS es nulo, NO cero", () => {
    // Un 0 se lee como «la mitad te recomienda y la mitad no», que es una frase
    // sobre el negocio. «Todavía no hay datos» es una frase sobre la medición.
    // Confundirlas hace que alguien juzgue a un guía por una casilla vacía.
    expect(npsOf([]).score).toBeNull();
    expect(npsOf([null, undefined, "x"]).score).toBeNull();
  });

  it("los pasivos no suman ni restan", () => {
    // 2 promotores, 6 pasivos, 2 detractores → (2−2)/10 = 0
    const r = npsOf([9, 10, 7, 7, 7, 8, 8, 8, 3, 5]);
    expect(r.answered).toBe(10);
    expect(r.promoters).toBe(2);
    expect(r.passives).toBe(6);
    expect(r.detractors).toBe(2);
    expect(r.score).toBe(0);
  });

  it("todos contentos es 100 y todos molestos es −100", () => {
    expect(npsOf([9, 10, 10]).score).toBe(100);
    expect(npsOf([0, 3, 6]).score).toBe(-100);
  });
});

describe("a quién se le pregunta", () => {
  const alcanzable = { status: "paid", email: "tom@example.test" };

  it("al pasajero que viajó y pagó, sí", () => {
    expect(askVerdict(alcanzable)).toEqual({ ask: true });
  });

  it("al cliente de una OTA no se le escribe", () => {
    // No es técnico, es el contrato: el revendedor es el dueño de esa relación
    // y el correo que cede suele ser un alias suyo.
    expect(askVerdict({ ...alcanzable, octo_uuid: "11111111-1111-4111-8111-111111111111" }))
      .toEqual({ ask: false, reason: "ota" });
  });

  it("a quien pidió no recibir más, tampoco", () => {
    expect(askVerdict({ ...alcanzable, optOut: true })).toEqual({ ask: false, reason: "no_consent" });
  });

  it("a una reserva muerta no se le pregunta qué tal el viaje", () => {
    for (const estado of ["cancelled", "refunded", "partially_refunded"]) {
      expect(askVerdict({ ...alcanzable, status: estado }), estado)
        .toEqual({ ask: false, reason: "cancelled" });
    }
  });

  it("al que no se presentó tampoco, lo diga la reserva o lo diga el embarque", () => {
    // El guía marca el embarque desde el móvil y el estado de la reserva no
    // siempre lo sigue: mirar solo uno de los dos deja pasar la mitad.
    expect(askVerdict({ ...alcanzable, status: "no_show" })).toEqual({ ask: false, reason: "no_show" });
    expect(askVerdict({ ...alcanzable, checkin_status: "no_show" })).toEqual({ ask: false, reason: "no_show" });
  });

  it("al cliente fiel no se le pregunta tres veces en una semana", () => {
    // La fatiga de encuesta no cuesta opiniones: cuesta que deje de abrir los
    // correos, incluido el que lleva la hora de recogida.
    expect(askVerdict({ ...alcanzable, lastAskedAt: hace(3) }))
      .toEqual({ ask: false, reason: "fatigue" });
    expect(askVerdict({ ...alcanzable, lastAskedAt: hace(SURVEY_FATIGUE_DAYS + 1) }))
      .toEqual({ ask: true });
  });

  it("una fecha corrupta no silencia la encuesta", () => {
    // Preferimos preguntar de más a callarnos por un dato roto.
    expect(askVerdict({ ...alcanzable, lastAskedAt: "el martes pasado" })).toEqual({ ask: true });
  });

  it("sin correo ni teléfono no hay por dónde", () => {
    expect(askVerdict({ status: "paid" })).toEqual({ ask: false, reason: "no_contact" });
    expect(askVerdict({ status: "paid", email: "   " })).toEqual({ ask: false, reason: "no_contact" });
    expect(askVerdict({ status: "paid", whatsapp: "+18095550133" })).toEqual({ ask: true });
  });

  it("el motivo que se guarda es el de fuera hacia dentro", () => {
    /**
     * Una reserva de OTA de alguien que además canceló y no dejó correo tiene
     * tres motivos a la vez. La fila guarda UNO y es el que la operadora va a
     * leer, así que manda el más externo: primero el contrato, después el hecho
     * del viaje, y al final lo nuestro.
     *
     * Si ganara «sin contacto», la operadora se pondría a limpiar fichas de
     * clientes a los que no puede escribir de todos modos.
     */
    expect(askVerdict({ status: "cancelled", octo_uuid: "u", optOut: true }))
      .toEqual({ ask: false, reason: "ota" });
    expect(askVerdict({ status: "cancelled", optOut: true }))
      .toEqual({ ask: false, reason: "no_consent" });
    expect(askVerdict({ status: "cancelled", lastAskedAt: hace(1) }))
      .toEqual({ ask: false, reason: "cancelled" });
    expect(askVerdict({ status: "paid", lastAskedAt: hace(1) }))
      .toEqual({ ask: false, reason: "fatigue" });
  });
});

describe("cuándo se pregunta", () => {
  const salida = "2026-09-20T13:00:00.000Z"; // 9 de la mañana en Santo Domingo

  it("al terminar el tour, más cuatro horas", () => {
    const cuando = askAt(salida, 8)!;
    // 13:00 + 8 h de excursión + 4 h = 01:00 del día siguiente… en UTC.
    expect(cuando.toISOString()).toBe("2026-09-21T01:00:00.000Z");
  });

  it("un producto que no dice cuánto dura se supone de día completo", () => {
    // Quedarse corto es el error caro: preguntar mientras el pasajero sigue en
    // la guagua de vuelta.
    expect(askAt(salida, null)!.getTime())
      .toBe(askAt(salida, DEFAULT_DURATION_HOURS)!.getTime());
    expect(askAt(salida, 0)!.getTime()).toBe(askAt(salida, DEFAULT_DURATION_HOURS)!.getTime());
    expect(askAt(salida, -3)!.getTime()).toBe(askAt(salida, DEFAULT_DURATION_HOURS)!.getTime());
  });

  it("sin fecha de salida no hay cuándo", () => {
    expect(askAt(null, 8)).toBeNull();
    expect(askAt("no es una fecha", 8)).toBeNull();
  });

  it("el enlace caduca a los treinta días", () => {
    const desde = "2026-09-20T12:00:00.000Z";
    const vence = expiresAt(desde)!;
    expect(vence.getTime() - Date.parse(desde)).toBe(SURVEY_EXPIRY_DAYS * 86_400_000);
  });
});

describe("contestar", () => {
  const viva = { status: "pending", asked_at: hace(1), expires_at: new Date(Date.now() + 86_400_000).toISOString() };

  it("una encuesta viva se contesta", () => {
    expect(canAnswer(viva)).toEqual({ ok: true });
  });

  it("dos veces no", () => {
    // Si la segunda pisara a la primera, bastaría con reenviar el enlace para
    // cambiarle la nota a un guía.
    expect(canAnswer({ ...viva, status: "answered" })).toEqual({ ok: false, reason: "already_answered" });
  });

  it("caducada no, la diga el estado o la diga la fecha", () => {
    expect(canAnswer({ ...viva, status: "expired" })).toEqual({ ok: false, reason: "expired" });
    expect(canAnswer({ ...viva, expires_at: hace(1) })).toEqual({ ok: false, reason: "expired" });
  });

  it("una encuesta que nunca se mandó no se contesta", () => {
    expect(canAnswer({ status: "skipped", skip_reason: "ota" } as never)).toEqual({ ok: false, reason: "not_asked" });
    expect(canAnswer({ status: "pending", asked_at: null })).toEqual({ ok: false, reason: "not_asked" });
  });

  it("sin fecha de caducidad NO se da por caducada", () => {
    // Falta un dato nuestro y el cliente está delante con el enlace abierto.
    expect(canAnswer({ status: "pending", asked_at: hace(1) })).toEqual({ ok: true });
  });
});

describe("qué se hace con la nota", () => {
  it("al promotor se le pide la reseña pública", () => {
    // Es el único momento en que la escribe: acaba de decir que pondría un 10.
    expect(nextStep(10)).toBe("review");
    expect(nextStep(9)).toBe("review");
  });

  it("al pasivo se le da las gracias y nada más", () => {
    // Empujar un 7 hacia Google es pedir una reseña de tres estrellas con tu
    // nombre puesto.
    expect(nextStep(7)).toBe("thanks");
    expect(nextStep(8)).toBe("thanks");
  });

  it("al detractor NO se le pide reseña: se le llama", () => {
    // Mandar a un detractor a la reseña pública es pagarle el altavoz.
    expect(nextStep(6)).toBe("recover");
    expect(nextStep(0)).toBe("recover");
  });
});

describe("el resumen que ve la operadora", () => {
  const filas = [
    { status: "answered", nps: 10, product_id: "saona", guide_staff_id: "ramon" },
    { status: "answered", nps: 9, product_id: "saona", guide_staff_id: "ramon" },
    { status: "answered", nps: 3, product_id: "buggy", guide_staff_id: "luis" },
    { status: "pending", product_id: "saona" },
    { status: "skipped", skip_reason: "ota", product_id: "saona" },
    { status: "skipped", skip_reason: "ota", product_id: "buggy" },
    { status: "skipped", skip_reason: "no_contact", product_id: "buggy" },
  ];

  it("la tasa de respuesta se calcula sobre las PREGUNTADAS", () => {
    /**
     * Meter en el denominador a los clientes de OTA —a los que por contrato no
     * se les escribe— haría que una operadora que vende bien por OTA viera
     * caer su «tasa de respuesta» cuanto mejor le fuera. El número dejaría de
     * medir la encuesta para medir el canal.
     */
    const r = summarize(filas);
    expect(r.total).toBe(7);
    expect(r.asked, "tres omitidas no se preguntaron").toBe(4);
    expect(r.answered).toBe(3);
    expect(r.responseRate, "3 de 4, no 3 de 7").toBe(75);
  });

  it("dice por qué no se preguntó, para saber qué arreglar", () => {
    const r = summarize(filas);
    expect(r.skips).toEqual({ ota: 2, no_contact: 1 });
  });

  it("el NPS del resumen ignora las que no contestaron", () => {
    const r = summarize(filas);
    expect(r.nps.answered).toBe(3);
    expect(r.nps.score).toBe(Math.round(((2 - 1) / 3) * 100));
  });

  it("agrupar por guía cuenta solo respuestas, y no inventa el grupo vacío", () => {
    const porGuia = groupNps(filas, (f) => f.guide_staff_id ?? null);
    expect(porGuia.map((g) => g.key)).toEqual(["ramon", "luis"]);
    expect(porGuia[0].nps.score).toBe(100);
    expect(porGuia[1].nps.score).toBe(-100);
  });

  it("un grupo con pocas respuestas se enseña con su recuento, no se esconde", () => {
    // Quién decide si tres respuestas bastan para hablar de un guía es quien
    // mira el panel. Lo que no se hace es inventarse un número.
    const porProducto = groupNps(filas, (f) => f.product_id ?? null);
    const buggy = porProducto.find((p) => p.key === "buggy")!;
    expect(buggy.nps.answered).toBe(1);
    expect(buggy.nps.score).toBe(-100);
  });

  it("sin ninguna respuesta el resumen no miente", () => {
    const r = summarize([{ status: "skipped", skip_reason: "ota" }]);
    expect(r.responseRate).toBeNull();
    expect(r.nps.score).toBeNull();
  });
});
