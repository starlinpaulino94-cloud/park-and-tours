import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase } from "@/test/fake-supabase";

/**
 * LO QUE SE LE PAGA AL PROVEEDOR.
 *
 * El transportista cobra el viernes por lo que operó la semana. Un error aquí
 * no se nota en pantalla: se nota en la cuenta del banco, y en la conversación
 * del viernes siguiente.
 *
 * Los dos invariantes que importan, y que nadie estaba comprobando:
 *
 *   · un servicio NO se paga dos veces;
 *   · una reserva que no se operó no le debe nada a nadie.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
/**
 * El cliente de PostgREST, sobre la MISMA base en memoria.
 *
 * Hace falta porque reclamar un devengo es una escritura condicional —`update …
 * where id = ? and status in (…)`— que las ayudas de inquilino no saben
 * expresar. El doble la respeta igual que la base: si el `where` no encuentra
 * nada, no cambia nada y devuelve vacío. Es justo lo que la prueba de
 * concurrencia necesita para ser honesta.
 */
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => fakeSupabase(db) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn(), notifyRoles: vi.fn() }));

import {
  generateSupplierSettlement, cancelBookingCosts, pendingBySupplier,
} from "@/lib/supplier-settlement-service";

const ORG = "org-1";
const DESDE = new Date("2026-09-01T00:00:00.000Z");
const HASTA = new Date("2026-09-30T23:59:59.999Z");

/** Un devengo: lo que una reserva le debe a un proveedor. */
const devengo = (id: string, extra: Record<string, unknown> = {}) => ({
  _id: id, organization_id: ORG,
  supplier: "prov-bus", booking: "res-1", departure: "sal-1",
  concept: "Transporte", amount: 1200, currency: "usd",
  status: "accrued",
  ...extra,
});

function operacion(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Caribe Tours" }],
    supplier: [
      { _id: "prov-bus", organization_id: ORG, name: "Transporte del Este", currency: "usd" },
      { _id: "prov-otro", organization_id: ORG, name: "Catamaranes", currency: "usd" },
    ],
    departure: [
      { _id: "sal-1", organization_id: ORG, departure_at: "2026-09-15T13:00:00.000Z" },
      { _id: "sal-vieja", organization_id: ORG, departure_at: "2026-08-15T13:00:00.000Z" },
    ],
    booking: [
      { _id: "res-1", organization_id: ORG, departure: "sal-1", travel_date: "2026-09-15T13:00:00.000Z", status: "paid" },
      { _id: "res-2", organization_id: ORG, departure: "sal-1", travel_date: "2026-09-15T13:00:00.000Z", status: "paid" },
    ],
    booking_cost: [devengo("cost-1"), devengo("cost-2", { booking: "res-2", amount: 800 })],
    ...extra,
  });
}

beforeEach(() => { db = operacion(); });

const costes = () => db.rows("booking_cost");
const deCoste = (id: string) => costes().find((c) => c._id === id)!;

