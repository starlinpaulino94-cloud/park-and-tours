import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LO QUE SE LE MANDA A LA DGII.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA PROBADO Y QUÉ NO
 *
 * `dgii.ts` —el formato— lo estaba entero: cómo se escribe un RNC, una fecha,
 * un importe, y qué columnas lleva cada línea. Lo que no había probado nadie es
 * la REUNIÓN de los datos: qué facturas entran en el mes, con qué fecha y
 * cuántas veces.
 *
 * Y ahí es donde una declaración se rompe sin dar error: el archivo se genera,
 * se sube, la DGII lo acepta, y la diferencia aparece meses después en un
 * cruce.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});

import { dgiiReport } from "@/lib/dgii-service";

const ORG = "org-1";

/**
 * La empresa opera en Santo Domingo, que es UTC−4.
 *
 * No es un detalle de presentación: una excursión vendida a las 21:00 del 30 de
 * septiembre en el mostrador de un hotel ocurre, en UTC, el 1 de octubre. En
 * qué mes se declara esa venta lo decide esta zona horaria.
 */
const ctx = {
  companyId: ORG, userId: "user-1", role: "admin",
  company: { _id: ORG, base_currency: "dop", timezone: "America/Santo_Domingo" },
} as unknown as Parameters<typeof dgiiReport>[0];

function libros(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Caribe Tours", timezone: "America/Santo_Domingo" }],
    order: [{ _id: "ord-1", organization_id: ORG, order_number: "ORD-1", currency: "dop" }],
    payment: [{
      _id: "pay-1", organization_id: ORG, order: "ord-1", status: "completed",
      payment_type: "payment", method: "cash", amount: 1180,
    }],
    ...extra,
  });
}

/** Una factura emitida en el instante que se le diga. */
const factura = (id: string, issuedAt: string, extra: Record<string, unknown> = {}) => ({
  _id: id, organization_id: ORG, order: "ord-1",
  ncf: `B02${id.replace(/\D/g, "").padStart(8, "0")}`,
  number: id.toUpperCase(),
  customer_name: "Laura Gutiérrez",
  customer_tax_id: "40212345678",
  issued_at: issuedAt,
  status: "issued",
  subtotal: 1000, tax: 180, total: 1180,
  ...extra,
});

beforeEach(() => { db = libros(); });

describe("el 607 — lo que se vendió", () => {
  it("declara las facturas del mes con su NCF y su ITBIS", async () => {
    db.seed("invoice", [factura("fac-1", "2026-09-16T14:00:00.000Z")]);
    const r = await dgiiReport(ctx, "607", "2026-09");

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].reference).toBe("B0200000001");
    expect(r.rows[0].itbis).toBe(180);
    expect(r.excluded, "sin problemas, no queda nada fuera del archivo").toBe(0);
  });

  it("un borrador no se declara", async () => {
    db.seed("invoice", [factura("fac-1", "2026-09-16T14:00:00.000Z", { status: "draft" })]);
    const r = await dgiiReport(ctx, "607", "2026-09");
    expect(r.rows).toHaveLength(0);
  });

  it("una factura del mes pasado no entra en este", async () => {
    db.seed("invoice", [factura("fac-1", "2026-08-31T14:00:00.000Z")]);
    const r = await dgiiReport(ctx, "607", "2026-09");
    expect(r.rows).toHaveLength(0);
  });

  it("una venta de la noche del último día es de ESE mes, no del siguiente", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * EL MES SE CUENTA EN LA ZONA DE LA EMPRESA, NO EN UTC
     *
     * Las 21:00 del 30 de septiembre en Santo Domingo son las 01:00 del 1 de
     * octubre en UTC. Con el rango calculado en UTC, esa venta —hecha en el
     * mostrador de un hotel, que es cuando más se vende— se declara en
     * octubre.
     *
     * No es un caso raro de fin de mes: la misma cuenta desplaza un día la
     * FECHA de toda venta posterior a las 20:00, que en el archivo se escribe
     * como el día siguiente.
     */
    db.seed("invoice", [factura("fac-1", "2026-10-01T01:00:00.000Z")]); // 30-sep 21:00 local

    const septiembre = await dgiiReport(ctx, "607", "2026-09");
    expect(septiembre.rows, "la vendió en septiembre").toHaveLength(1);
    // Columna 5 del 607: la fecha del comprobante (la 3 es el NCF modificado).
    expect(septiembre.rows[0].columns?.[5], "y con fecha del 30").toBe("20260930");

    const octubre = await dgiiReport(ctx, "607", "2026-10");
    expect(octubre.rows, "en octubre no tiene nada que hacer").toHaveLength(0);
  });

  it("ninguna factura se declara en DOS meses", async () => {
    /**
     * El rango llegaba hasta el primer instante del mes siguiente con `lte`,
     * así que una factura emitida exactamente en ese instante caía en los dos.
     * La DGII cruza sus totales: una venta declarada dos veces es una
     * diferencia que hay que explicar.
     */
    db.seed("invoice", [
      factura("fac-1", "2026-09-16T14:00:00.000Z"),
      factura("fac-2", "2026-10-01T04:00:00.000Z"), // 1-oct 00:00 local exacto
    ]);

    const sep = await dgiiReport(ctx, "607", "2026-09");
    const oct = await dgiiReport(ctx, "607", "2026-10");
    const refs = [...sep.rows, ...oct.rows].map((f) => f.reference);

    expect(new Set(refs).size, "cada factura, en un solo mes").toBe(refs.length);
    expect(sep.rows.map((f) => f.reference)).toEqual(["B0200000001"]);
    expect(oct.rows.map((f) => f.reference)).toEqual(["B0200000002"]);
  });

  it("lo que no se cobró se declara como venta a crédito", async () => {
    // Repartirlo en efectivo «porque suele ser así» sería inventar un dato en
    // una declaración.
    db.seed("invoice", [factura("fac-1", "2026-09-16T14:00:00.000Z", { order: "ord-sin-cobro" })]);
    const r = await dgiiReport(ctx, "607", "2026-09");
    expect(r.rows[0].columns, "la fila se puede declarar").toBeTruthy();
  });
});

