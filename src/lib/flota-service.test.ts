import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * QUE NO SALGA UNA GUAGUA SIN PAPELES.
 *
 * La regla estaba escrita desde 0065 y solo pintaba de rojo la mesa de
 * despacho: nunca impidió una escritura. Lo que se prueba aquí es que ahora
 * PARA, y que para en el sitio por donde pasa todo el mundo.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
  };
});

import { assertPayloadVehicleUsable, assertVehicleUsable, VEHICLE_DISPATCH_FIELDS } from "@/lib/flota-service";

const ORG = "org-1";

function base() {
  return fakeDb({
    vehicle: [
      {
        _id: "bus-ok", organization_id: ORG, name: "Bus 1", plate: "A123",
        status: "available", insurance_expiry: "2030-01-01", inspection_expiry: "2030-01-01",
      },
      {
        _id: "bus-seguro", organization_id: ORG, name: "Bus 2", plate: "B456",
        status: "available", insurance_expiry: "2026-09-15", inspection_expiry: "2030-01-01",
      },
      {
        _id: "bus-inspeccion", organization_id: ORG, name: "Bus 3", plate: "C789",
        status: "available", insurance_expiry: "2030-01-01", inspection_expiry: "2026-01-01",
      },
      {
        _id: "bus-taller", organization_id: ORG, name: "Bus 4", plate: "D012",
        status: "maintenance", insurance_expiry: "2030-01-01", inspection_expiry: "2030-01-01",
      },
      {
        _id: "bus-vence-pronto", organization_id: ORG, name: "Bus 5", plate: "E345",
        status: "available", insurance_expiry: "2026-10-05", inspection_expiry: "2030-01-01",
      },
    ],
    departure: [
      { _id: "d-hoy", organization_id: ORG, departure_at: "2026-09-24T07:00:00.000Z" },
      { _id: "d-mes-que-viene", organization_id: ORG, departure_at: "2026-10-24T07:00:00.000Z" },
    ],
    departure_resource: [
      { _id: "dr-1", organization_id: ORG, departure: "d-mes-que-viene", resource_role: "vehicle" },
    ],
    pickup_route: [],
  });
}

beforeEach(() => { db = base(); });

const HOY = "2026-09-24";

describe("un vehículo con los papeles vencidos no se despacha", () => {
  it("con el seguro vencido, no", async () => {
    await expect(assertVehicleUsable(ORG, "bus-seguro", HOY)).rejects.toThrow(/seguro vencido/i);
  });

  it("con la inspección vencida, tampoco", async () => {
    await expect(assertVehicleUsable(ORG, "bus-inspeccion", HOY)).rejects.toThrow(/inspección vencida/i);
  });

  it("ni el que está en el taller", async () => {
    await expect(assertVehicleUsable(ORG, "bus-taller", HOY)).rejects.toThrow(/mantenimiento/i);
  });

  it("y el que los tiene en regla, sí", async () => {
    await expect(assertVehicleUsable(ORG, "bus-ok", HOY)).resolves.toBeUndefined();
  });

  it("LANZA 409 Y DICE QUÉ PAPEL, no un «no se puede» a secas", async () => {
    // No es que al usuario le falten permisos: es que la asignación no se puede
    // hacer. Y sin el motivo, esto acaba en una llamada de teléfono.
    await expect(assertVehicleUsable(ORG, "bus-seguro", HOY)).rejects.toMatchObject({
      status: 409, code: "VEHICLE_BLOCKED", kind: "insurance",
    });
  });
});

describe("la comprobación al escribir", () => {
  it("SE MIRA CONTRA EL DÍA DEL SERVICIO, NO CONTRA HOY", async () => {
    /**
     * El seguro de este vehículo vence el 5 de octubre. Hoy está en regla, así
     * que con «hoy» se podría reservarlo para un viaje del 24 de octubre — y el
     * día del viaje nadie se entera hasta que lo para la policía.
     */
    await expect(assertPayloadVehicleUsable(ORG, "departure_resource", {
      departure: "d-hoy", vehicle: "bus-vence-pronto",
    })).resolves.toBeUndefined();

    await expect(assertPayloadVehicleUsable(ORG, "departure_resource", {
      departure: "d-mes-que-viene", vehicle: "bus-vence-pronto",
    })).rejects.toThrow(/seguro vencido/i);
  });

  it("y al EDITAR se busca la salida en la fila que ya existe", async () => {
    /**
     * Una edición que solo cambia el vehículo no trae la salida. Sin leerla de
     * la fila, se comprobaría contra hoy — y bastaría con crear el recurso
     * vacío y asignarle el vehículo un segundo después para saltarse el
     * bloqueo. Es la lección que dejó la certificación del guía en 0051.
     */
    await expect(assertPayloadVehicleUsable(ORG, "departure_resource",
      { vehicle: "bus-vence-pronto" }, "dr-1")).rejects.toThrow(/seguro vencido/i);
  });

  it("la ruta de recogida también despacha vehículo", async () => {
    await expect(assertPayloadVehicleUsable(ORG, "pickup_route", {
      departure: "d-hoy", vehicle: "bus-seguro",
    })).rejects.toThrow(/seguro vencido/i);
  });

  it("y sin vehículo en el payload no se comprueba nada", async () => {
    // El formulario genérico manda sus campos en cada guardado; un recurso que
    // solo cambia la hora no tiene por qué cargar con una lectura de vehículo.
    await expect(assertPayloadVehicleUsable(ORG, "departure_resource",
      { start_time: "07:00" })).resolves.toBeUndefined();
  });

  it("LO QUE NO BLOQUEA IMPORTA TANTO COMO LO QUE BLOQUEA", async () => {
    /**
     * Una incidencia, una inspección o una orden de trabajo también apuntan a
     * un vehículo, y bloquearlas sería absurdo: se registra una inspección
     * sobre esa guagua PRECISAMENTE porque tiene los papeles vencidos.
     * Bloquear ahí la dejaría sin poder arreglarse.
     */
    for (const tabla of ["incident", "inspection", "work_order", "maintenance_plan", "asset"]) {
      expect(VEHICLE_DISPATCH_FIELDS[tabla], `${tabla} bloquea y no debería`).toBeUndefined();
      await expect(assertPayloadVehicleUsable(ORG, tabla, { vehicle: "bus-seguro" }))
        .resolves.toBeUndefined();
    }
  });
});
