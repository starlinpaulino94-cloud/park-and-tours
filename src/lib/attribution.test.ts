import { describe, it, expect } from "vitest";
import {
  FUNNEL_STAGES, isStage, LINK_CHANNELS, normalizeChannel,
  ATTRIBUTION_POLICIES, normalizePolicy, DEFAULT_WINDOW_DAYS, withinWindow,
  cookieMaxAgeSeconds, factSeller, factId, resolveAttribution, funnel,
  slugify, randomSuffix, proposeSlug, linkUrl, sellerLeaderboard,
} from "@/lib/attribution";

/**
 * La atribución decide dinero, y se equivoca en silencio: nadie reclama una
 * comisión que no sabe que le tocaba. Lo que se prueba aquí son las formas
 * concretas de equivocarse — el QR de hace ocho meses que se cobra hoy, el
 * visitante que recarga cinco veces e infla el embudo, y la política que se
 * cambia y reescribe el pasado.
 */

const NOW = new Date("2026-09-17T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const fact = (
  seller_id: string,
  stage: string,
  ago: number,
  extra: Record<string, unknown> = {}
) => ({ id: `${seller_id}-${stage}-${ago}`, seller_id, stage, created_at: daysAgo(ago), ...extra });

describe("el vocabulario del embudo", () => {
  it("cuatro etapas, en el orden en que pasan de verdad", () => {
    expect([...FUNNEL_STAGES]).toEqual(["visit", "signup", "booking", "purchase"]);
    expect(isStage("purchase")).toBe(true);
    expect(isStage("curioseo")).toBe(false);
    expect(isStage(null)).toBe(false);
  });

  it("el canal llega de la URL, así que lo que no se reconoce es «enlace»", () => {
    // Un canal inventado metería basura en el informe por canal; uno genérico
    // y honesto, no.
    expect(normalizeChannel("QR")).toBe("qr");
    expect(normalizeChannel(" whatsapp ")).toBe("whatsapp");
    expect(normalizeChannel("telepatia")).toBe("link");
    expect(normalizeChannel(undefined)).toBe("link");
    expect(LINK_CHANNELS).toContain("print");
  });

  it("la política por defecto premia la captación", () => {
    expect([...ATTRIBUTION_POLICIES]).toEqual(["first", "last", "booking"]);
    expect(normalizePolicy("last")).toBe("last");
    expect(normalizePolicy("LA_QUE_SEA")).toBe("first");
    expect(normalizePolicy(null)).toBe("first");
    expect(DEFAULT_WINDOW_DAYS).toBe(30);
  });
});

describe("la ventana", () => {
  it("un escaneo dentro de la ventana cuenta y uno de hace ocho meses no", () => {
    // Pagar el QR de hace ocho meses es inventar una deuda.
    expect(withinWindow(daysAgo(10), 30, NOW)).toBe(true);
    expect(withinWindow(daysAgo(31), 30, NOW)).toBe(false);
  });

  it("cero días significa «no caduca nunca», que es una elección legítima", () => {
    // Una operadora con dos hoteles fijos no quiere que su acuerdo caduque.
    expect(withinWindow(daysAgo(900), 0, NOW)).toBe(true);
    expect(withinWindow(daysAgo(900), -5, NOW)).toBe(true);
  });

  it("una fecha que no es fecha no atribuye nada", () => {
    // Tratarla como válida atribuiría una venta a quien no la trajo.
    expect(withinWindow("ayer", 30, NOW)).toBe(false);
    expect(withinWindow(null, 30, NOW)).toBe(false);
    expect(withinWindow("", 0, NOW)).toBe(false);
  });

  it("la cookie vive más que la ventana, nunca menos", () => {
    // Una cookie que caduca antes convierte una atribución viva en una venta
    // huérfana: el hecho seguía valiendo y nadie pudo leerlo.
    expect(cookieMaxAgeSeconds(30)).toBeGreaterThan(30 * 86_400);
    expect(cookieMaxAgeSeconds(0)).toBeGreaterThan(0);
    // Y con tope, porque ningún navegador guarda una cookie eterna.
    expect(cookieMaxAgeSeconds(9999)).toBe(400 * 86_400);
  });
});

describe("leer el vendedor de un hecho", () => {
  it("da igual que la fila venga cruda o expandida", () => {
    expect(factSeller({ seller_id: "v1" })).toBe("v1");
    expect(factSeller({ seller: "v2" })).toBe("v2");
    expect(factSeller({ seller: { _id: "v3", first_name: "Rafa" } })).toBe("v3");
    expect(factSeller({ seller: { id: "v4" } })).toBe("v4");
  });

  it("un hecho sin vendedor no atribuye nada", () => {
    expect(factSeller({})).toBeNull();
    expect(factSeller({ seller: {} })).toBeNull();
    expect(factSeller({ seller_id: "" })).toBeNull();
  });

  it("el id del hecho sale del traductor o de la fila", () => {
    expect(factId({ _id: "a" })).toBe("a");
    expect(factId({ id: "b" })).toBe("b");
    expect(factId({})).toBeNull();
  });
});

