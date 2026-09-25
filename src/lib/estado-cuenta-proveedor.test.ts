import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * EL ESTADO DE CUENTA DEL PROVEEDOR, POR LO QUE ESCRIBE.
 *
 * Lo que se prueba aquí es el dinero y el comprobante: que solo vea lo suyo,
 * que su conformidad quede con fecha, que su NCF se valide antes de guardarse y
 * que no se pueda sobrescribir.
 */

let db: FakeDb;
let sb: FakeSupabase;
const auditar = vi.fn();
const avisar = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditar(...a) }));
vi.mock("@/lib/notify-service", () => ({ notify: (...a: unknown[]) => avisar(...a) }));

import {
  liquidacionesDeProveedor, aceptarLiquidacion, registrarFacturaDeProveedor,
} from "@/lib/estado-cuenta-proveedor";
import type { TenantContext } from "@/lib/tenant";

const ORG = "org-1";
const PROV = "prov-1";
const AHORA = new Date("2026-09-25T12:00:00.000Z");

const proveedor = (supplierId: string | null = PROV) => ({
  companyId: ORG, userId: "u-prov", role: "supplier", supplierId,
} as unknown as TenantContext & { companyId: string });

const gerente = () => ({
  companyId: ORG, userId: "u-ger", role: "manager", supplierId: null,
} as unknown as TenantContext & { companyId: string });

function base() {
  return fakeDb({
    supplier: [
      { _id: PROV, organization_id: ORG, name: "Transporte Bávaro" },
      { _id: "prov-2", organization_id: ORG, name: "Guaguas del Este" },
    ],
    settlement: [
      {
        _id: "liq-1", organization_id: ORG, beneficiary_type: "supplier", supplier: PROV,
        code: "LIQ-2609-AAAAAA", status: "pending", currency: "usd",
        period_from: "2026-09-01", period_to: "2026-09-15",
        base_total: 1000, net_total: 900, pending_total: 900, paid_total: 0,
        commission_total: 250, issued_at: "2026-09-16T10:00:00.000Z",
        accepted_at: null, supplier_ncf: null,
        approved_by: "u-jefe", dispute_assignee: "u-jefe",
      },
      {
        _id: "liq-ajena", organization_id: ORG, beneficiary_type: "supplier", supplier: "prov-2",
        code: "LIQ-2609-BBBBBB", status: "pending", currency: "usd",
        net_total: 500, pending_total: 500, issued_at: "2026-09-16T10:00:00.000Z",
      },
      {
        _id: "liq-anulada", organization_id: ORG, beneficiary_type: "supplier", supplier: PROV,
        code: "LIQ-2609-CCCCCC", status: "void", currency: "usd",
        net_total: 0, pending_total: 0, issued_at: "2026-09-10T10:00:00.000Z",
      },
    ],
  });
}

beforeEach(() => {
  db = base();
  sb = fakeSupabase(db);
  auditar.mockClear();
  avisar.mockClear();
});

describe("sus liquidaciones", () => {
  it("SOLO LAS SUYAS", async () => {
    const lista = await liquidacionesDeProveedor(ORG, PROV);
    expect(lista.map((l) => l._id).sort()).toEqual(["liq-1", "liq-anulada"]);
    const otras = await liquidacionesDeProveedor(ORG, "prov-2");
    expect(otras.map((l) => l._id)).toEqual(["liq-ajena"]);
  });

  it("y NO SE LE CUELA QUIÉN LA APROBÓ NI LO QUE LA CASA PAGA A OTROS", async () => {
    /**
     * La cabecera viaja entera desde la base. Sin recortarla, el proveedor
     * recibiría el nombre del empleado que la aprobó, a quién se le asignó la
     * disputa, y `commission_total` — que es lo que la operadora le paga a
     * OTROS por vender ese viaje.
     */
    const texto = JSON.stringify(await liquidacionesDeProveedor(ORG, PROV));
    expect(texto, "quién la aprobó no es asunto suyo").not.toContain("u-jefe");
    expect(texto, "la comisión de venta no es suya").not.toContain("250");
  });

  it("y le llegan los botones ya decididos", async () => {
    const [emitida] = await liquidacionesDeProveedor(ORG, PROV);
    expect(emitida.acciones).toEqual({ aceptar: true, disputar: true, facturar: true });
    const anulada = (await liquidacionesDeProveedor(ORG, PROV)).find((l) => l._id === "liq-anulada")!;
    expect(anulada.acciones).toEqual({ aceptar: false, disputar: false, facturar: false });
  });
});

