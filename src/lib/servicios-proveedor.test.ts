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
        acceptance: "pending", acceptance_deadline: "2026-07-15T16:00:00.000Z",
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
        acceptance: "accepted", confirmation_number: "CNF-2607-RUTA01",
        notes: "nota interna",
      },
    ],
    zone: [{ _id: "z-1", name: "Bávaro", code: "BAV" }],
    vehicle: [{ _id: "v-1", name: "Coaster", plate: "A123456", capacity: 30, supplier: PROV }],
    staff: [{ _id: "st-1", full_name: "Pedro Chofer", staff_type: "driver", supplier: PROV }],
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

  it("EL EJE DE LA RESPUESTA LLEGA, que es para lo que existe la pantalla", async () => {
    /**
     * `status` dice lo que la operadora sabe del recurso; `acceptance` dice lo
     * que contestó él. Si la lista blanca se comiera estas columnas —que es lo
     * que hace con toda columna que nadie declara—, el proveedor recibiría sus
     * servicios sin saber cuáles están esperando su respuesta, y la función
     * entera no se vería.
     */
    const [servicio] = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    expect(servicio.acceptance).toBe("pending");
    expect(servicio.acceptance_deadline).toBe("2026-07-15T16:00:00.000Z");
  });

  it("y en las DOS tablas, no solo en una", async () => {
    /**
     * La ruta de recogida lleva su propia lista blanca. Comprobarlo solo sobre
     * el recurso deja pasar la mutación que quita el eje de la otra — y
     * entonces el transportista ve la mitad de sus servicios esperando
     * respuesta y la otra mitad sin decir nada.
     *
     * Y se comprueba con un valor QUE NO ES EL DE POR DEFECTO: con «aceptado»
     * recortado a «no hace falta», una prueba que esperase el valor por defecto
     * pasaría exactamente igual con la columna borrada. (Pasó.)
     */
    const ruta = (await serviciosDeProveedor(ORG, PROV, "proximos", AHORA))
      .find((s) => s._id === "pr-1")!;
    expect(ruta.acceptance).toBe("accepted");
    expect(ruta.confirmation_number).toBe("CNF-2607-RUTA01");
  });

  it("y una fila sin ese eje se lee como «no hay nada que contestar»", async () => {
    // Lo desconocido es lo de hoy: antes de 0087 nadie preguntaba nada, así que
    // una fila sin la columna no puede aparecer esperando una respuesta que
    // nadie pidió.
    db.seed("pickup_route", [{
      _id: "pr-antiguo", supplier: PROV, departure: "d-manana", zone: "z-1",
      service_date: "2026-07-16T09:00:00.000Z", name: "De antes de 0087", status: "planned",
    }]);
    const ruta = (await serviciosDeProveedor(ORG, PROV, "proximos", AHORA))
      .find((s) => s._id === "pr-antiguo")!;
    expect(ruta.acceptance).toBe("not_required");
    expect(ruta.acceptance_deadline).toBeNull();
  });

  it("sin servicios, una lista vacía y no un error", async () => {
    db = fakeDb({});
    expect(await serviciosDeProveedor(ORG, PROV, "proximos", AHORA)).toEqual([]);
  });
});

