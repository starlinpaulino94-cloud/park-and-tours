import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LOS SERVICIOS DEL PROVEEDOR, POR LO QUE DEVUELVEN.
 *
 * No se comprueba que se llame a nada: se comprueba qué sale, que es lo único
 * que importa en la pantalla del actor con más datos personales de terceros al
 * alcance.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});

import { serviciosDeProveedor } from "@/lib/servicios-proveedor";

const ORG = "org-1";
const PROV = "prov-1";
const AHORA = new Date("2026-07-15T12:00:00.000Z");

function base() {
  return fakeDb({
    product: [{ _id: "p-1", name: "Isla Saona", duration_hours: 9 }],
    departure: [
      { _id: "d-manana", product: "p-1", departure_at: "2026-07-16T07:00:00.000Z", meeting_point: "Lobby" },
      { _id: "d-tarde", product: "p-1", departure_at: "2026-07-15T17:00:00.000Z", meeting_point: "Lobby" },
      { _id: "d-ayer", product: "p-1", departure_at: "2026-07-14T07:00:00.000Z", meeting_point: "Lobby" },
    ],
    departure_resource: [
      {
        _id: "dr-1", supplier: PROV, departure: "d-tarde",
        service_date: "2026-07-15T17:00:00.000Z",
        resource_role: "vehicle", pax_assigned: 40, status: "confirmed",
        cost: 900, currency: "usd", notes: "el chofer llegó tarde dos veces",
      },
      {
        _id: "dr-ajeno", supplier: "prov-2", departure: "d-manana",
        service_date: "2026-07-16T07:00:00.000Z", resource_role: "vehicle", status: "confirmed",
      },
      {
        _id: "dr-viejo", supplier: PROV, departure: "d-ayer",
        service_date: "2026-07-14T07:00:00.000Z", resource_role: "vehicle", status: "confirmed",
      },
    ],
    pickup_route: [
      {
        _id: "pr-1", supplier: PROV, departure: "d-manana", zone: "z-1",
        service_date: "2026-07-16T07:00:00.000Z",
        name: "Bávaro AM", pax_total: 12, stops_count: 5, status: "planned",
        notes: "nota interna",
      },
    ],
    zone: [{ _id: "z-1", name: "Bávaro", code: "BAV" }],
  });
}

beforeEach(() => { db = base(); });

describe("los servicios de un proveedor", () => {
  it("LAS DOS TABLAS EN UNA SOLA LISTA, EN ORDEN", async () => {
    /**
     * Un proveedor aparece por dos sitios —como recurso de una salida y como
     * dueño de una ruta— y para él son la misma cosa: cosas que tiene que ir a
     * hacer. Devolverle dos listas le obliga a cruzarlas de cabeza.
     *
     * Y el orden es del CONJUNTO, no de cada bloque: vienen de dos consultas
     * ordenadas cada una por su lado, y sin reordenar la pantalla enseñaría
     * todos los recursos y luego todas las rutas — que es la forma de que
     * alguien se salte el servicio de las nueve porque estaba debajo del de las
     * cinco de la tarde.
     */
    db.seed("pickup_route", [{
      _id: "pr-temprano", supplier: PROV, departure: "d-tarde", zone: "z-1",
      service_date: "2026-07-15T13:00:00.000Z",
      name: "Traslado exprés", pax_total: 4, status: "planned",
    }]);

    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    /**
     * La RUTA de la una va delante del RECURSO de las cinco. Concatenando las
     * dos consultas sin reordenar saldrían primero todos los recursos, así que
     * esta línea es la que distingue «ordenado» de «ordenado por bloques».
     */
    expect(proximos.map((s) => s._id)).toEqual(["pr-temprano", "dr-1", "pr-1"]);
    expect(proximos.map((s) => s.tipo)).toEqual(["ruta", "recurso", "ruta"]);
  });

  it("lo pasado sale del revés, que es como se mira", async () => {
    const pasados = await serviciosDeProveedor(ORG, PROV, "pasados", AHORA);
    expect(pasados.map((s) => s._id)).toEqual(["dr-viejo"]);
  });

  it("NO SALE LO DE OTRO PROVEEDOR", async () => {
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    expect(proximos.map((s) => s._id)).not.toContain("dr-ajeno");
    // Y el de al lado ve lo suyo y solo lo suyo.
    const otros = await serviciosDeProveedor(ORG, "prov-2", "proximos", AHORA);
    expect(otros.map((s) => s._id)).toEqual(["dr-ajeno"]);
  });

  it("EL RECORTE SE APLICA AUNQUE EL MAPEO PIDA DE MÁS", async () => {
    /**
     * El mapeo elige a mano lo que la pantalla pinta, así que hoy no saca nada
     * que no deba. Pero es una lista escrita por una persona. Pasando las filas
     * por la lista blanca ANTES, un campo prohibido llega ya borrado y el mapeo
     * lo lee como `undefined` — el recorte no depende de que el mapeo esté bien
     * escrito.
     */
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    const texto = JSON.stringify(proximos);
    expect(texto, "el coste de su línea no es suyo").not.toContain("900");
    expect(texto, "las notas internas tampoco").not.toContain("llegó tarde");
    expect(texto).not.toContain("nota interna");
  });

  it("y sí sale lo que necesita para prestar el servicio", async () => {
    const [servicio] = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    expect(servicio).toMatchObject({
      producto: "Isla Saona",
      punto_de_encuentro: "Lobby",
      pax: 40,
      status: "confirmed",
    });
    expect(servicio.service_date).toBe("2026-07-15T17:00:00.000Z");
  });

  it("el corte es UN instante para las dos ventanas", async () => {
    /**
     * `ahora` entra como parámetro y no se lee del reloj dentro. Con dos
     * lecturas, un servicio que empieza justo ahora cabría en las dos listas o
     * en ninguna.
     */
    const justoAhora = new Date("2026-07-15T17:00:00.000Z");
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", justoAhora);
    const pasados = await serviciosDeProveedor(ORG, PROV, "pasados", justoAhora);
    const enLasDos = proximos.filter((p) => pasados.some((q) => q._id === p._id));
    expect(enLasDos, "ningún servicio puede estar en las dos listas").toEqual([]);
    // Y el que empieza exactamente ahora cuenta como próximo: todavía no pasó.
    expect(proximos.map((s) => s._id)).toContain("dr-1");
  });

  it("sin servicios, una lista vacía y no un error", async () => {
    db = fakeDb({});
    expect(await serviciosDeProveedor(ORG, PROV, "proximos", AHORA)).toEqual([]);
  });
});
