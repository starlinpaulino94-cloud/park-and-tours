import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import type { PublicRequest } from "@/lib/public-booking";

/**
 * EL MOTOR PÚBLICO CONTRA LA BASE, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES LA ÚNICA ESCRITURA SIN SESIÓN DE TODO EL SISTEMA
 *
 * Las reglas de qué se acepta del cliente viven en `public-booking.ts` y están
 * probadas. Lo que decide ESTE fichero es lo que pasa cuando la base contesta
 * mal, que es donde un motor público se rompe en silencio:
 *
 *   · un error de lectura que sale como «esta empresa no existe»;
 *   · un error de lectura que sale como «esta operadora no tiene excursiones»;
 *   · y un error de lectura que crea una ficha de cliente duplicada y la cuenta
 *     como captación nueva — que es la única de las tres que cuesta dinero.
 *
 * Ninguna de las tres se ve leyendo el módulo puro, porque las tres son sobre
 * qué se hace con el `error` que PostgREST devuelve en vez de lanzar.
 */

let db: FakeDb;
let sb: FakeSupabase;

const ventaCreada = vi.fn(async (_ctx: unknown, _entrada: Record<string, unknown>) => ({
  order: { _id: "ord-1", order_number: "ORD-001", total: 200, currency: "usd" },
  bookings: [{ _id: "bk-1", booking_number: "RES-001", travel_date: "2026-10-02T13:00:00.000Z" }],
}));
const visitanteEnlazado = vi.fn((_org: string, _visitor: unknown, _cliente: string) => {});
const huellaApuntada = vi.fn((_huella: Record<string, unknown>) => {});
let enlaceDelSlug: { companyId: string; sellerId: string; linkId: string; channel: string | null; campaign: string | null } | null = null;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/booking-service", () => ({
  createOrderWithBookings: (ctx: unknown, entrada: Record<string, unknown>) => ventaCreada(ctx, entrada),
}));
vi.mock("@/lib/attribution-service", () => ({
  linkVisitorToCustomer: (org: string, visitor: unknown, cliente: string) =>
    visitanteEnlazado(org, visitor, cliente),
  recordTouch: (huella: Record<string, unknown>) => huellaApuntada(huella),
  resolveLinkBySlug: async () => enlaceDelSlug,
}));

import {
  loadPublicPage, loadPublicDepartures, createPublicBooking,
} from "@/lib/public-booking-service";

const ORG = "org-1";

const peticion = (over: Partial<PublicRequest> = {}): PublicRequest => ({
  productId: "prod-1",
  departureId: "sal-1",
  date: null,
  adults: 2,
  children: 0,
  infants: 0,
  name: "Laura Gutiérrez",
  email: "laura@example.com",
  phone: "",
  hotel: "Bahía Príncipe",
  room: "412",
  notes: "",
  language: "es",
  ...over,
} as PublicRequest);

const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  enlaceDelSlug = null;
  db = fakeDb();
  sb = fakeSupabase(db);

  db.seed("organizations", [{
    _id: ORG, organization_id: ORG, slug: "tours-del-este", kind: "tenant",
    name: "Tours del Este", status: "active", public_booking_enabled: true,
    subscription_status: "active", currency: "usd", phone: "809-555-0001",
    public_intro: "Bienvenido", public_terms: "Condiciones", email: "hola@tours.do",
  }]);
  db.seed("product", [
    { _id: "prod-1", organization_id: ORG, name: "Isla Saona", published: true,
      status: "active", base_price: 100, currency: "usd", featured: true, sort_order: 1 },
    { _id: "prod-borrador", organization_id: ORG, name: "Ruta nueva", published: false,
      status: "active", base_price: 0, currency: "usd", sort_order: 2 },
  ]);
  db.seed("departure", [
    { _id: "sal-1", organization_id: ORG, product: "prod-1", departure_at: futuro(3),
      capacity: 40, available_pax: 12, status: "available", meeting_point: "Muelle" },
  ]);
});

/* ═══════════════════════════════════════ la página y su catálogo ══ */

