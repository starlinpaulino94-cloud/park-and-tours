import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * PREGUNTAR, RECOGER Y ACTUAR.
 *
 * Lo que se comprueba aquí no es que se escriba una fila: es a QUIÉN se le
 * escribe y a quién no. Cada regla de estas es un correo que sale o no sale, y
 * el que sale mal —al que canceló, al cliente de una OTA, al que pidió que no
 * le escribieran— no se puede recoger.
 */

let db: FakeDb;
let sb: FakeSupabase;
const encolados: { key: string; bookingId: string; url: string }[] = [];
const avisos: { event: string; vars: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/messaging/events", () => ({
  enqueuePostTourSurvey: vi.fn(async (_c: unknown, _o: string, input: { bookingId: string; url: string }) => {
    encolados.push({ key: "post_tour_thanks", bookingId: input.bookingId, url: input.url });
  }),
}));
vi.mock("@/lib/notify-service", () => ({
  notify: vi.fn(async (input: { event: string; vars: Record<string, unknown> }) => {
    avisos.push({ event: input.event, vars: input.vars });
  }),
  notifyRoles: vi.fn(),
}));

import {
  askDeparture, sweepDueSurveys, loadSurvey, answerSurvey, optOutByToken,
  expireSurveys, markReviewClicked, surveyUrl,
} from "@/lib/voice-service";

const ORG = "org-1";
const company = { _id: ORG, name: "Operadora", base_currency: "usd" } as never;

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();

/**
 * Una salida de ayer, ya terminada, con cuatro pasajeros distintos.
 *
 * Todas las filas llevan `organization_id` porque este módulo consulta con la
 * llave de servicio: el filtro por empresa lo pone el código a mano y el doble
 * lo respeta igual que PostgREST.
 */
function operacion() {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Operadora", review_url: "https://g.page/operadora/review" }],
    product: [{
      _id: "prod-saona", organization_id: ORG, name: "Isla Saona",
      product_type: "tour", duration_hours: 8, status: "active",
    }],
    departure: [{
      _id: "sal-1", organization_id: ORG, product: "prod-saona",
      departure_at: hace(24), capacity: 40, status: "completed",
    }],
    departure_resource: [{
      _id: "rec-1", organization_id: ORG, departure: "sal-1",
      staff: "guia-ramon", resource_role: "guide", status: "confirmed",
    }],
    staff: [{ _id: "guia-ramon", organization_id: ORG, full_name: "Ramón Peña", staff_type: "guide" }],
    customer: [
      { _id: "cli-laura", organization_id: ORG, first_name: "Laura", last_name: "Gutiérrez",
        email: "laura@example.test", language: "es" },
      { _id: "cli-tom", organization_id: ORG, first_name: "Tom", last_name: "Sullivan",
        email: "tom@example.test", language: "en" },
      { _id: "cli-ana", organization_id: ORG, first_name: "Ana", last_name: "Mota",
        email: "ana@example.test", language: "es" },
      { _id: "cli-sinvia", organization_id: ORG, first_name: "Sin", last_name: "Contacto", language: "es" },
    ],
    booking: [
      { _id: "res-laura", organization_id: ORG, departure: "sal-1", product: "prod-saona",
        customer: "cli-laura", status: "paid", checkin_status: "done" },
      { _id: "res-tom", organization_id: ORG, departure: "sal-1", product: "prod-saona",
        customer: "cli-tom", status: "paid", checkin_status: "done",
        octo_uuid: "11111111-1111-4111-8111-111111111111" },
      { _id: "res-ana", organization_id: ORG, departure: "sal-1", product: "prod-saona",
        customer: "cli-ana", status: "cancelled", checkin_status: "pending" },
      { _id: "res-sinvia", organization_id: ORG, departure: "sal-1", product: "prod-saona",
        customer: "cli-sinvia", status: "paid", checkin_status: "done" },
    ],
  });
}

beforeEach(() => {
  db = operacion();
  sb = fakeSupabase(db);
  encolados.length = 0;
  avisos.length = 0;
});

const encuestas = () => db.rows("guest_survey");
const deLa = (bookingId: string) => encuestas().find((s) => s.booking_id === bookingId)!;