describe("a quién le toca la venta", () => {
  const historia = [
    fact("conserje", "visit", 20),
    fact("mostrador", "visit", 5),
    fact("taxista", "booking", 3),
    fact("mostrador", "signup", 2),
  ];

  it("«primero» premia al que lo trajo, aunque cerrara otro", () => {
    // El conserje puso el QR: es el trabajo que nadie más iba a hacer.
    const ganador = resolveAttribution(historia, { policy: "first", windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("conserje");
  });

  it("«último» premia al que lo cerró", () => {
    const ganador = resolveAttribution(historia, { policy: "last", windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("mostrador");
  });

  it("«reserva» busca la etapa de reserva, no el último contacto cualquiera", () => {
    const ganador = resolveAttribution(historia, { policy: "booking", windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("taxista");
  });

  it("«reserva» sin ninguna reserva cae al último, no deja la comisión sin dueño", () => {
    const sinReserva = historia.filter((f) => f.stage !== "booking");
    const ganador = resolveAttribution(sinReserva, { policy: "booking", windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("mostrador");
  });

  it("devuelve el HECHO entero, no solo el vendedor", () => {
    // La venta congela cuál fue; sin eso, una comisión discutida seis semanas
    // después solo se puede defender repitiendo el cálculo con las reglas de hoy.
    const ganador = resolveAttribution(historia, { policy: "first", windowDays: 30, now: NOW });
    expect(factId(ganador!)).toBe("conserje-visit-20");
    expect(ganador!.stage).toBe("visit");
  });

  it("fuera de la ventana no hay atribución: la venta es directa de la empresa", () => {
    const viejos = [fact("conserje", "visit", 200), fact("taxista", "visit", 180)];
    expect(resolveAttribution(viejos, { policy: "first", windowDays: 30, now: NOW })).toBeNull();
  });

  it("caducar unos hechos cambia el ganador, no lo deja en nulo", () => {
    // Si el primero caducó y el segundo no, gana el segundo: la ventana quita
    // hechos, no la venta.
    const ganador = resolveAttribution(
      [fact("conserje", "visit", 40), fact("mostrador", "visit", 5)],
      { policy: "first", windowDays: 30, now: NOW }
    );
    expect(factSeller(ganador!)).toBe("mostrador");
  });

  it("un hecho sin vendedor se ignora en vez de ganar por ser el más antiguo", () => {
    const conHuerfano = [
      { id: "x", stage: "visit", created_at: daysAgo(25) },
      fact("conserje", "visit", 20),
    ];
    const ganador = resolveAttribution(conHuerfano, { policy: "first", windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("conserje");
  });

  it("sin historia no hay nadie a quien pagarle", () => {
    expect(resolveAttribution([], { policy: "first", now: NOW })).toBeNull();
  });

  it("sin política explícita usa «primero», no la última que se tocó", () => {
    const ganador = resolveAttribution(historia, { windowDays: 30, now: NOW });
    expect(factSeller(ganador!)).toBe("conserje");
  });
});

describe("el embudo cuenta personas, no clics", () => {
  it("un visitante que recarga cinco veces es una visita", () => {
    // Contarlas como cinco infla el embudo del vendedor que más recargas provoca.
    const recargas = [1, 2, 3, 4, 5].map((n) =>
      fact("conserje", "visit", n, { visitor_id: "vis-1" })
    );
    const pasos = funnel(recargas);
    expect(pasos.find((p) => p.stage === "visit")!.count).toBe(1);
  });

  it("la ficha manda sobre la cookie: el mismo señor con dos navegadores es uno", () => {
    const pasos = funnel([
      fact("conserje", "visit", 3, { customer_id: "c1", visitor_id: "vis-movil" }),
      fact("conserje", "visit", 2, { customer_id: "c1", visitor_id: "vis-portatil" }),
    ]);
    expect(pasos.find((p) => p.stage === "visit")!.count).toBe(1);
  });

  it("la conversión se mide contra la etapa anterior", () => {
    const pasos = funnel([
      ...["a", "b", "c", "d"].map((v) => fact("conserje", "visit", 5, { visitor_id: v })),
      ...["a", "b"].map((v) => fact("conserje", "signup", 4, { visitor_id: v })),
      fact("conserje", "booking", 3, { visitor_id: "a" }),
      fact("conserje", "purchase", 2, { visitor_id: "a" }),
    ]);
    expect(pasos.map((p) => p.count)).toEqual([4, 2, 1, 1]);
    expect(pasos[0].conversionPct).toBeNull();     // la primera no convierte de nada
    expect(pasos[1].conversionPct).toBe(50);
    expect(pasos[2].conversionPct).toBe(50);
    expect(pasos[3].conversionPct).toBe(100);
  });

  it("sin visitas, la conversión es «no se sabe» y no «cero por ciento»", () => {
    // Pintar 0 % diría que el vendedor convierte mal; lo que pasa es que aún
    // no ha traído a nadie.
    const pasos = funnel([]);
    expect(pasos.every((p) => p.count === 0)).toBe(true);
    expect(pasos.every((p) => p.conversionPct === null)).toBe(true);
  });

  it("las cuatro etapas salen siempre, aunque estén en cero", () => {
    // Una etapa que desaparece del gráfico se lee como si no existiera.
    const pasos = funnel([fact("conserje", "purchase", 1, { customer_id: "c1" })]);
    expect(pasos.map((p) => p.stage)).toEqual(["visit", "signup", "booking", "purchase"]);
  });

  it("una etapa inventada no entra en el embudo", () => {
    const pasos = funnel([{ id: "x", seller_id: "v", stage: "curioseo", created_at: daysAgo(1) }]);
    expect(pasos.every((p) => p.count === 0)).toBe(true);
  });
});

describe("el slug que va impreso en el QR", () => {
  it("se teclea a mano el día que la cámara falla, así que no lleva nada raro", () => {
    expect(slugify("Rafael Núñez")).toBe("RAFAELNUNEZ");
    // Y se corta a 16: lo que no cabe bajo el QR impreso se teclea peor.
    expect(slugify("hotel-bahía_príncipe")).toBe("HOTELBAHIAPRINCI");
    expect(slugify("")).toBe("");
  });

  it("no lleva las letras que se confunden leyendo de un papel", () => {
    // O/0, I/1/L, S/5, B/8: un slug mal tecleado no lleva a ningún sitio y
    // nadie sabe por qué.
    const muchos = Array.from({ length: 200 }, (_, i) => randomSuffix(6, () => i / 200));
    expect(muchos.join("")).not.toMatch(/[OI1L0S5B8]/);
  });

  it("el slug propuesto parte del código comercial, no del nombre", () => {
    // El nombre cambia —una persona se casa, un hotel cambia de marca— y el QR
    // ya está impreso y pegado.
    const slug = proposeSlug("RAF-00125", () => 0);
    expect(slug.startsWith("RAF00125")).toBe(true);
    expect(slug).toHaveLength(12);
  });

  it("un vendedor sin código todavía tiene enlace", () => {
    expect(proposeSlug(null, () => 0).startsWith("VEN")).toBe(true);
    expect(proposeSlug("", () => 0).startsWith("VEN")).toBe(true);
  });

  it("la URL no lleva barra final duplicada ni se rompe con el dominio con barra", () => {
    expect(linkUrl("https://a.com", "RAF001")).toBe("https://a.com/e/RAF001");
    expect(linkUrl("https://a.com/", "RAF001")).toBe("https://a.com/e/RAF001");
  });
});

describe("el cuadro comparativo de la red", () => {
  it("ordena por compras y, a igualdad, por clientes captados", () => {
    // Dos vendedores con una venta cada uno no son lo mismo si uno trajo veinte
    // clientes y el otro dos.
    const filas = sellerLeaderboard([
      fact("flojo", "signup", 5, { customer_id: "c1", seller_name: "Flojo" }),
      fact("flojo", "purchase", 4, { customer_id: "c1" }),
      fact("bueno", "signup", 5, { customer_id: "c2", seller_name: "Bueno" }),
      fact("bueno", "signup", 5, { customer_id: "c3" }),
      fact("bueno", "purchase", 4, { customer_id: "c2" }),
    ]);
    expect(filas.map((f) => f.seller_id)).toEqual(["bueno", "flojo"]);
    expect(filas[0].signups).toBe(2);
    expect(filas[0].seller_name).toBe("Bueno");
  });

  it("el cierre sobre visitas es nulo cuando no hubo visitas, no cero", () => {
    const filas = sellerLeaderboard([
      fact("mostrador", "purchase", 1, { customer_id: "c1", seller_name: "Mostrador" }),
    ]);
    expect(filas[0].closePct).toBeNull();
    expect(filas[0].purchases).toBe(1);
  });

  it("calcula el cierre cuando sí hubo visitas", () => {
    const filas = sellerLeaderboard([
      ...["a", "b", "c", "d"].map((v) =>
        fact("conserje", "visit", 5, { visitor_id: v, seller_name: "Conserje" })
      ),
      fact("conserje", "purchase", 2, { visitor_id: "a" }),
    ]);
    expect(filas[0].closePct).toBe(25);
  });

  it("los hechos sin vendedor no crean una fila fantasma", () => {
    const filas = sellerLeaderboard([{ id: "x", stage: "visit", created_at: daysAgo(1) }]);
    expect(filas).toEqual([]);
  });
});
