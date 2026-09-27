import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * LAS DOS FUENTES DEL MANIFIESTO.
 *
 * El manifiesto se arma en un solo sitio y se LEE desde dos: la sesión de quien
 * mira la pantalla, y la llave de servicio para el trabajo que lo manda por
 * correo sin tener cookies.
 *
 * Lo que se prueba aquí es la de servicio, que es la que no tiene RLS detrás: su
 * aislamiento es exactamente lo que digan sus `eq("organization_id", …)`, y un
 * olvido ahí no falla — devuelve las reservas de otra empresa.
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import { fuenteDeServicio } from "@/lib/manifest-service";

beforeEach(() => {
  db = fakeDb();
  sb = fakeSupabase(db);

  /**
   * Dos empresas con una salida cada una, y la de la otra con una reserva que
   * apunta a `dep-1` a propósito: el doble de Supabase NO aplica ámbito —respeta
   * los `eq` que el código escriba, igual que haría PostgREST con la llave de
   * servicio—, así que si la consulta pierde su filtro, la fuga se ve.
   */
  const de = (org: string, filas: Record<string, unknown>[]) =>
    filas.map((f) => ({ ...f, organization_id: org }));

  db.seed("departure", de("c1", [
    { _id: "dep-1", departure_at: "2026-03-11T11:00:00Z", status: "confirmed", capacity: 20 },
  ]));
  db.seed("departure", de("c2", [
    { _id: "dep-2", departure_at: "2026-03-11T11:00:00Z", status: "confirmed", capacity: 20 },
  ]));
  db.seed("booking", de("c1", [
    {
      _id: "b1", departure: "dep-1", booking_number: "R-001", status: "confirmed",
      adults: 2, children: 0, infants: 0, pickup_time: "07:30", room_number: "412",
      customer: { _id: "cu1", first_name: "Ana", last_name: "García" },
      pickup_hotel: { _id: "h1", name: "Bahía Príncipe", zone: { _id: "z1", name: "Bávaro" } },
    },
  ]));
  db.seed("booking", de("c2", [
    {
      _id: "b9", departure: "dep-1", booking_number: "R-999", status: "confirmed",
      adults: 1, children: 0, infants: 0,
      customer: { _id: "cu9", first_name: "Ajena", last_name: "Empresa" },
    },
  ]));
  db.seed("departure_resource", de("c1", [
    { _id: "dr1", departure: "dep-1", staff: { _id: "st1", full_name: "Luis" } },
  ]));
  db.seed("departure_resource", de("c2", [
    { _id: "dr9", departure: "dep-1", staff: { _id: "st9", full_name: "Ajeno" } },
  ]));
  db.seed("pickup_route", de("c1", [{ _id: "pr1", departure: "dep-1", name: "Bávaro norte" }]));
  db.seed("pickup_route", de("c2", [{ _id: "pr9", departure: "dep-1", name: "Ruta ajena" }]));
});

describe("la fuente de servicio", () => {
  it("LEE SOLO LAS RESERVAS DE SU EMPRESA", async () => {
    /**
     * Con la llave de servicio no hay RLS que perdone un olvido. Las dos
     * empresas tienen aquí una reserva apuntando a `dep-1` a propósito: sin el
     * filtro por empresa, el manifiesto de una operadora saldría con clientes de
     * otra dentro.
     */
    const reservas = await fuenteDeServicio().reservas("c1", "dep-1");
    expect(reservas.map((r) => r.booking_number)).toEqual(["R-001"]);
  });

  it("y solo la salida de su empresa", async () => {
    await expect(fuenteDeServicio().salida("c1", "dep-2")).rejects.toThrow();
    await expect(fuenteDeServicio().salida("c1", "dep-1")).resolves.toBeTruthy();
  });

  it("y solo el equipo de su empresa", async () => {
    const equipo = await fuenteDeServicio().equipo("c1", "dep-1");
    expect(equipo.recursos.map((r) => r._id)).toEqual(["dr1"]);
    expect(equipo.rutas.map((r) => r._id)).toEqual(["pr1"]);
  });

  it("devuelve la fila con `_id`, que es lo que el armado espera", async () => {
    // `manifestRow` lee `booking._id`. Sin esto la fila viaja sin identidad y la
    // huella del manifiesto trata dos reservas distintas como la misma.
    const reservas = await fuenteDeServicio().reservas("c1", "dep-1");
    expect(reservas[0]._id).toBe("b1");
  });
});