describe("preguntar por una salida que ya terminó", () => {
  it("le pregunta al que viajó y deja escrito por qué no le pregunta al resto", async () => {
    const r = await askDeparture(company, ORG, "sal-1");

    expect(r.asked, "solo Laura recibe la encuesta").toBe(1);
    expect(r.skipped).toEqual({ ota: 1, cancelled: 1, no_contact: 1 });

    // Y las cuatro filas existen: la tasa de respuesta tiene que poder
    // distinguir «no contestó» de «no se le preguntó».
    expect(encuestas()).toHaveLength(4);
    expect(deLa("res-laura").status).toBe("pending");
    expect(deLa("res-tom").skip_reason).toBe("ota");
    expect(deLa("res-ana").skip_reason).toBe("cancelled");
    expect(deLa("res-sinvia").skip_reason).toBe("no_contact");
  });

  it("el mensaje sale con un enlace que lleva a su encuesta", async () => {
    await askDeparture(company, ORG, "sal-1");
    expect(encolados).toHaveLength(1);
    expect(encolados[0].bookingId).toBe("res-laura");
    expect(encolados[0].url).toBe(surveyUrl(String(deLa("res-laura").token)));
  });

  it("congela al guía de ese día", async () => {
    // Reasignar la salida mañana no puede cambiar de quién es la nota de hoy.
    await askDeparture(company, ORG, "sal-1");
    expect(deLa("res-laura").guide_staff_id).toBe("guia-ramon");
  });

  it("correrlo dos veces no le escribe dos veces a nadie", async () => {
    await askDeparture(company, ORG, "sal-1");
    const segunda = await askDeparture(company, ORG, "sal-1");

    expect(segunda.asked).toBe(0);
    expect(segunda.already).toBe(4);
    expect(encuestas()).toHaveLength(4);
    expect(encolados, "un barrido que corre dos veces no puede escribir dos veces").toHaveLength(1);
  });

  it("no pregunta antes de que el tour termine", async () => {
    // Una encuesta que llega mientras el pasajero está en la guagua de vuelta
    // la contesta el atasco, no la excursión.
    db.tenantUpdate(ORG, "departure", "sal-1", { departure_at: hace(2) });
    const r = await askDeparture(company, ORG, "sal-1");
    expect(r.asked).toBe(0);
    expect(encuestas()).toHaveLength(0);
  });

  it("al que pidió no recibir más, no se le pregunta", async () => {
    db.tenantUpdate(ORG, "customer", "cli-laura", { survey_opt_out: true });
    const r = await askDeparture(company, ORG, "sal-1");
    expect(r.asked).toBe(0);
    expect(deLa("res-laura").skip_reason).toBe("no_consent");
    expect(encolados).toHaveLength(0);
  });

  it("al cliente fiel no se le pregunta dos veces en la misma semana", async () => {
    db.seed("guest_survey", [{
      _id: "enc-vieja", organization_id: ORG, booking_id: "res-otra",
      customer_id: "cli-laura", token: "tok-vieja", status: "pending", asked_at: hace(48),
    }]);
    const r = await askDeparture(company, ORG, "sal-1");
    expect(deLa("res-laura").skip_reason).toBe("fatigue");
    expect(r.asked).toBe(0);
  });

  it("no toca las salidas de OTRA empresa", async () => {
    // El filtro por empresa lo pone el código: la llave de servicio se salta la
    // RLS y aquí no hay nadie más vigilando.
    const r = await askDeparture(company, "org-vecina", "sal-1");
    expect(r.asked).toBe(0);
    expect(encuestas()).toHaveLength(0);
  });
});

describe("el barrido", () => {
  it("recorre las salidas que ya terminaron", async () => {
    const r = await sweepDueSurveys(company, ORG);
    expect(r.departures).toBe(1);
    expect(r.asked).toBe(1);
    expect(r.skipped).toBe(3);
  });

  it("no mira más atrás de la ventana", async () => {
    /**
     * Sin ese suelo, el día que una operadora activa el módulo el sistema le
     * escribe a TODOS los pasajeros de los últimos dos años preguntándoles por
     * una excursión de 2024. Es la forma más rápida de acabar en spam el mismo
     * día del estreno.
     */
    db.tenantUpdate(ORG, "departure", "sal-1", { departure_at: hace(24 * 30) });
    const r = await sweepDueSurveys(company, ORG);
    expect(r.departures).toBe(0);
    expect(encuestas()).toHaveLength(0);
  });

  it("una salida que falla no deja sin preguntar a las demás", async () => {
    db.seed("departure", [{
      _id: "sal-2", organization_id: ORG, product: "prod-fantasma",
      departure_at: hace(24), capacity: 10, status: "completed",
    }]);
    db.seed("booking", [{
      _id: "res-otra", organization_id: ORG, departure: "sal-2", product: "prod-fantasma",
      customer: "cli-laura", status: "paid",
    }]);
    const r = await sweepDueSurveys(company, ORG);
    // La de Saona se preguntó igual.
    expect(r.asked).toBeGreaterThanOrEqual(1);
  });
});

