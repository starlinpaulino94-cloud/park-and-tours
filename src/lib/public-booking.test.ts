import { describe, it, expect } from "vitest";
import {
  publicPageState, isPublishable, toPublicCard, readPublicRequest, splitName,
  confirmationNote, MAX_PUBLIC_PAX, REQUEST_PROBLEM_MESSAGE,
} from "@/lib/public-booking";

/**
 * Esta es la única puerta del sistema por la que entra alguien SIN cuenta, así
 * que las pruebas van contra las dos cosas que pueden salir caras: que se
 * publique lo que nadie quiso publicar, y que el cliente decida algo que solo
 * puede decidir el servidor.
 */

describe("si la página existe o no", () => {
  it("hace falta que la empresa la active", () => {
    // De fábrica está apagada: nadie amanece con su catálogo en internet.
    expect(publicPageState({ status: "active" })).toBe("disabled");
    expect(publicPageState({ status: "active", public_booking_enabled: false })).toBe("disabled");
    expect(publicPageState({ status: "active", public_booking_enabled: true })).toBe("ok");
  });

  it("una empresa suspendida no vende al público", () => {
    expect(publicPageState({ status: "suspended", public_booking_enabled: true })).toBe("suspended");
  });

  it("un slug que no existe es un caso aparte, aunque afuera se conteste igual", () => {
    // Distinguirlos hacia fuera le serviría a quien prueba slugs para averiguar
    // qué empresas usan el sistema; distinguirlos aquí sirve para los registros.
    expect(publicPageState(null)).toBe("not_found");
  });
});

describe("qué producto se ve", () => {
  it("publicado Y activo", () => {
    expect(isPublishable({ published: true, status: "active" })).toBe(true);
    expect(isPublishable({ published: false, status: "active" })).toBe(false);
    // Un producto retirado del catálogo interno no puede seguir vendiéndose en
    // la web porque alguien olvidó despublicarlo.
    expect(isPublishable({ published: true, status: "inactive" })).toBe(false);
  });

  it("sin estado se asume activo: el que se publicó, se publicó", () => {
    expect(isPublishable({ published: true })).toBe(true);
  });
});

describe("la ficha pública", () => {
  const row = {
    _id: "p1", name: "Isla Saona", short_description: "Día completo",
    base_price: 89, base_cost: 42, currency: "USD", published: true,
    supplier_notes: "margen 47", internal_notes: "no vender a X",
  } as Record<string, unknown>;

  it("se arma por lista blanca: el costo y las notas internas no salen", () => {
    /**
     * Es la diferencia entre un error y una fuga. Construida quitando campos,
     * el día que alguien añada `base_cost` al producto ese dato se publicaría
     * solo — y el margen de la operadora acabaría en su propia página web.
     */
    const card = toPublicCard(row) as unknown as Record<string, unknown>;
    expect(card.priceFrom).toBe(89);
    expect(Object.keys(card)).not.toContain("base_cost");
    expect(JSON.stringify(card)).not.toContain("42");
    expect(JSON.stringify(card)).not.toContain("margen");
    expect(JSON.stringify(card)).not.toContain("no vender");
  });

  it("el «desde» explícito manda sobre el precio base", () => {
    // Es el que la operadora decidió enseñar cuando el real depende de
    // modalidad o temporada.
    expect(toPublicCard({ ...row, public_price_from: 75 }).priceFrom).toBe(75);
  });

  it("la moneda baja a minúsculas y cae a la de la empresa", () => {
    expect(toPublicCard(row).currency).toBe("usd");
    expect(toPublicCard({ _id: "p2" }, "dop").currency).toBe("dop");
  });
});