describe("la página pública", () => {
  it("se arma con la empresa y solo con los productos publicados", async () => {
    const page = await loadPublicPage("tours-del-este");
    expect(page.state).toBe("ok");
    expect(page.org?.name).toBe("Tours del Este");
    expect(page.products.map((p) => p.id)).toEqual(["prod-1"]);
    expect(page.acceptsRequests).toBe(true);
  });

  it("un slug que no existe es «not_found», y sin empresa dentro", async () => {
    const page = await loadPublicPage("no-existe");
    expect(page.state).toBe("not_found");
    expect(page.org).toBeNull();
    expect(page.products).toEqual([]);
  });

  it("con el interruptor apagado se ve «disabled», no el catálogo", async () => {
    await db.tenantUpdate(ORG, "organizations", ORG, { public_booking_enabled: false });
    const page = await loadPublicPage("tours-del-este");
    expect(page.state).toBe("disabled");
    expect(page.products).toEqual([]);
  });

  it("la API de socios arma el catálogo aunque la página esté apagada", async () => {
    // Vender por API y tener escaparate son dos decisiones distintas. Lo que NO
    // cambia es qué sale: siguen siendo solo los publicados.
    await db.tenantUpdate(ORG, "organizations", ORG, { public_booking_enabled: false });
    const page = await loadPublicPage("tours-del-este", { ignoreSwitch: true });
    expect(page.state).toBe("ok");
    expect(page.products.map((p) => p.id)).toEqual(["prod-1"]);
  });

  it("pero a una empresa suspendida no le abre la puerta el atajo", async () => {
    await db.tenantUpdate(ORG, "organizations", ORG, { status: "suspended" });
    const page = await loadPublicPage("tours-del-este", { ignoreSwitch: true });
    expect(page.state).toBe("suspended");
    expect(page.org).toBeNull();
  });

  it("un socio no tiene página, aunque comparta el slug", async () => {
    db.seed("organizations", [{
      _id: "soc-org", organization_id: "soc-org", slug: "agencia", kind: "partner",
      name: "Agencia", status: "active", public_booking_enabled: true,
    }]);
    const page = await loadPublicPage("agencia");
    expect(page.state).toBe("not_found");
  });

  it("la suscripción vencida deja la página EN PIE y cierra el formulario", async () => {
    // El teléfono delante salva la venta que el bloqueo iba a matar.
    await db.tenantUpdate(ORG, "organizations", ORG, {
      subscription_status: "suspended",
    });
    const page = await loadPublicPage("tours-del-este");
    expect(page.state).toBe("ok");
    expect(page.products).toHaveLength(1);
    expect(page.acceptsRequests).toBe(false);
  });

  it("NO PODER LEER LA EMPRESA no es que la empresa no exista", async () => {
    /**
     * PostgREST no lanza: devuelve `{data: null, error}`. Descartando el error,
     * un hipo de la base convertía la página viva de una operadora en un 404
     * —«esta empresa no existe»—, que es la respuesta más caras de todas: el
     * cliente que hizo clic en el anuncio cree que cerraron, y el 404 se queda
     * en los índices.
     */
    sb.breakReads("organizations", "conexión perdida");
    await expect(loadPublicPage("tours-del-este")).rejects.toThrow(/No se pudo leer la empresa/);
  });

  it("NO PODER LEER EL CATÁLOGO no es que no haya excursiones", async () => {
    /**
     * `rows ?? []` dibujaba la página entera, con su logo y su teléfono, y sin
     * nada que comprar. Nadie se enteraba —ni un log— y la caché de la ruta lo
     * servía otro medio minuto.
     */
    sb.breakReads("product", "conexión perdida");
    await expect(loadPublicPage("tours-del-este")).rejects.toThrow(/No se pudo leer el catálogo/);
  });
});

/* ═════════════════════════════════════════════════ las fechas ══ */