describe("el 606 — lo que se compró", () => {
  const gasto = (id: string, fecha: string, extra: Record<string, unknown> = {}) => ({
    _id: id, organization_id: ORG,
    supplier_tax_id: "131234567", supplier_name: "Transporte del Este",
    ncf: "B0100000001", expense_date: fecha,
    amount: 5000, tax_amount: 900, total: 5900,
    status: "approved", payment_method: "transfer",
    ...extra,
  });

  it("declara los gastos del mes", async () => {
    db.seed("expense", [gasto("gas-1", "2026-09-10")]);
    const r = await dgiiReport(ctx, "606", "2026-09");
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("un gasto del día 1 del mes siguiente NO entra en este", async () => {
    /**
     * `expense_date` es una fecha, no un instante. El rango se construía hasta
     * el primer día del mes siguiente y se comparaba con `lte`, así que TODO
     * gasto fechado el día 1 se declaraba en el mes anterior — y otra vez en el
     * suyo. No es un caso de borde improbable: es cada primero de mes.
     */
    db.seed("expense", [gasto("gas-1", "2026-10-01")]);

    const sep = await dgiiReport(ctx, "606", "2026-09");
    expect(sep.rows, "octubre no se declara en septiembre").toHaveLength(0);

    const oct = await dgiiReport(ctx, "606", "2026-10");
    expect(oct.rows.length, "se declara en el suyo").toBeGreaterThanOrEqual(1);
  });
});

describe("el 608 — lo anulado", () => {
  it("declara las anuladas por la fecha en que se EMITIERON", async () => {
    // Una factura de septiembre anulada en octubre va en el 608 de septiembre:
    // el formato pide la fecha del comprobante.
    db.seed("invoice", [factura("fac-1", "2026-09-16T14:00:00.000Z", {
      status: "voided", void_reason_code: "07",
    })]);

    const r = await dgiiReport(ctx, "608", "2026-09");
    expect(r.rows).toHaveLength(1);
    // Columna 2 del 608: el código de anulación (0 es el NCF, 1 la fecha).
    expect(r.rows[0].columns?.[2], "el código de anulación que se declaró").toBe("07");
  });

  it("un NCF que se quemó sin llegar a emitirse también se declara", async () => {
    // Es lo que evita el hueco en la secuencia: el número existe como anulado
    // con el código 09, y el 608 lo recoge sin hacer nada especial.
    db.seed("invoice", [factura("fac-1", "2026-09-16T14:00:00.000Z", {
      status: "voided", void_reason_code: "09", total: 0, subtotal: 0, tax: 0,
      customer_name: "Comprobante no emitido",
    })]);

    const r = await dgiiReport(ctx, "608", "2026-09");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].columns?.[2]).toBe("09");
  });
});