describe("contestar", () => {
  const abrir = async () => {
    await askDeparture(company, ORG, "sal-1");
    return String(deLa("res-laura").token);
  };

  it("el enlace enseña de qué viaje se trata", async () => {
    const token = await abrir();
    const vista = (await loadSurvey(token))!;
    expect(vista.productName).toBe("Isla Saona");
    expect(vista.customerName).toBe("Laura Gutiérrez");
    expect(vista.companyName).toBe("Operadora");
    expect(vista.reviewUrl, "la reseña pública NO se entrega antes de saber la nota").toBeNull();
  });

  it("un token inventado no enseña nada", async () => {
    expect(await loadSurvey("tok-inventado")).toBeNull();
    expect(await answerSurvey("tok-inventado", { nps: 10 })).toEqual({ ok: false, reason: "not_found" });
  });

  it("un 10 guarda la nota y manda a la reseña pública", async () => {
    const token = await abrir();
    const r = await answerSurvey(token, { nps: 10, ratingGuide: 5, comment: "Ramón es un crack" });

    expect(r.ok).toBe(true);
    expect(r.step).toBe("review");
    expect(r.reviewUrl).toBe("https://g.page/operadora/review");

    const fila = deLa("res-laura");
    expect(fila.status).toBe("answered");
    expect(fila.nps).toBe(10);
    expect(fila.rating_guide).toBe(5);
    expect(fila.comment).toBe("Ramón es un crack");
    expect(fila.review_requested).toBe(true);
  });

  it("sin dirección de reseñas configurada, no se enseña un botón que no lleva a ningún sitio", async () => {
    db.tenantUpdate(ORG, "organizations", ORG, { review_url: null });
    const token = await abrir();
    const r = await answerSurvey(token, { nps: 10 });
    expect(r.step).toBe("thanks");
    expect(r.reviewUrl).toBeNull();
  });

  it("un 7 se agradece y NO se manda a Google", async () => {
    // Empujar un pasivo hacia la reseña pública es pedir tres estrellas con tu
    // nombre puesto.
    const token = await abrir();
    const r = await answerSurvey(token, { nps: 7 });
    expect(r.step).toBe("thanks");
    expect(r.reviewUrl).toBeNull();
    // `not.toBe(true)` y no `toBe(false)`: el valor por defecto lo pone la
    // migración y la base en memoria no aplica defaults. Lo que esta prueba
    // afirma es que NADIE le pidió la reseña, no de qué forma se escribe el no.
    expect(deLa("res-laura").review_requested).not.toBe(true);
  });

  it("un 3 abre un caso para llamarlo y avisa a operaciones", async () => {
    const token = await abrir();
    const r = await answerSurvey(token, { nps: 3, comment: "La guagua llegó hora y media tarde" });

    expect(r.step).toBe("recover");
    expect(r.reviewUrl, "a un detractor no se le paga el altavoz").toBeNull();

    const caso = db.rows("guest_case")[0];
    expect(caso, "un detractor no es un dato, es una llamada").toBeTruthy();
    expect(caso.case_type).toBe("complaint");
    expect(caso.status).toBe("open");
    expect(caso.booking_id).toBe("res-laura");
    expect(caso.satisfaction_score).toBe(3);
    expect(String(caso.description)).toContain("hora y media tarde");

    expect(deLa("res-laura").guest_case_id).toBe(caso._id);
    expect(avisos.map((a) => a.event)).toContain("survey_detractor");
  });

  it("un detractor sin comentario también se llama", async () => {
    const token = await abrir();
    await answerSurvey(token, { nps: 2 });
    const caso = db.rows("guest_case")[0];
    expect(String(caso.description)).toMatch(/llamarlo/i);
  });

  it("contestar dos veces no vale", async () => {
    // Si la segunda pisara a la primera, bastaría con reenviar el enlace para
    // cambiarle la nota a un guía.
    const token = await abrir();
    await answerSurvey(token, { nps: 10 });
    const segunda = await answerSurvey(token, { nps: 0 });

    expect(segunda).toEqual({ ok: false, reason: "already_answered" });
    expect(deLa("res-laura").nps).toBe(10);
    expect(db.rows("guest_case"), "el 0 que no se aceptó no abre un caso").toHaveLength(0);
  });

  it("una nota fuera de la escala se rechaza", async () => {
    const token = await abrir();
    expect(await answerSurvey(token, { nps: 11 })).toEqual({ ok: false, reason: "invalid" });
    expect(deLa("res-laura").status).toBe("pending");
  });

  it("una encuesta caducada ya no se contesta", async () => {
    const token = await abrir();
    db.tenantUpdate(ORG, "guest_survey", String(deLa("res-laura")._id), { expires_at: hace(1) });
    expect(await answerSurvey(token, { nps: 9 })).toEqual({ ok: false, reason: "expired" });
  });

  it("una encuesta que nunca se mandó no se contesta", async () => {
    await askDeparture(company, ORG, "sal-1");
    const omitida = String(deLa("res-tom").token);
    expect(await answerSurvey(omitida, { nps: 9 })).toEqual({ ok: false, reason: "not_asked" });
  });
});