describe("las salidas que se ofrecen", () => {
  it("solo futuras, abiertas y con plaza", async () => {
    db.seed("departure", [
      { _id: "sal-pasada", organization_id: ORG, product: "prod-1", departure_at: futuro(-2),
        capacity: 40, available_pax: 10, status: "available" },
      { _id: "sal-llena", organization_id: ORG, product: "prod-1", departure_at: futuro(5),
        capacity: 40, available_pax: 0, status: "available" },
      { _id: "sal-cerrada", organization_id: ORG, product: "prod-1", departure_at: futuro(6),
        capacity: 40, available_pax: 8, status: "closed" },
    ]);
    const salidas = await loadPublicDepartures(ORG, "prod-1");
    expect(salidas.map((s) => s.id)).toEqual(["sal-1"]);
  });

  it("sin capacidad declarada, las plazas son «no aplica» y la fecha se ofrece", async () => {
    // `null` nunca es cero: una salida sin techo no es una salida agotada.
    db.seed("departure", [
      { _id: "sal-sin-tope", organization_id: ORG, product: "prod-1", departure_at: futuro(7),
        status: "available" },
    ]);
    const salidas = await loadPublicDepartures(ORG, "prod-1");
    const sinTope = salidas.find((s) => s.id === "sal-sin-tope");
    expect(sinTope?.seatsLeft).toBeNull();
  });

  it("las de otro producto no se cuelan", async () => {
    db.seed("departure", [
      { _id: "sal-otra", organization_id: ORG, product: "prod-borrador", departure_at: futuro(4),
        capacity: 10, available_pax: 5, status: "available" },
    ]);
    const salidas = await loadPublicDepartures(ORG, "prod-1");
    expect(salidas.map((s) => s.id)).toEqual(["sal-1"]);
  });

  it("NO PODER LEERLAS no es «no hay fechas disponibles»", async () => {
    sb.breakReads("departure", "conexión perdida");
    await expect(loadPublicDepartures(ORG, "prod-1")).rejects.toThrow(/No se pudieron leer las salidas/);
  });
});

/* ══════════════════════════════════════════════ crear la reserva ══ */

