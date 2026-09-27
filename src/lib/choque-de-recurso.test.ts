import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LA MISMA GUAGUA NO PUEDE ESTAR EN DOS SITIOS A LA VEZ — Y AHORA LA ESCRITURA
 * LO IMPIDE.
 *
 * `resourceConflicts` existía desde la ola 5 para PINTAR EN ROJO la mesa de
 * despacho del día que alguien estuviera mirando. Nunca impidió una escritura:
 * asignar la misma guagua a dos salidas que se pisan por la pantalla genérica,
 * desde el móvil o por la API funcionaba sin una queja.
 *
 * Lo que se prueba aquí es sobre todo lo que NO bloquea, porque una comprobación
 * que bloquea de más se acaba quitando.
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

import { choquesDeLaFila, assertPayloadSinChoque, CONFLICT_FIELDS } from "@/lib/choque-de-recurso";

const EMPRESA = { _id: "c1", name: "Park and Tours", timezone: "America/Santo_Domingo" } as never;
const GUAGUA = "v1";

/** Una salida de 8 h que arranca a la hora dada (UTC). */
const salida = (id: string, horaUtc: string) => ({
  _id: id, departure_at: `2026-03-10T${horaUtc}:00Z`, duration_hours: 8,
  product: { _id: "p1", name: `Tour ${id}` },
});

beforeEach(() => {
  db = fakeDb();
  db.seed("departure", [
    salida("dep-manana", "12"),   // 08:00 local → 16:00 local
    salida("dep-tarde", "20"),    // 16:00 local → 00:00 local
    salida("dep-pisa", "14"),     // 10:00 local: se pisa con la de la mañana
  ]);
});

describe("lo que SÍ es un choque", () => {
  it("la misma guagua en dos salidas que se pisan", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", vehicle: GUAGUA,
    });
    expect(choques).toHaveLength(1);
    expect(choques[0].resourceId).toBe(GUAGUA);
    // El mensaje nombra al recurso y a la otra salida: un «no se puede» sin motivo
    // acaba en una llamada de teléfono — y en que alguien quite la comprobación.
    expect(choques[0].mensaje).toContain("Coaster");
    expect(choques[0].mensaje).toContain("Tour dep-pisa");
    expect(choques[0].departureId).toBe("dep-pisa");
  });

  it("y la misma PERSONA, no solo el vehículo", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", staff: { _id: "s1", full_name: "Pedro" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", staff: "s1",
    });
    expect(choques.map((c) => c.kind)).toEqual(["staff"]);
  });

  it("CRUZANDO LAS DOS TABLAS, que es el caso que no veía ninguna pantalla", async () => {
    /**
     * La guagua puesta como vehículo de una ruta de recogida y como recurso de
     * otra salida que se pisa. La mesa de despacho no lo veía porque construía
     * sus usos leyendo solo `departure_resource`, y son dos formularios
     * distintos: es el choque más fácil de cometer.
     */
    db.seed("pickup_route", [
      { _id: "pr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", vehicle: GUAGUA,
    });
    expect(choques).toHaveLength(1);
  });

  it("y lanza 409, no 403: no es un permiso, es que no se puede", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    await expect(
      assertPayloadSinChoque(EMPRESA, "c1", "departure_resource", { departure: "dep-manana", vehicle: GUAGUA })
    ).rejects.toMatchObject({ status: 409, code: "RESOURCE_CONFLICT" });
  });
});

