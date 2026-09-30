import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * «ACTIVO CAÍDO → CUPO CAÍDO», PROBADO POR PRIMERA VEZ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE FICHERO NO EXISTÍA
 *
 * `asset-impact.ts` son doscientas veinte líneas que cierran salidas, arrastran
 * atracciones y **crean tareas urgentes para avisar a clientes que se quedan
 * sin plaza**, y no tenía ni una prueba. No es casualidad: su ruta no la
 * llamaba nadie, así que el motor no se ejecutaba nunca. Un motor que no se
 * ejecuta no se nota que está sin probar.
 *
 * Al darle puerta (30-sep) pasa a correr de verdad, y entonces todo lo que hace
 * importa. Estas pruebas cubren las dos mitades que de verdad duelen si se
 * rompen: que bajar un activo **deje de vender** las plazas que ya no existen,
 * y que **nadie se quede sin aviso**.
 */

const tenantQuery = vi.fn();
const tenantFindOne = vi.fn();
const tenantUpdate = vi.fn();
const tenantCreate = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantFindOne: (...a: unknown[]) => tenantFindOne(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
  };
});

import { changeAssetStatus } from "@/lib/asset-impact";

const ORG = "org-1";

/** Una guagua de 20 plazas que bloquea cupo, ligada a un vehículo y a una atracción. */
const GUAGUA = {
  _id: "asset-1", name: "Guagua 1", operational_status: "in_service",
  blocks_capacity: true, capacity: 20,
  vehicle: { _id: "veh-1" }, attraction: { _id: "atr-1", operational_status: "open" },
};

/** Una salida de 40 plazas con 35 vendidas: al perder 20 se queda corta. */
const SALIDA = {
  _id: "dep-1", capacity: 40, booked_pax: 35, status: "available",
  departure_at: new Date(Date.now() + 86_400_000).toISOString(),
  product: { name: "Isla Saona" }, notes: "",
};

const RESERVAS = [
  { _id: "b-1", booking_number: "RES-001", pax_total: 10, customer: { first_name: "Ana", last_name: "Pérez" } },
  { _id: "b-2", booking_number: "RES-002", pax_total: 4, customer: { first_name: "Luis", last_name: "Gómez" } },
];

function montar({ reservas = RESERVAS, salida = SALIDA, activo = GUAGUA } = {}) {
  tenantFindOne.mockResolvedValue(activo);
  tenantQuery.mockImplementation(async (_org: string, tabla: string) => {
    if (tabla === "departure_resource") return [{ departure: salida }];
    if (tabla === "booking") return reservas;
    return [];
  });
  tenantUpdate.mockResolvedValue({});
  tenantCreate.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bajar un activo deja de vender lo que ya no existe", () => {
  it("recalcula el cupo y CIERRA la salida que no se puede servir", async () => {
    montar();
    const impacto = await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1" });

    const afectada = impacto.departuresAffected[0];
    expect(afectada.capacityBefore).toBe(40);
    expect(afectada.capacityAfter, "no se restaron las plazas de la guagua").toBe(20);
    // 35 vendidas contra 20 que quedan.
    expect(afectada.oversold, "no se detectó la sobreventa").toBe(15);
    expect(afectada.closed, "la salida sigue abierta sin poder servirse").toBe(true);

    const escritura = tenantUpdate.mock.calls.find((c) => c[1] === "departure");
    expect(escritura, "la salida no se llegó a escribir").toBeTruthy();
    /**
     * Cerrar la salida es LO ÚNICO que para la siguiente venta. Sin esto el
     * cupo queda a cero y el punto de venta sigue ofreciéndola.
     */
    expect(escritura![3].status, "la salida no se cerró").toBe("closed");
    expect(escritura![3].available_pax, "quedaron plazas libres sobre un cupo que no existe").toBe(0);
  });

  it("y devolver el activo a servicio restituye el cupo", async () => {
    montar({ activo: { ...GUAGUA, operational_status: "out_of_service" }, salida: { ...SALIDA, capacity: 20, status: "closed" } });
    const impacto = await changeAssetStatus(ORG, "asset-1", "in_service", { userId: "u1" });

    expect(impacto.departuresAffected[0].capacityAfter, "no se devolvieron las plazas").toBe(40);
    const escritura = tenantUpdate.mock.calls.find((c) => c[1] === "departure");
    expect(escritura![3].status, "la salida se quedó cerrada").toBe("available");
  });

  it("un activo que NO bloquea cupo no toca ninguna salida", async () => {
    montar({ activo: { ...GUAGUA, blocks_capacity: false } });
    const impacto = await changeAssetStatus(ORG, "asset-1", "maintenance", { userId: "u1" });

    expect(impacto.departuresAffected, "tocó salidas sin bloquear cupo").toEqual([]);
    expect(tenantUpdate.mock.calls.some((c) => c[1] === "departure"),
      "escribió una salida sin bloquear cupo").toBe(false);
  });
});