describe("un desconocido pide una reserva", () => {
  const pagina = () => loadPublicPage("tours-del-este");

  it("crea la ficha del cliente y devuelve la referencia", async () => {
    const out = await createPublicBooking(await pagina(), peticion(), null);
    expect(out.reference).toBe("RES-001");
    expect(out.orderNumber).toBe("ORD-001");

    const fichas = await db.tenantQuery(ORG, "customer", {});
    expect(fichas).toHaveLength(1);
    expect(fichas[0].first_name).toBe("Laura");
    expect(fichas[0].source, "no se marcó como entrada por la web").toBe("web");
  });

  it("reutiliza la ficha que ya existe por correo", async () => {
    db.seed("customer", [
      { _id: "cli-1", organization_id: ORG, email: "laura@example.com", first_name: "Laura", language: "es" },
    ]);
    await createPublicBooking(await pagina(), peticion(), null);
    const fichas = await db.tenantQuery(ORG, "customer", {});
    expect(fichas, "se duplicó la ficha").toHaveLength(1);
  });

  it("y por teléfono cuando no hay correo", async () => {
    db.seed("customer", [
      { _id: "cli-2", organization_id: ORG, phone: "809-111-2222", first_name: "Pedro" },
    ]);
    await createPublicBooking(await pagina(), peticion({ email: "", phone: "809-111-2222" }), null);
    expect(await db.tenantQuery(ORG, "customer", {})).toHaveLength(1);
  });

  it("el idioma de la ficha se refresca con el de esta reserva", async () => {
    // Quien reservó en español el año pasado y hoy reserva en inglés está
    // diciendo en qué idioma quiere el recordatorio de la víspera.
    db.seed("customer", [
      { _id: "cli-1", organization_id: ORG, email: "laura@example.com", first_name: "Laura", language: "es" },
    ]);
    await createPublicBooking(await pagina(), peticion({ language: "en" } as never), null);
    const [ficha] = await db.tenantQuery(ORG, "customer", { _filter: { _id: "cli-1" } });
    expect(ficha.language).toBe("en");
  });

  it("NO PODER BUSCAR LA FICHA no es que el cliente no exista", async () => {
    /**
     * Es la única de las tres lecturas que cuesta dinero. Descartando el error,
     * un fallo caía de largo hasta el `insert`: ficha duplicada, y `created` a
     * `true`. Y `created` es lo que distingue «cliente captado» de «cliente que
     * vuelve»: un repetidor contado como captación le apunta al conserje del
     * hotel una captación que no hizo, y las captaciones se pagan.
     */
    sb.breakReads("customer", "conexión perdida");
    await expect(createPublicBooking(await pagina(), peticion(), null))
      .rejects.toThrow(/No se pudo buscar la ficha/);
    expect(ventaCreada, "se creó la venta con una ficha inventada").not.toHaveBeenCalled();
  });

  it("y sin ficha nueva no se apunta ninguna captación", async () => {
    sb.breakReads("customer");
    await expect(createPublicBooking(await pagina(), peticion(), null)).rejects.toThrow();
    expect(huellaApuntada).not.toHaveBeenCalled();
  });

  it("la venta entra por la misma puerta que el punto de venta", async () => {
    await createPublicBooking(await pagina(), peticion(), null);
    expect(ventaCreada).toHaveBeenCalledTimes(1);
    const entrada = ventaCreada.mock.calls[0][1];
    expect(entrada.channel).toBe("web");
    expect(entrada.partner_id).toBeNull();
    // Nada con valor económico viaja desde el formulario.
    expect(entrada).not.toHaveProperty("total");
    expect(entrada).not.toHaveProperty("unit_price_override");
  });

  it("con llave de API, la reserva es DEL SOCIO y por su canal", async () => {
    // Sin esto nacía sin socio, y con ella se caían su comisión, su crédito, su
    // cupo, su contrato y su propia pantalla de reservas.
    await createPublicBooking(await pagina(), peticion(), null, {}, "soc-1");
    const entrada = ventaCreada.mock.calls[0][1];
    expect(entrada.partner_id).toBe("soc-1");
    expect(entrada.channel, "un canal propio le daría otro precio al mismo socio").toBe("b2b_portal");
  });

  it("la cookie del visitante viaja, y se enlaza con la ficha", async () => {
    await createPublicBooking(await pagina(), peticion(), null, { visitorId: "vis-1" });
    expect(visitanteEnlazado).toHaveBeenCalledWith(ORG, "vis-1", expect.any(String));
    const entrada = ventaCreada.mock.calls[0][1];
    expect(entrada.visitor_id).toBe("vis-1");
  });

  it("un enlace de referido de OTRA empresa no atribuye nada", async () => {
    // La cookie la escribe el cliente: creerle sería dejar que cualquiera se
    // atribuyera las ventas de la operadora entera editando una cadena.
    enlaceDelSlug = { companyId: "org-ajena", sellerId: "vend-x", linkId: "lnk-x", channel: null, campaign: null };
    await createPublicBooking(await pagina(), peticion(), null, { referralSlug: "qr-de-otro" });
    expect(huellaApuntada).not.toHaveBeenCalled();
  });

  it("el de esta empresa sí, y solo la primera vez", async () => {
    enlaceDelSlug = { companyId: ORG, sellerId: "vend-1", linkId: "lnk-1", channel: "qr", campaign: null };
    await createPublicBooking(await pagina(), peticion(), null, { referralSlug: "qr-conserje" });
    expect(huellaApuntada).toHaveBeenCalledTimes(1);
    expect(huellaApuntada.mock.calls[0][0].stage).toBe("signup");

    // La segunda reserva del mismo señor ya no es una captación.
    huellaApuntada.mockClear();
    await createPublicBooking(await pagina(), peticion(), null, { referralSlug: "qr-conserje" });
    expect(huellaApuntada).not.toHaveBeenCalled();
  });

  it("la petición original se guarda pegada a la reserva", async () => {
    db.seed("booking", [{ _id: "bk-1", organization_id: ORG, booking_number: "RES-001" }]);
    await createPublicBooking(await pagina(), peticion(), null);
    const [reserva] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-1" } });
    expect((reserva.public_request as { room?: string })?.room).toBe("412");
  });

  it("y si no se puede guardar, la reserva NO se cae", async () => {
    /**
     * Al revés que las lecturas de arriba. Aquí la reserva ya existe: contestar
     * error haría que el cliente volviera a reservar y pagara dos veces por no
     * haber podido guardar una copia del formulario.
     */
    sb.breakWrites("booking", "la base rechazó la escritura");
    const real = console.error;
    console.error = () => {};
    try {
      const out = await createPublicBooking(await pagina(), peticion(), null);
      expect(out.reference).toBe("RES-001");
    } finally {
      console.error = real;
    }
  });

  it("sin empresa en la página, no se escribe nada", async () => {
    const vacia = await loadPublicPage("no-existe");
    await expect(createPublicBooking(vacia, peticion(), null)).rejects.toMatchObject({ status: 404 });
    expect(ventaCreada).not.toHaveBeenCalled();
  });
});