describe("lo que NO es un choque, y es la mitad del diseño", () => {
  it("DOS SERVICIOS EL MISMO DÍA QUE NO SE PISAN", async () => {
    /**
     * La guagua que hace el tour de las 8 y el de las 4 es la operación normal.
     * Bloquear el día completo haría inusable la pantalla, y alguien acabaría
     * quitando la comprobación — que es exactamente cómo se pierde una regla.
     */
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-tarde", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", vehicle: GUAGUA,
    });
    expect(choques).toEqual([]);
  });

  it("EL MISMO RECURSO DOS VECES EN LA MISMA SALIDA", async () => {
    /**
     * La guagua de la recogida y la guagua de la excursión son la misma guagua
     * haciendo el mismo servicio. Sin esto, asignar el vehículo a la ruta de una
     * salida que ya lo tiene como recurso fallaría SIEMPRE — y ese es el flujo
     * normal de un transportista que hace la recogida y el tour.
     */
    db.seed("departure_resource", [
      { _id: "dr-mismo", departure: "dep-manana", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "pickup_route", {
      departure: "dep-manana", vehicle: GUAGUA, start_time: "06:00",
    });
    expect(choques).toEqual([]);
  });

  it("LA FILA NO CHOCA CONSIGO MISMA al editarla", async () => {
    // Sin esto, cambiar la hora de un recurso que ya tiene la guagua puesta
    // fallaría contra su propia asignación y no habría forma de corregir nada.
    db.seed("departure_resource", [
      { _id: "dr-1", departure: "dep-manana", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(
      EMPRESA, "c1", "departure_resource", { vehicle: GUAGUA }, "dr-1"
    );
    expect(choques).toEqual([]);
  });

  it("una asignación CANCELADA no ocupa la guagua", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "cancelled" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", vehicle: GUAGUA,
    });
    expect(choques).toEqual([]);
  });

  it("ni la fila que se está escribiendo, si va cancelada", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", vehicle: GUAGUA, status: "cancelled",
    });
    expect(choques).toEqual([]);
  });

  it("una tabla que no despacha recursos no se comprueba", async () => {
    /**
     * Una incidencia, una inspección o una orden de trabajo también apuntan a un
     * vehículo, y bloquearlas sería absurdo: se registra una inspección sobre esa
     * guagua PRECISAMENTE porque tiene un problema.
     *
     * Se comprueba con una fila que por lo demás sí tendría choque —misma guagua,
     * salida que se pisa—, porque una orden de trabajo sin `departure` habría
     * salido vacía de todos modos y la prueba pasaría con la lista de tablas
     * abierta de par en par.
     */
    db.seed("departure_resource", [
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    expect(await choquesDeLaFila(EMPRESA, "c1", "work_order", {
      departure: "dep-manana", vehicle: GUAGUA,
    })).toEqual([]);
    // Y la lista es EXACTA: son las dos tablas que despachan, y ninguna más.
    expect(Object.keys(CONFLICT_FIELDS).sort()).toEqual(["departure_resource", "pickup_route"]);
  });

  it("y sin vehículo ni persona no hay nada que comprobar", async () => {
    expect(await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-manana", pax_assigned: 12,
    })).toEqual([]);
  });

  it("una fila sin salida tampoco: no se sabe cuándo ocupa", async () => {
    expect(await choquesDeLaFila(EMPRESA, "c1", "departure_resource", { vehicle: GUAGUA })).toEqual([]);
  });

  it("UN CHOQUE QUE YA ESTABA AHÍ Y NO TOCA ESTA FILA no bloquea", async () => {
    /**
     * Si el día tiene un conflicto entre otras dos salidas, escribir cualquier
     * cosa fallaría con un error que habla de algo que quien escribe no ha tocado
     * — y no podría arreglarlo, porque para arreglarlo hay que escribir.
     */
    const otra = { _id: "v9", name: "Otra", plate: "B9" };
    db.seed("departure_resource", [
      { _id: "dr-a", departure: "dep-manana", service_date: "2026-03-10", vehicle: otra, status: "planned" },
      { _id: "dr-b", departure: "dep-pisa", service_date: "2026-03-10", vehicle: otra, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-tarde", vehicle: GUAGUA,
    });
    expect(choques).toEqual([]);
  });
});

describe("la ventana cruza la medianoche", () => {
  it("UNA EXCURSIÓN NOCTURNA CHOCA CON LA DE LA MAÑANA SIGUIENTE", async () => {
    /**
     * Las asignaciones se buscan por `service_date`, que es una fecha. Una salida
     * de las 22:00 que dura cuatro horas ocupa la guagua en DOS fechas, y un
     * choque a las 00:30 es un choque igual: por eso la consulta lee el día de
     * antes y el de después, y no solo el del servicio.
     */
    db.seed("departure", [
      { _id: "dep-noche", departure_at: "2026-03-10T23:00:00Z", duration_hours: 4,
        product: { _id: "p1", name: "Fiesta en catamarán" } },
      { _id: "dep-madrugada", departure_at: "2026-03-11T01:00:00Z", duration_hours: 4,
        product: { _id: "p1", name: "Pesca de madrugada" } },
    ]);
    db.seed("departure_resource", [
      { _id: "dr-madrugada", departure: "dep-madrugada", service_date: "2026-03-11",
        vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);

    const choques = await choquesDeLaFila(EMPRESA, "c1", "departure_resource", {
      departure: "dep-noche", vehicle: GUAGUA,
    });
    expect(choques).toHaveLength(1);
    expect(choques[0].departureId).toBe("dep-madrugada");
  });
});

describe("la edición hereda lo que no manda", () => {
  it("UNA EDICIÓN QUE SOLO CAMBIA EL VEHÍCULO se comprueba contra la salida de la fila", async () => {
    /**
     * El payload de una edición así no trae ni la salida ni las horas, y sin
     * ellas no se puede calcular ninguna ventana. Calculando sobre el payload
     * suelto habría pasado el caso que más se da: crear el recurso vacío y
     * asignarle la guagua un segundo después.
     */
    db.seed("departure_resource", [
      { _id: "dr-1", departure: "dep-manana", service_date: "2026-03-10", status: "planned" },
      { _id: "dr-otra", departure: "dep-pisa", service_date: "2026-03-10", vehicle: { _id: GUAGUA, name: "Coaster", plate: "A1" }, status: "planned" },
    ]);
    const choques = await choquesDeLaFila(
      EMPRESA, "c1", "departure_resource", { vehicle: GUAGUA }, "dr-1"
    );
    expect(choques).toHaveLength(1);
  });
});