describe("nadie se queda sin aviso", () => {
  it("nombra las reservas que quedan sobre el cupo y abre una tarea urgente", async () => {
    montar();
    const impacto = await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1" });

    /**
     * Sobran 15 plazas y las dos reservas suman 14, así que se nombran las dos.
     * Lo que importa no es el reparto exacto sino que lleguen CON NOMBRE: una
     * lista de identificadores no sirve para descolgar el teléfono.
     */
    expect(impacto.bookingsAtRisk.map((b) => b.bookingNumber)).toContain("RES-001");
    expect(impacto.bookingsAtRisk[0].customer, "la reserva llega sin nombre de cliente").toBe("Ana Pérez");

    const tarea = tenantCreate.mock.calls.find((c) => c[1] === "task");
    expect(tarea, "no se creó la tarea para llamar a los clientes").toBeTruthy();
    expect(tarea![2].priority, "la tarea no es urgente").toBe("urgent");
    expect(tarea![2].description, "la tarea no dice a quién hay que llamar").toContain("RES-001");
  });

  it("la atracción que depende del activo cae con él, y queda en la bitácora", async () => {
    montar();
    await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1" });

    const atraccion = tenantUpdate.mock.calls.find((c) => c[1] === "attraction");
    expect(atraccion, "la atracción no siguió al activo").toBeTruthy();
    expect(atraccion![3].operational_status).toBe("maintenance");

    const bitacora = tenantCreate.mock.calls.find((c) => c[1] === "attraction_log");
    expect(bitacora, "el arrastre no quedó en la bitácora").toBeTruthy();
    expect(bitacora![2].to_status).toBe("maintenance");
    expect(bitacora![2].reason, "la bitácora no dice qué activo lo causó").toContain("Guagua 1");
  });

  it("sin sobreventa no se inventa una tarea", async () => {
    montar({ salida: { ...SALIDA, booked_pax: 5 } });
    const impacto = await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1" });

    expect(impacto.bookingsAtRisk, "nombró reservas sin sobreventa").toEqual([]);
    expect(tenantCreate.mock.calls.some((c) => c[1] === "task"),
      "abrió una tarea urgente sin nadie a quien llamar").toBe(false);
  });
});

describe("la previsualización enseña la consecuencia sin causarla", () => {
  it("no escribe NADA", async () => {
    montar();
    await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1", dryRun: true });

    expect(tenantUpdate, "una previsualización escribió en la base").not.toHaveBeenCalled();
    expect(tenantCreate, "una previsualización creó filas").not.toHaveBeenCalled();
  });

  it("y aun así dice A QUIÉN deja fuera, que es de lo que sirve", async () => {
    /**
     * Esto estaba roto: el cálculo de las reservas en riesgo vivía DEBAJO del
     * `continue` del dry run, así que la previsualización sabía decir «quince
     * plazas de más» y no de quién. Y la previsualización es justo donde
     * alguien decide si pulsa o no.
     */
    montar();
    const impacto = await changeAssetStatus(ORG, "asset-1", "out_of_service", { userId: "u1", dryRun: true });

    expect(impacto.departuresAffected[0].closed, "no anticipó que la salida se cierra").toBe(true);
    expect(impacto.bookingsAtRisk.length, "la previsualización no dice a quién deja fuera")
      .toBeGreaterThan(0);
    expect(impacto.bookingsAtRisk[0].customer).toBe("Ana Pérez");
  });

  it("y no se queja de que el activo ya esté en ese estado", async () => {
    // Al abrir el diálogo se previsualiza contra el estado actual; que eso
    // reventara dejaría la pantalla sin poder enseñar nada.
    montar();
    await expect(changeAssetStatus(ORG, "asset-1", "in_service", { dryRun: true }))
      .resolves.toBeTruthy();
    await expect(changeAssetStatus(ORG, "asset-1", "in_service", {}))
      .rejects.toThrow(/ya está en estado/);
  });
});
