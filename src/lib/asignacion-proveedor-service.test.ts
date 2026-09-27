import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LA PRIMERA ESCRITURA QUE HACE UN PROVEEDOR SOBRE LA OPERACIÓN.
 *
 * Hasta ahora solo contestaba sobre su propia fila. Aquí escribe dos referencias
 * que la operadora usa para despachar, y el rango NO responde a ninguna de las
 * tres preguntas que eso abre: ¿es suya la fila?, ¿es suyo el vehículo?, ¿puede
 * todavía?
 */

let db: FakeDb;
const auditar = vi.fn();
const avisos: { event: string; vars: Record<string, unknown> }[] = [];

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditar(...a) }));
vi.mock("@/lib/notify-service", () => ({
  notify: vi.fn(async (input: { event: string; vars: Record<string, unknown> }) => {
    avisos.push({ event: input.event, vars: input.vars });
  }),
  notifyRoles: vi.fn(),
}));

import { asignarFlotaDeProveedor, flotaDelProveedor } from "@/lib/asignacion-proveedor-service";
import { supplierScopeFor } from "@/lib/resources";

const MIO = "sup-1";
const AJENO = "sup-2";
const AHORA = new Date("2026-03-10T12:00:00Z");

const ctx = (supplierId: string | null = MIO) => ({
  companyId: "c1",
  company: { _id: "c1", name: "PT", timezone: "America/Santo_Domingo" } as never,
  supplierId,
  userId: "u1",
  email: "transporte@example.com",
});

beforeEach(() => {
  db = fakeDb();
  auditar.mockClear();
  avisos.length = 0;

  db.seed("departure", [
    { _id: "dep-1", departure_at: "2026-03-12T12:00:00Z", duration_hours: 8, product: { _id: "p1", name: "Isla Saona" } },
    { _id: "dep-pisa", departure_at: "2026-03-12T14:00:00Z", duration_hours: 8, product: { _id: "p1", name: "Otra" } },
  ]);
  db.seed("vehicle", [
    { _id: "v-mia", name: "Coaster", plate: "A1", capacity: 30, status: "active", supplier: MIO,
      insurance_expiry: "2027-01-01", inspection_expiry: "2027-01-01" },
    { _id: "v-sin-papeles", name: "Vieja", plate: "A2", capacity: 20, status: "active", supplier: MIO,
      insurance_expiry: "2025-01-01", inspection_expiry: "2027-01-01" },
    { _id: "v-ajena", name: "Competencia", plate: "B1", capacity: 30, status: "active", supplier: AJENO,
      insurance_expiry: "2027-01-01", inspection_expiry: "2027-01-01" },
    { _id: "v-de-la-casa", name: "De la casa", plate: "C1", capacity: 30, status: "active", supplier: null,
      insurance_expiry: "2027-01-01", inspection_expiry: "2027-01-01" },
  ]);
  db.seed("staff", [
    { _id: "st-mio", full_name: "Pedro Chofer", staff_type: "driver", status: "active", supplier: MIO },
    { _id: "st-ajeno", full_name: "Ajeno", staff_type: "driver", status: "active", supplier: AJENO },
  ]);
  db.seed("departure_resource", [
    { _id: "dr-mio", departure: "dep-1", supplier: MIO, service_date: "2026-03-12",
      status: "planned", acceptance: "accepted" },
    { _id: "dr-ajeno", departure: "dep-1", supplier: AJENO, service_date: "2026-03-12",
      status: "planned", acceptance: "accepted" },
  ]);
  db.seed("pickup_route", [
    { _id: "pr-mia", departure: "dep-1", supplier: MIO, service_date: "2026-03-12",
      start_time: "06:00", status: "planned", acceptance: "accepted" },
  ]);
});