describe("su flota, en la misma lista", () => {
  /**
   * Desde 8.9 el transportista decide qué guagua manda y quién la conduce. Para
   * poder cambiarlo tiene que ver lo que hay puesto — y para eso la lista lo
   * trae, con la matrícula y el nombre, y dice si todavía se puede tocar.
   */

  it("dice qué campos se asignan en cada tabla, que no son los mismos", async () => {
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    const recurso = proximos.find((s) => s._id === "dr-1")!;
    const ruta = proximos.find((s) => s._id === "pr-1")!;
    expect(recurso.asignado.map((a) => a.campo)).toEqual(["vehicle", "staff"]);
    expect(ruta.asignado.map((a) => a.campo)).toEqual(["vehicle", "driver", "guide"]);
  });

  it("y de cada uno, si apunta a un vehículo o a una persona", async () => {
    // Es lo que decide qué desplegable se le enseña: sus guaguas o su gente.
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    const ruta = proximos.find((s) => s._id === "pr-1")!;
    expect(ruta.asignado.map((a) => `${a.campo}:${a.clase}`))
      .toEqual(["vehicle:vehicle", "driver:staff", "guide:staff"]);
  });

  it("TRAE LA MATRÍCULA Y EL NOMBRE, no un identificador", async () => {
    /**
     * Sin la expansión, la pantalla recibiría un uuid y el transportista vería
     * «asignado: 3f8c…» en vez de «Coaster (A123456)» — que es lo único que le
     * permite saber si está bien puesto.
     */
    db.seed("departure_resource", [{
      _id: "dr-con-flota", supplier: PROV, departure: "d-manana",
      service_date: "2026-07-16T07:00:00.000Z", resource_role: "vehicle", status: "confirmed",
      acceptance: "accepted", vehicle: "v-1", staff: "st-1",
    }]);
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    const s = proximos.find((x) => x._id === "dr-con-flota")!;
    expect(s.asignado.find((a) => a.campo === "vehicle")).toMatchObject({
      _id: "v-1", etiqueta: "Coaster (A123456)",
    });
    expect(s.asignado.find((a) => a.campo === "staff")).toMatchObject({
      _id: "st-1", etiqueta: "Pedro Chofer",
    });
  });

  it("lo que no tiene nada puesto lo dice con null, no con una cadena vacía", async () => {
    // «sin asignar» lo escribe la pantalla; el servidor dice que no hay nada.
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);
    const recurso = proximos.find((s) => s._id === "dr-1")!;
    for (const a of recurso.asignado) {
      expect(a._id, a.campo).toBeNull();
      expect(a.etiqueta, a.campo).toBeNull();
    }
  });

  it("EL SERVIDOR DICE SI SE PUEDE ASIGNAR, y por qué no", async () => {
    /**
     * Igual que las acciones de la liquidación en 8.7: con la condición escrita
     * en el navegador, el día que cambie la regla habría que acordarse de
     * cambiarla en dos sitios — y el que se quede viejo enseña un desplegable que
     * el servidor rechaza.
     */
    db.seed("departure_resource", [
      { _id: "dr-rechazado", supplier: PROV, departure: "d-manana",
        service_date: "2026-07-16T07:00:00.000Z", status: "planned", acceptance: "rejected" },
      { _id: "dr-cancelado", supplier: PROV, departure: "d-manana",
        service_date: "2026-07-16T07:00:00.000Z", status: "cancelled", acceptance: "accepted" },
    ]);
    const proximos = await serviciosDeProveedor(ORG, PROV, "proximos", AHORA);

    const vivo = proximos.find((s) => s._id === "pr-1")!;
    expect(vivo.puede_asignar).toBe(true);
    expect(vivo.motivo_para_no_asignar).toBeNull();

    const rechazado = proximos.find((s) => s._id === "dr-rechazado")!;
    expect(rechazado.puede_asignar).toBe(false);
    expect(rechazado.motivo_para_no_asignar).toContain("Rechazaste");

    const cancelado = proximos.find((s) => s._id === "dr-cancelado")!;
    expect(cancelado.puede_asignar).toBe(false);
    expect(cancelado.motivo_para_no_asignar).toContain("cancelado");
  });

  it("y lo que ya pasó no se asigna, con su motivo", async () => {
    const pasados = await serviciosDeProveedor(ORG, PROV, "pasados", AHORA);
    const viejo = pasados.find((s) => s._id === "dr-viejo")!;
    expect(viejo.puede_asignar).toBe(false);
    expect(viejo.motivo_para_no_asignar).toContain("pasó");
  });
});