describe("la conformidad", () => {
  it("queda con fecha y con nombre", async () => {
    const hecho = await aceptarLiquidacion(proveedor(), "liq-1", AHORA);
    expect(hecho.accepted_at).toBe(AHORA.toISOString());
    const fila = db.rows("settlement").find((s) => s._id === "liq-1")!;
    expect(fila.accepted_at).toBe(AHORA.toISOString());
    expect(fila.accepted_by).toBe("u-prov");
    expect(auditar.mock.calls[0][0]).toMatchObject({ action: "settlement.accepted" });
  });

  it("NO AVISA A NADIE, y eso es deliberado", async () => {
    // Un aviso por cada conformidad convierte la campana en ruido y a la semana
    // nadie la abre. Lo que hay que mirar es el desacuerdo, que ya avisa.
    await aceptarLiquidacion(proveedor(), "liq-1", AHORA);
    expect(avisar).not.toHaveBeenCalled();
  });

  it("EL DE AL LADO NO ACEPTA POR ÉL", async () => {
    await expect(aceptarLiquidacion(proveedor("prov-2"), "liq-1", AHORA)).rejects.toThrow(/no es tuya/i);
    expect(db.rows("settlement").find((s) => s._id === "liq-1")!.accepted_at).toBeFalsy();
  });

  it("y dos veces no son dos conformidades", async () => {
    await aceptarLiquidacion(proveedor(), "liq-1", AHORA);
    await expect(aceptarLiquidacion(proveedor(), "liq-1", AHORA)).rejects.toThrow(/ya diste tu conformidad/i);
  });

  it("una anulada no se acepta", async () => {
    await expect(aceptarLiquidacion(proveedor(), "liq-anulada", AHORA)).rejects.toThrow(/anulada/i);
  });

  it("y gerencia puede registrarla por teléfono, a su nombre", async () => {
    // Es el mismo criterio que la disputa desde 0076: la operadora puede
    // hacerlo en nombre de quien no usa el portal, y queda en la bitácora quién
    // fue.
    await aceptarLiquidacion(gerente(), "liq-1", AHORA);
    expect(db.rows("settlement").find((s) => s._id === "liq-1")!.accepted_by).toBe("u-ger");
    expect(auditar.mock.calls[0][0].metadata).toMatchObject({ via: "operadora" });
  });
});

describe("su factura con NCF", () => {
  it("se valida ANTES de guardarse", async () => {
    await expect(registrarFacturaDeProveedor(proveedor(), "liq-1", { ncf: "B010000000" }, AHORA))
      .rejects.toThrow(/forma correcta/i);
    expect(db.rows("settlement").find((s) => s._id === "liq-1")!.supplier_ncf).toBeFalsy();
  });

  it("se guarda normalizado y con su tipo", async () => {
    const hecho = await registrarFacturaDeProveedor(
      proveedor(), "liq-1", { ncf: "b01 0000 0001", numero: " F-2026-88 " }, AHORA
    );
    expect(hecho.ncf).toBe("B0100000001");
    const fila = db.rows("settlement").find((s) => s._id === "liq-1")!;
    expect(fila.supplier_ncf).toBe("B0100000001");
    expect(fila.supplier_ncf_type).toBe("b01");
    expect(fila.supplier_invoice_number).toBe("F-2026-88");
    expect(fila.supplier_invoice_by).toBe("u-prov");
  });

  it("ESTA SÍ AVISA: alguien tiene que registrar la compra", async () => {
    // Sin aviso, el comprobante se queda en la liquidación y la declaración
    // sale sin él.
    await registrarFacturaDeProveedor(proveedor(), "liq-1", { ncf: "B0100000001" }, AHORA);
    expect(avisar).toHaveBeenCalledTimes(1);
    /**
     * Y el aviso tiene que DECIR de quién y qué número: el texto de la campana
     * se arma con esas variables, así que un aviso sin ellas es «factura de un
     * proveedor, NCF» — que obliga a entrar a buscar cuál, o sea a no avisar.
     */
    expect(avisar.mock.calls[0][0]).toMatchObject({
      event: "supplier_invoice_received",
      vars: { referencia: "B0100000001", proveedor: "Transporte Bávaro" },
    });
  });

  it("y NO SE SOBRESCRIBE", async () => {
    await registrarFacturaDeProveedor(proveedor(), "liq-1", { ncf: "B0100000001" }, AHORA);
    await expect(registrarFacturaDeProveedor(proveedor(), "liq-1", { ncf: "B0200000002" }, AHORA))
      .rejects.toThrow(/ya registraste/i);
    expect(db.rows("settlement").find((s) => s._id === "liq-1")!.supplier_ncf).toBe("B0100000001");
  });

  it("ni se factura la de otro proveedor", async () => {
    await expect(registrarFacturaDeProveedor(proveedor("prov-2"), "liq-1", { ncf: "B0100000001" }, AHORA))
      .rejects.toThrow(/no es tuya/i);
  });
});
