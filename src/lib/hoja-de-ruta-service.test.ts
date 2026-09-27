import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * LA HOJA DE RUTA: QUIÉN LA ABRE Y QUIÉN LA MARCA.
 *
 * Lo que se prueba aquí es el ámbito, que es lo único que separa «la hoja del
 * chofer» de «la lista de clientes de la operadora, con teléfono, para quien
 * tenga una cuenta».
 */

let db: FakeDb;
let sb: FakeSupabase;
const auditar = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditar(...a) }));

import { loadRunSheet } from "@/lib/dispatch-service";
import { marcarParada } from "@/lib/hoja-de-ruta-service";
import type { TenantContext } from "@/lib/tenant";

const ORG = "org-1";
const PROV = "prov-1";
const RUTA = "ruta-1";
const SERVICIO = "2026-07-16T07:00:00.000Z";
const EN_HORA = new Date("2026-07-16T06:40:00.000Z");

const proveedor = (supplierId: string | null = PROV) => ({
  companyId: ORG, userId: "u-prov", role: "supplier", supplierId,
} as unknown as TenantContext & { companyId: string });

const interno = () => ({
  companyId: ORG, userId: "u-ops", role: "operations", supplierId: null,
} as unknown as TenantContext & { companyId: string });

const socio = () => ({
  companyId: ORG, userId: "u-soc", role: "partner", partnerId: "soc-1", supplierId: null,
} as unknown as TenantContext & { companyId: string });

function base() {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Operadora" }],
    supplier: [{ _id: PROV, organization_id: ORG, name: "Transporte Bávaro" }],
    product: [{ _id: "p-1", organization_id: ORG, name: "Isla Saona" }],
    departure: [{ _id: "d-1", organization_id: ORG, product: "p-1", departure_at: SERVICIO }],
    hotel: [{ _id: "h-1", organization_id: ORG, name: "Meliá", pickup_point: "Lobby principal" }],
    customer: [{ _id: "c-1", organization_id: ORG, first_name: "Ana", last_name: "Pérez", phone: "809-555-0000" }],
    booking: [{ _id: "b-1", organization_id: ORG, customer: "c-1" }],
    pickup_route: [{
      _id: RUTA, organization_id: ORG, supplier: PROV, departure: "d-1",
      service_date: SERVICIO, name: "Bávaro AM", start_time: "06:30",
    }],
    pickup: [
      {
        _id: "par-1", organization_id: ORG, route: RUTA, supplier: PROV, service_date: SERVICIO,
        booking: "b-1", hotel: "h-1", sequence: 1, planned_time: "07:00", pickup_time: "07:00",
        room: "412", pax: 2, status: "pending",
      },
      {
        _id: "par-2", organization_id: ORG, route: RUTA, supplier: PROV, service_date: SERVICIO,
        booking: "b-1", hotel: "h-1", sequence: 2, planned_time: "07:20",
        pax: 1, status: "cancelled",
      },
      /**
       * Una parada que nadie colocó, y con la hora MÁS TEMPRANA de todas.
       *
       * Está aquí para distinguir «ordenado» de «como venga»: la consulta pide
       * `sequence` ascendente, así que sin secuencia esta llega LA PRIMERA — y
       * tiene que salir la última. Sin ella, la prueba pasaba igual con el
       * orden quitado, porque los datos ya venían ordenados. (Pasó.)
       */
      {
        _id: "par-suelta", organization_id: ORG, route: RUTA, supplier: PROV, service_date: SERVICIO,
        booking: "b-1", hotel: "h-1", planned_time: "05:00", pax: 1, status: "pending",
      },
    ],
  });
}

beforeEach(() => {
  db = base();
  sb = fakeSupabase(db);
  auditar.mockClear();
});