describe("asignar su flota", () => {
  it("pone su guagua y su chofer en su servicio", async () => {
    const r = await asignarFlotaDeProveedor(ctx(), {
      tipo: "recurso", id: "dr-mio", vehicle: "v-mia", staff: "st-mio",
    }, AHORA);
    expect(r.asignado).toEqual({ vehicle: "v-mia", staff: "st-mio" });
    const fila = db.row("departure_resource", { _id: "dr-mio" })!;
    expect(fila.vehicle).toBe("v-mia");
    expect(fila.staff).toBe("st-mio");
  });

  it("y la operadora se entera, que es el punto del portal", async () => {
    /**
     * Sin aviso, la asignación existe en la base y nadie la mira hasta que sale
     * el manifiesto — que es demasiado tarde para cambiarla.
     */
    await asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA);
    expect(avisos.map((a) => a.event)).toEqual(["supplier_fleet_assigned"]);
    expect(String(avisos[0].vars.detalle)).toContain("v-mia");
  });

  it("y queda en la bitácora", async () => {
    await asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA);
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ action: "supplier_fleet_assigned" }));
  });

  it("en una RUTA asigna conductor y guía, que son campos distintos", async () => {
    await asignarFlotaDeProveedor(ctx(), {
      tipo: "ruta", id: "pr-mia", vehicle: "v-mia", driver: "st-mio",
    }, AHORA);
    const fila = db.row("pickup_route", { _id: "pr-mia" })!;
    expect(fila.driver).toBe("st-mio");
    expect(fila.vehicle).toBe("v-mia");
  });

  it("y puede RETIRAR lo que puso", async () => {
    // La guagua que se acaba de averiar. Sin esto, la asignación vieja seguiría
    // ahí con el despacho creyendo que sale.
    await asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA);
    await asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: null }, AHORA);
    expect(db.row("departure_resource", { _id: "dr-mio" })!.vehicle).toBeNull();
  });
});

describe("de quién es la fila lo decide supplier_id, no el rango", () => {
  it("NO puede tocar el servicio de otro transportista", async () => {
    // Sin esto, el portal serviría para asignar flota a los servicios de
    // cualquier otro proveedor de la misma operadora.
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-ajeno", vehicle: "v-mia" }, AHORA)
    ).rejects.toMatchObject({ status: 403 });
    expect(db.row("departure_resource", { _id: "dr-ajeno" })!.vehicle).toBeUndefined();
  });

  it("y una cuenta sin ficha de proveedor no asigna nada, Y LO DICE POR ESO", async () => {
    /**
     * Se comprueba el MENSAJE y no solo el 403: sin la guarda de `supplierId`, la
     * comparación de más abajo también acaba en 403 —«este servicio no es tuyo»—,
     * así que una prueba que solo mirara el código no distinguía «no tienes ficha»
     * de «la fila es de otro». Y son problemas distintos: el primero lo arregla
     * quien administra la operadora, el segundo nadie.
     */
    await expect(
      asignarFlotaDeProveedor(ctx(null), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA)
    ).rejects.toThrow(/vinculada a un proveedor/);
  });
});

describe("y de quién es la guagua, también", () => {
  it("NO PUEDE ASIGNAR LA GUAGUA DE LA COMPETENCIA", async () => {
    /**
     * El desplegable lo pinta el navegador y cualquiera puede mandar otro
     * identificador. Sin leer la ficha y comparar su `supplier_id`, quien lo
     * descubriría es el chofer de la competencia, el día del viaje.
     */
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-ajena" }, AHORA)
    ).rejects.toMatchObject({ status: 403 });
    expect(db.row("departure_resource", { _id: "dr-mio" })!.vehicle).toBeUndefined();
  });

  it("ni la de la operadora", async () => {
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-de-la-casa" }, AHORA)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("ni a una persona que no es de su plantilla", async () => {
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", staff: "st-ajeno" }, AHORA)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("y un identificador que no existe se dice, no se guarda", async () => {
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "no-existe" }, AHORA)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("las dos comprobaciones de la casa corren también aquí", () => {
  it("UNA GUAGUA CON EL SEGURO VENCIDO NO SALE, tampoco por el portal", async () => {
    // Es la misma comprobación de 8.6, no una copia: una copia «para el portal»
    // sería la versión floja de la misma regla.
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-sin-papeles" }, AHORA)
    ).rejects.toMatchObject({ status: 409, code: "VEHICLE_BLOCKED" });
  });

  it("Y LA MISMA GUAGUA NO PUEDE ESTAR EN DOS SITIOS A LA VEZ", async () => {
    db.seed("departure_resource", [
      { _id: "dr-otro", departure: "dep-pisa", service_date: "2026-03-12", status: "planned",
        vehicle: { _id: "v-mia", name: "Coaster", plate: "A1" } },
    ]);
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA)
    ).rejects.toMatchObject({ status: 409, code: "RESOURCE_CONFLICT" });
  });

  it("pero la MISMA salida no es un choque: la recogida y el tour son el mismo servicio", async () => {
    await asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio", vehicle: "v-mia" }, AHORA);
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "ruta", id: "pr-mia", vehicle: "v-mia" }, AHORA)
    ).resolves.toBeTruthy();
  });
});