describe("liquidar a un proveedor", () => {
  it("reclama los servicios del período y los deja enlazados", async () => {
    const r = await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });

    expect(r.claimed).toBe(2);
    expect(r.services).toBe(2000);
    expect(r.currency).toBe("usd");

    // El enlace es lo que impide que un segundo intento los vuelva a cobrar.
    for (const id of ["cost-1", "cost-2"]) {
      expect(deCoste(id).status).toBe("settled");
      expect(deCoste(id).settlement).toBe(r.settlement._id);
    }
  });

  it("NO se le paga dos veces lo mismo", async () => {
    /**
     * Es el invariante que justifica el módulo entero. Un devengo ya liquidado
     * no lo puede reclamar otra liquidación: si lo hiciera, el proveedor
     * cobraría dos veces el mismo viaje y la diferencia la descubre alguien
     * cuadrando el banco, semanas después.
     */
    await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });

    await expect(
      generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA })
    ).rejects.toThrow(/no hay servicios pendientes/i);

    expect(db.rows("settlement").filter((s) => s.status !== "void")).toHaveLength(1);
  });

  it("una reserva cancelada no le debe nada al transportista", async () => {
    // Dejar el devengo vivo se lo pagaría en la liquidación del viernes.
    expect(await cancelBookingCosts(ORG, "res-2", "El cliente canceló")).toBe(1);
    expect(deCoste("cost-2").status).toBe("cancelled");

    const r = await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });
    expect(r.claimed, "solo el que sí se operó").toBe(1);
    expect(r.services).toBe(1200);
  });

  it("un servicio ya liquidado NO se cancela aunque se cancele la reserva", async () => {
    // El dinero ya salió: anular el devengo dejaría la liquidación sin respaldo.
    await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });
    expect(await cancelBookingCosts(ORG, "res-1")).toBe(0);
    expect(deCoste("cost-1").status).toBe("settled");
  });

  it("lo de otro mes no entra", async () => {
    db.seed("booking_cost", [devengo("cost-vieja", { departure: "sal-vieja", amount: 999 })]);
    const r = await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });
    expect(r.claimed).toBe(2);
    expect(deCoste("cost-vieja").status, "sigue esperando su liquidación").toBe("accrued");
  });

  it("lo de otro proveedor no entra", async () => {
    db.seed("booking_cost", [devengo("cost-ajena", { supplier: "prov-otro", amount: 500 })]);
    const r = await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });
    expect(r.services).toBe(2000);
    expect(deCoste("cost-ajena").status).toBe("accrued");
  });

  it("no se mezclan monedas en una misma liquidación", async () => {
    // Pagarle en un solo importe lo que se le debe en pesos y en dólares es
    // inventarse una tasa de cambio.
    db.seed("booking_cost", [devengo("cost-dop", { currency: "dop", amount: 60000 })]);
    await expect(
      generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA })
    ).rejects.toThrow(/cada moneda por separado/i);
  });

  it("sin nada que liquidar no se crea una liquidación viva", async () => {
    await expect(
      generateSupplierSettlement(ORG, { supplierId: "prov-otro", from: DESDE, to: HASTA })
    ).rejects.toThrow(/no hay servicios pendientes/i);
    expect(db.rows("settlement").filter((s) => s.status !== "void")).toHaveLength(0);
  });
});

describe("lo que se le debe a cada proveedor", () => {
  it("cuenta solo lo que todavía no se ha liquidado", async () => {
    const antes = await pendingBySupplier(ORG);
    const bus = antes.find((p) => p.supplierId === "prov-bus")!;
    expect(bus.services).toBe(2000);
    expect(bus.lines).toBe(2);

    await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });

    const despues = await pendingBySupplier(ORG);
    expect(despues.find((p) => p.supplierId === "prov-bus")).toBeUndefined();
  });
});

describe("dos liquidaciones a la vez", () => {
  it("un devengo reclamado por la primera no lo cobra la segunda", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * LA VENTANA QUE DE VERDAD HAY QUE CERRAR
     *
     * El servicio relee cada devengo antes de reclamarlo, y eso ESTRECHA la
     * ventana pero no la cierra: entre la relectura y la escritura cabe otra
     * liquidación. Sin transacciones, la única forma de cerrarla es que la
     * propia escritura ponga la condición —reclamar SOLO si sigue reclamable—
     * y contar las filas que de verdad cambiaron.
     *
     * Aquí se simula el peor caso: justo después de releer, otra liquidación se
     * lleva el devengo. Lo que no puede pasar es que esta lo cuente igual y el
     * proveedor acabe con el mismo viaje en dos pagos.
     */
    /**
     * El robo se inyecta justo después de crear la cáscara de la liquidación,
     * que es el instante anterior a reclamar. Antes esta prueba se colgaba de
     * la relectura por devengo; el arreglo la quitó —la condición viaja ahora
     * dentro de la escritura— así que el punto de inyección tenía que moverse
     * a una costura que siga existiendo.
     */
    const originalCreate = db.tenantCreate;
    db.tenantCreate = (async (org: string, tabla: string, data: Record<string, unknown>) => {
      const fila = await originalCreate(org, tabla, data);
      if (tabla === "settlement") {
        // Otra liquidación, corriendo a la vez, se lleva el primer devengo.
        await db.tenantUpdate(org, "booking_cost", "cost-1", {
          status: "settled", settlement: "liq-de-otro", settlement_id: "liq-de-otro",
        });
      }
      return fila;
    }) as FakeDb["tenantCreate"];

    const r = await generateSupplierSettlement(ORG, { supplierId: "prov-bus", from: DESDE, to: HASTA });
    db.tenantCreate = originalCreate;

    expect(deCoste("cost-1").settlement, "el primero se lo quedó quien llegó antes").toBe("liq-de-otro");
    expect(r.claimed, "esta liquidación solo cuenta lo que SÍ se llevó").toBe(1);
    expect(r.services).toBe(800);
  });
});