describe("la petición del cliente", () => {
  const valida = {
    productId: "p1", departureId: "d1", adults: 2, children: 1,
    name: "Ana María Pérez", email: "ANA@correo.com ", phone: " 8095550101 ",
  };

  it("acepta lo que solo el cliente sabe", () => {
    const res = readPublicRequest(valida);
    expect(res.ok).toBe(true);
    if (res.ok === false) return;
    expect(res.request.adults).toBe(2);
    expect(res.request.email).toBe("ana@correo.com");
    expect(res.request.phone).toBe("8095550101");
  });

  it("NO acepta precio, moneda ni estado, aunque los mande", () => {
    /**
     * La regla que sostiene todo el motor: del cliente solo se acepta lo que no
     * se puede calcular en el servidor. Un motor que acepta el precio del
     * cliente es una tienda donde cada quien pone su etiqueta.
     */
    const res = readPublicRequest({
      ...valida, total: 1, unit_price: 0.01, currency: "eur", status: "paid", discount_pct: 99,
    } as never);
    expect(res.ok).toBe(true);
    if (res.ok === false) return;
    const claves = Object.keys(res.request);
    for (const prohibida of ["total", "unit_price", "currency", "status", "discount_pct"]) {
      expect(claves, prohibida).not.toContain(prohibida);
    }
  });

  it("el campo trampa corta sin explicar por qué", () => {
    // Decir «detectamos un robot» solo le enseña al siguiente cómo evitarlo.
    const res = readPublicRequest({ ...valida, website: "http://spam" });
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("spam");
    expect(REQUEST_PROBLEM_MESSAGE.spam).not.toMatch(/robot|spam|bot/i);
  });

  it("sin personas no hay reserva", () => {
    const res = readPublicRequest({ ...valida, adults: 0, children: 0, infants: 0 });
    expect(res.ok).toBe(false);
  });

  it("un grupo grande se manda a cotización, no se cuela como reserva", () => {
    // Treinta personas necesitan otro precio y otro transporte: dejarlo entrar
    // le promete al cliente una plaza que quizá no existe.
    const res = readPublicRequest({ ...valida, adults: MAX_PUBLIC_PAX + 1 });
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("too_many");
    expect(REQUEST_PROBLEM_MESSAGE.too_many).toMatch(/cotiza/i);
  });

  it("hace falta una forma de contestarle", () => {
    const res = readPublicRequest({ ...valida, email: "", phone: "" });
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("contact");
  });

  it("con solo teléfono basta: aquí mucha gente no da correo", () => {
    expect(readPublicRequest({ ...valida, email: "" }).ok).toBe(true);
  });

  it("un correo con forma imposible se rechaza antes de escribir nada", () => {
    const res = readPublicRequest({ ...valida, email: "ana@correo" });
    expect(res.ok).toBe(false);
    if (res.ok === true) return;
    expect(res.problem).toBe("email");
  });

  it("los textos largos se recortan en vez de rechazarse", () => {
    // Rechazar una nota larga pierde la venta; recortarla, no.
    const res = readPublicRequest({ ...valida, notes: "x".repeat(5000) });
    expect(res.ok).toBe(true);
    if (res.ok === false) return;
    expect(res.request.notes.length).toBe(500);
  });
});

describe("el nombre", () => {
  it("se parte por la PRIMERA palabra: dos apellidos son lo normal aquí", () => {
    expect(splitName("Ana María Pérez Gómez")).toEqual({ first: "Ana", last: "María Pérez Gómez" });
    expect(splitName("Juan")).toEqual({ first: "Juan", last: "" });
  });
});

describe("lo que se le contesta al cliente", () => {
  it("sin pago dice SOLICITUD, no «confirmada»", () => {
    // Decir «confirmada» y llamar después para avisar que no había cupo es peor
    // que no tener página.
    expect(confirmationNote(false)).toMatch(/solicitud/i);
    expect(confirmationNote(false)).not.toMatch(/confirmada/i);
  });

  it("el texto de la empresa manda sobre el nuestro", () => {
    expect(confirmationNote(false, "Pagas en nuestra oficina de Bávaro.")).toBe("Pagas en nuestra oficina de Bávaro.");
  });
});