describe("abrir la hoja de ruta", () => {
  it("el proveedor ve la suya, con lo que necesita para recoger", async () => {
    const hoja = await loadRunSheet(proveedor(), RUTA, EN_HORA);
    // La suelta al final, aunque su hora sea la más temprana y la consulta la
    // devuelva primero: una parada sin ordenar es una que nadie colocó, y
    // ponerla primera manda al chofer al sitio equivocado antes de empezar.
    expect(hoja.stops.map((s) => s.id)).toEqual(["par-1", "par-2", "par-suelta"]);
    const [primera] = hoja.stops;
    expect(primera.customer).toBe("Ana Pérez");
    expect(primera.room).toBe("412");
    expect(primera.phone).toBe("809-555-0000");
  });

  it("y CADA APERTURA QUEDA ANOTADA", async () => {
    /**
     * Es una lectura de datos personales de gente que no es suya. Una bitácora
     * que solo apunta lo que sale mal no sirve para responder «quién vio esta
     * lista».
     */
    await loadRunSheet(proveedor(), RUTA, EN_HORA);
    expect(auditar).toHaveBeenCalledTimes(1);
    expect(auditar.mock.calls[0][0]).toMatchObject({ action: "supplier.runsheet.open" });
  });

  it("EL PROVEEDOR DE AL LADO NO LA ABRE", async () => {
    await expect(loadRunSheet(proveedor("prov-2"), RUTA, EN_HORA)).rejects.toThrow(/no es tuya/i);
  });

  it("ni uno sin ficha", async () => {
    await expect(loadRunSheet(proveedor(null), RUTA, EN_HORA)).rejects.toThrow(/no es tuya/i);
  });

  it("FUERA DE LA VENTANA TAMPOCO, aunque la ruta sea suya", async () => {
    // Sin esto, la hoja de ruta es el histórico de clientes de la operadora.
    const unMesDespues = new Date("2026-08-16T07:00:00.000Z");
    await expect(loadRunSheet(proveedor(), RUTA, unMesDespues))
      .rejects.toThrow(/ya no está disponible/i);
  });

  it("un socio no tiene nada que hacer aquí", async () => {
    await expect(loadRunSheet(socio(), RUTA, EN_HORA)).rejects.toThrow(/no tienes acceso/i);
  });

  it("y el interno la abre sin ventana: es su operación", async () => {
    const unMesDespues = new Date("2026-08-16T07:00:00.000Z");
    const hoja = await loadRunSheet(interno(), RUTA, unMesDespues);
    expect(hoja.stops).toHaveLength(3);
    // Y su apertura no llena la bitácora: mira lo suyo.
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe("marcar una parada", () => {
  it("recogido, con la hora y por dónde", async () => {
    const hecho = await marcarParada(proveedor(), "par-1", "picked_up", EN_HORA);
    expect(hecho.estado).toBe("picked_up");
    const fila = db.rows("pickup").find((p) => p._id === "par-1")!;
    expect(fila.status).toBe("picked_up");
    expect(fila.marked_at).toBe(EN_HORA.toISOString());
    expect(fila.marked_via).toBe("chofer");
    expect(fila.marked_by).toBe("u-prov");
  });

  it("UN NO-SHOW ANTES DE LA HORA QUEDA ANOTADO COMO TAL", async () => {
    /**
     * No se bloquea —un chofer que no puede marcar deja la hoja a medias y la
     * operadora se queda sin saber qué pasó—, pero se anota: es lo que alguien
     * va a mirar cuando el turista reclame que el autobús nunca llegó.
     */
    const antes = new Date("2026-07-16T07:01:00.000Z");
    const hecho = await marcarParada(proveedor(), "par-1", "no_show", antes);
    expect(hecho.espero_lo_suficiente).toBe(false);
    expect(auditar.mock.calls[0][0]).toMatchObject({
      action: "pickup.no_show", severity: "warning",
    });
    expect(auditar.mock.calls[0][0].metadata).toMatchObject({ espero_lo_suficiente: false });
  });

  it("y esperando, también", async () => {
    const despues = new Date("2026-07-16T07:10:00.000Z");
    const hecho = await marcarParada(proveedor(), "par-1", "no_show", despues);
    expect(hecho.espero_lo_suficiente).toBe(true);
  });

  it("una parada CANCELADA no se marca", async () => {
    await expect(marcarParada(proveedor(), "par-2", "no_show", EN_HORA))
      .rejects.toThrow(/cancelada/i);
    expect(db.rows("pickup").find((p) => p._id === "par-2")!.status).toBe("cancelled");
  });

  it("EL DE AL LADO NO MARCA LA PARADA DE OTRO", async () => {
    await expect(marcarParada(proveedor("prov-2"), "par-1", "picked_up", EN_HORA))
      .rejects.toThrow(/no es tuya/i);
    expect(db.rows("pickup").find((p) => p._id === "par-1")!.status).toBe("pending");
  });

  it("y fuera de la ventana tampoco", async () => {
    /**
     * Si la hoja se cierra a las doce horas pero las marcas siguieran abiertas,
     * la ventana no serviría de nada: se marcaría a ciegas contra una lista que
     * ya no se puede ver.
     */
    const unMesDespues = new Date("2026-08-16T07:00:00.000Z");
    await expect(marcarParada(proveedor(), "par-1", "picked_up", unMesDespues))
      .rejects.toThrow(/ya no está disponible/i);
  });

  it("un socio tampoco", async () => {
    await expect(marcarParada(socio(), "par-1", "picked_up", EN_HORA))
      .rejects.toThrow(/no tienes acceso/i);
  });

  it("y el interno marca sin ventana, dejando constancia de que fue la casa", async () => {
    const unMesDespues = new Date("2026-08-16T07:00:00.000Z");
    await marcarParada(interno(), "par-1", "picked_up", unMesDespues);
    expect(db.rows("pickup").find((p) => p._id === "par-1")!.marked_via).toBe("operacion");
  });
});