describe("cuándo ya no", () => {
  it("un servicio que rechazó no se asigna", async () => {
    db.seed("departure_resource", [
      { _id: "dr-no", departure: "dep-1", supplier: MIO, service_date: "2026-03-12",
        status: "planned", acceptance: "rejected" },
    ]);
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-no", vehicle: "v-mia" }, AHORA)
    ).rejects.toMatchObject({ status: 409 });
  });

  it("y mandar nada se dice en vez de escribir una fila vacía", async () => {
    await expect(
      asignarFlotaDeProveedor(ctx(), { tipo: "recurso", id: "dr-mio" }, AHORA)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lo que no está en la lista blanca no llega a la base", async () => {
    // `pax_assigned` lo decide quien vende; `status`, la operación.
    await asignarFlotaDeProveedor(ctx(), {
      tipo: "recurso", id: "dr-mio", vehicle: "v-mia",
      pax_assigned: 99, status: "completed",
    } as never, AHORA);
    const fila = db.row("departure_resource", { _id: "dr-mio" })!;
    expect(fila.pax_assigned).toBeUndefined();
    expect(fila.status).toBe("planned");
  });
});

describe("su flota entra en su ámbito, y solo la suya", () => {
  it("puede LISTAR sus vehículos y su gente", async () => {
    /**
     * Sin esto no podría elegir: el desplegable saldría vacío y la asignación
     * sería un campo de texto donde teclear un uuid. `vehicle.supplier_id` y
     * `staff.supplier_id` existen desde 0009, así que el ámbito sale por columna.
     */
    for (const tabla of ["vehicle", "staff"]) {
      expect(supplierScopeFor(tabla, MIO), tabla)
        .toEqual({ kind: "own", field: "supplier", supplierId: MIO });
    }
  });

  it("y sigue sin poder listar lo que no es suyo", async () => {
    // Leer su flota no le abre el resto del inventario de la operadora.
    for (const tabla of ["payable", "customer", "booking", "payment"]) {
      expect(supplierScopeFor(tabla, MIO), tabla).toEqual({ kind: "denied" });
    }
  });
});

describe("su flota", () => {
  it("es la suya y solo la suya", async () => {
    const f = await flotaDelProveedor("c1", MIO);
    expect(f.vehicles.map((v) => v._id).sort()).toEqual(["v-mia", "v-sin-papeles"]);
    expect(f.staff.map((s) => s._id)).toEqual(["st-mio"]);
  });

  it("y llega recortada: sin tarifa diaria ni cédula", async () => {
    /**
     * El filtro decide qué filas; el recorte, qué columnas. `vehicle` y `staff`
     * llevan la tarifa diaria y el documento de identidad al lado del nombre.
     */
    const f = await flotaDelProveedor("c1", MIO);
    for (const v of f.vehicles) {
      expect(Object.keys(v).sort()).toEqual(["_id", "capacity", "etiqueta"]);
    }
    for (const s of f.staff) {
      expect(Object.keys(s).sort()).toEqual(["_id", "nombre", "tipo"]);
    }
  });
});