describe("la baja y el clic en la reseña", () => {
  it("darse de baja silencia las ENCUESTAS, no los mensajes del viaje", async () => {
    await askDeparture(company, ORG, "sal-1");
    const token = String(deLa("res-laura").token);

    expect(await optOutByToken(token)).toBe(true);
    expect(db.row("customer", { _id: "cli-laura" })!.survey_opt_out).toBe(true);

    // Y la próxima vez no se le pregunta.
    db.seed("departure", [{
      _id: "sal-3", organization_id: ORG, product: "prod-saona",
      departure_at: hace(24), capacity: 10, status: "completed",
    }]);
    db.seed("booking", [{
      _id: "res-laura-2", organization_id: ORG, departure: "sal-3", product: "prod-saona",
      customer: "cli-laura", status: "paid", checkin_status: "done",
    }]);
    await askDeparture(company, ORG, "sal-3");
    expect(deLa("res-laura-2").skip_reason).toBe("no_consent");
  });

  it("se anota quién fue de verdad a dejar la reseña", async () => {
    await askDeparture(company, ORG, "sal-1");
    const token = String(deLa("res-laura").token);
    await answerSurvey(token, { nps: 10 });
    await markReviewClicked(token);
    expect(deLa("res-laura").review_clicked_at).toBeTruthy();
  });
});

describe("caducar", () => {
  it("cierra las que nadie contestó", async () => {
    /**
     * Una encuesta `pending` de hace tres meses cuenta como «estamos
     * esperando», y con suficientes de esas la tasa de respuesta del mes pasado
     * sigue cambiando. Un dato cerrado tiene que quedarse quieto.
     */
    await askDeparture(company, ORG, "sal-1");
    db.tenantUpdate(ORG, "guest_survey", String(deLa("res-laura")._id), { expires_at: hace(1) });

    expect(await expireSurveys(ORG)).toBe(1);
    expect(deLa("res-laura").status).toBe("expired");
  });

  it("no toca una que todavía puede contestarse", async () => {
    await askDeparture(company, ORG, "sal-1");
    expect(await expireSurveys(ORG)).toBe(0);
    expect(deLa("res-laura").status).toBe("pending");
  });

  it("no caduca las de otra empresa", async () => {
    await askDeparture(company, ORG, "sal-1");
    db.tenantUpdate(ORG, "guest_survey", String(deLa("res-laura")._id), { expires_at: hace(1) });
    expect(await expireSurveys("org-vecina")).toBe(0);
    expect(deLa("res-laura").status).toBe("pending");
  });
});

describe("cuando la base rechaza una escritura", () => {
  it("si no se puede guardar la respuesta, no se le dice al cliente que sí", async () => {
    await askDeparture(company, ORG, "sal-1");
    const token = String(deLa("res-laura").token);
    sb.breakWrites("guest_survey", "la base rechazó la escritura");

    await expect(answerSurvey(token, { nps: 10 })).rejects.toThrow();
    expect(deLa("res-laura").status).toBe("pending");
  });

  it("si no se puede escribir la encuesta, tampoco sale el correo", async () => {
    // Un enlace que no abre nada es peor que no mandar nada.
    sb.breakWrites("guest_survey", "la base rechazó la escritura");
    await expect(askDeparture(company, ORG, "sal-1")).rejects.toThrow();
    expect(encolados).toHaveLength(0);
  });
});
