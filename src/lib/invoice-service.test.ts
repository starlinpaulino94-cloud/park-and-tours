import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL COMPROBANTE FISCAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA PROBADO Y QUÉ NO
 *
 * La función de la base (`public.next_ncf`) SÍ lo estaba, en
 * `supabase/tests/runtime_columns.test.sql`: entrega números de uno en uno, se
 * niega cuando el rango se agota y se niega cuando la autorización vence.
 *
 * Lo que no había probado nadie es lo que la APLICACIÓN hace con ese número una
 * vez que lo tiene. Y ahí es donde un comprobante fiscal se rompe de verdad,
 * porque la secuencia ya avanzó: no se puede devolver.
 *
 * Aquí se falsea el suelo —`tenantQuery/Create/Update` y la llamada a la
 * función— y se comprueba lo único que importa: qué queda escrito cuando algo
 * sale mal a mitad.
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
 * La función de la base, con SUS reglas.
 *
 * No es un `vi.fn()` que devuelve 1: reproduce lo que hace `public.next_ncf`
 * —avanzar, agotarse y vencer— porque las pruebas de abajo dependen de que un
 * número consumido se haya consumido DE VERDAD. Un doble que siempre dice que
 * sí no podría enseñar el defecto que esta ola viene a buscar.
 */
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    rpc: async (name: string, args: { p_org: string; p_type: string }) => {
      if (name !== "next_ncf") return { data: null, error: { message: `rpc desconocida: ${name}` } };
      const seq = db.row("ncf_sequence", { organization_id: args.p_org, ncf_type: args.p_type });
      if (!seq) return { data: null, error: { message: `No hay secuencia de NCF configurada para el tipo ${args.p_type}` } };
      if (seq.status !== "active") return { data: null, error: { message: `La secuencia de NCF ${args.p_type} está desactivada` } };
      if (seq.expires_at && String(seq.expires_at) < new Date().toISOString().slice(0, 10)) {
        return { data: null, error: { message: `La autorización de la secuencia ${args.p_type} venció el ${seq.expires_at}` } };
      }
      const next = Number(seq.next_number ?? 1);
      if (seq.max_number != null && next > Number(seq.max_number)) {
        return { data: null, error: { message: `La secuencia ${args.p_type} se agotó en el número ${seq.max_number}` } };
      }
      await db.tenantUpdate(args.p_org, "ncf_sequence", String(seq._id), { next_number: next + 1 });
      return { data: next, error: null };
    },
  }),
}));

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn(), notifyRoles: vi.fn() }));

import { issueInvoice, voidInvoice } from "@/lib/invoice-service";

const ORG = "org-1";
const ctx = {
  companyId: ORG, userId: "user-1", role: "admin", email: "admin@ejemplo.test",
  company: { _id: ORG, base_currency: "dop" },
} as unknown as Parameters<typeof issueInvoice>[0];

/** Una venta de dos reservas, lista para facturar. */
function venta(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Caribe Tours", currency: "dop" }],
    tax_profile: [{
      _id: "fiscal-1", organization_id: ORG, status: "active",
      tax_rate: 18, tax_name: "ITBIS", efac_enabled: false,
    }],
    ncf_sequence: [
      { _id: "seq-b02", organization_id: ORG, ncf_type: "b02", status: "active",
        next_number: 1, max_number: 50, expires_at: "2099-12-31" },
      { _id: "seq-b04", organization_id: ORG, ncf_type: "b04", status: "active",
        next_number: 1, max_number: 50, expires_at: "2099-12-31" },
    ],
    customer: [{ _id: "cli-1", organization_id: ORG, first_name: "Laura", last_name: "Gutiérrez" }],
    product: [{ _id: "prod-saona", organization_id: ORG, name: "Isla Saona" }],
    order: [{
      _id: "ord-1", organization_id: ORG, order_number: "ORD-1", customer: "cli-1",
      currency: "dop", paid_total: 0, exchange_rate: 1, status: "pending_payment",
    }],
    booking: [
      { _id: "res-1", organization_id: ORG, order: "ord-1", product: "prod-saona",
        booking_number: "RSV-1", status: "paid",
        gross_amount: 1000, discount_amount: 0, tax_amount: 180 },
      { _id: "res-2", organization_id: ORG, order: "ord-1", product: "prod-saona",
        booking_number: "RSV-2", status: "paid",
        gross_amount: 500, discount_amount: 0, tax_amount: 90 },
    ],
    ...extra,
  });
}

beforeEach(() => { db = venta(); });

const facturas = () => db.rows("invoice");
const secuencia = (tipo = "b02") => db.row("ncf_sequence", { ncf_type: tipo })!;

describe("emitir la factura de una venta", () => {
  it("escribe el comprobante, su desglose y sus totales", async () => {
    const r = await issueInvoice(ctx, { orderId: "ord-1" });

    expect(r.lines).toBe(2);
    const factura = facturas()[0];
    expect(factura.status).toBe("issued");
    expect(String(factura.ncf)).toMatch(/^B02\d{8}$/);
    expect(Number(factura.subtotal)).toBe(1500);
    expect(Number(factura.tax)).toBe(270);
    expect(Number(factura.total)).toBe(1770);

    const lineas = db.rows("invoice_line");
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.description)).toEqual([
      "Isla Saona · RSV-1", "Isla Saona · RSV-2",
    ]);
  });

  it("la secuencia avanza de uno en uno", async () => {
    expect(Number(secuencia().next_number)).toBe(1);
    await issueInvoice(ctx, { orderId: "ord-1" });
    expect(Number(secuencia().next_number)).toBe(2);
  });

  it("una orden no se factura dos veces", async () => {
    // Dos comprobantes por la misma venta obligan a anular el segundo con una
    // nota de crédito, y a explicarlo.
    await issueInvoice(ctx, { orderId: "ord-1" });
    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow(/ya tiene la factura/i);
    expect(facturas()).toHaveLength(1);
  });

  it("una reserva cancelada no entra en la factura", async () => {
    // Facturarle al cliente algo que no viajó es la diferencia que aparece en
    // una inspección, y además se la cobra el sistema de cobranza.
    db.tenantUpdate(ORG, "booking", "res-2", { status: "cancelled" });
    const r = await issueInvoice(ctx, { orderId: "ord-1" });
    expect(r.lines).toBe(1);
    expect(Number(facturas()[0].total)).toBe(1180);
  });

  it("sin nada facturable no se quema un NCF", async () => {
    db.tenantUpdate(ORG, "booking", "res-1", { status: "cancelled" });
    db.tenantUpdate(ORG, "booking", "res-2", { status: "cancelled" });

    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow(/no tiene reservas facturables/i);
    expect(Number(secuencia().next_number), "la secuencia no se toca si no hay factura").toBe(1);
  });

  it("la secuencia agotada se explica por su nombre", async () => {
    // «No se pudo facturar» delante de un cliente no le sirve a nadie.
    db.tenantUpdate(ORG, "ncf_sequence", "seq-b02", { next_number: 51, max_number: 50 });
    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow(/se agotó/i);
  });

  it("una autorización vencida no entrega números", async () => {
    db.tenantUpdate(ORG, "ncf_sequence", "seq-b02", { expires_at: "2020-12-31" });
    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow(/venció/i);
  });
});

describe("cuando algo falla DESPUÉS de consumir el número", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * LA SECUENCIA YA AVANZÓ Y NO SE PUEDE DEVOLVER
   *
   * `next_ncf` consume el número de forma atómica: en cuanto vuelve, ese número
   * está gastado para siempre. Si lo que viene después falla, queda un HUECO en
   * la secuencia.
   *
   * Y un hueco hay que justificarlo. Lo dice la propia migración 0037 entre los
   * tres fallos que viene a evitar: «un número que se salta hay que justificarlo
   * en el 606/607; nadie se acuerda de cuál fue tres meses después».
   *
   * El 608 —los comprobantes anulados— se arma leyendo facturas con estado
   * `voided`. Un número consumido que nunca llegó a ser factura no aparece ahí,
   * ni en el 606, ni en el 607: desaparece. La DGII cruza los rangos
   * autorizados con los declarados, y ese número faltante no lo puede explicar
   * nadie.
   */

  it("un NCF consumido y no usado queda declarado, no desaparecido", async () => {
    /**
     * Falla SOLO la primera escritura de factura, no todas.
     *
     * Es la diferencia entre «esta fila no entró» —una restricción, una columna
     * mal, un choque de número— y «la base está caída». En el segundo caso no
     * hay nada que hacer y el código solo puede dejarlo en el registro; en el
     * primero, que es el habitual, el número TIENE que quedar declarado. La
     * primera versión de esta prueba tumbaba las dos y exigía lo imposible.
     */
    let primera = true;
    const original = db.tenantCreate;
    db.tenantCreate = (async (org: string, tabla: string, data: Record<string, unknown>) => {
      if (tabla === "invoice" && primera) { primera = false; throw new Error("la base rechazó la factura"); }
      return original(org, tabla, data);
    }) as FakeDb["tenantCreate"];

    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow();
    db.tenantCreate = original;

    expect(Number(secuencia().next_number), "el número se consumió").toBe(2);

    const rastro = facturas();
    expect(rastro, "sin rastro, la DGII ve un hueco que nadie puede explicar").toHaveLength(1);
    expect(rastro[0].status).toBe("voided");
    expect(String(rastro[0].ncf)).toMatch(/^B02\d{8}$/);
    // 09 = «Errores en secuencia de NCF», que es exactamente lo que pasó.
    expect(rastro[0].void_reason_code).toBe("09");
  });

  it("si ni la anulación se puede escribir, el error de verdad no se tapa", async () => {
    // Con la base caída no hay dónde dejar el rastro. Lo que NO puede pasar es
    // que el cajero vea «no se pudo anular» en vez del fallo que lo provocó: el
    // número perdido se rescata del registro, el error no.
    const original = db.tenantCreate;
    db.tenantCreate = (async (org: string, tabla: string, data: Record<string, unknown>) => {
      if (tabla === "invoice") throw new Error("la base rechazó la factura");
      return original(org, tabla, data);
    }) as FakeDb["tenantCreate"];

    await expect(issueInvoice(ctx, { orderId: "ord-1" }))
      .rejects.toThrow(/la base rechazó la factura/);
    db.tenantCreate = original;
  });

  it("una factura nunca queda emitida con el desglose incompleto", async () => {
    /**
     * Las líneas se escriben DESPUÉS de la factura, una a una. Si falla la
     * segunda, queda un comprobante emitido —con su NCF, en el 607, con su
     * total— cuyo desglose miente.
     *
     * La 0037 lo dice: «una factura sin líneas no se puede sostener ante una
     * inspección ni reimprimir».
     */
    let escritas = 0;
    const original = db.tenantCreate;
    db.tenantCreate = (async (org: string, tabla: string, data: Record<string, unknown>) => {
      if (tabla === "invoice_line" && ++escritas === 2) throw new Error("la base rechazó la línea");
      return original(org, tabla, data);
    }) as FakeDb["tenantCreate"];

    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow();
    db.tenantCreate = original;

    const factura = facturas()[0];
    expect(factura, "la factura existe").toBeTruthy();
    expect(factura.status, "emitida con el desglose a medias es peor que no emitida").not.toBe("issued");
    expect(factura.status).toBe("voided");
    expect(factura.void_reason_code).toBe("09");
  });

  it("después de un fallo, la orden se puede volver a facturar", async () => {
    // El comprobante roto quedó anulado, así que no bloquea: el cajero
    // reintenta, sale con el número siguiente, y el anterior está declarado.
    const original = db.tenantCreate;
    let falla = true;
    db.tenantCreate = (async (org: string, tabla: string, data: Record<string, unknown>) => {
      if (tabla === "invoice_line" && falla) { falla = false; throw new Error("la base falló"); }
      return original(org, tabla, data);
    }) as FakeDb["tenantCreate"];

    await expect(issueInvoice(ctx, { orderId: "ord-1" })).rejects.toThrow();
    db.tenantCreate = original;

    const segunda = await issueInvoice(ctx, { orderId: "ord-1" });
    expect(segunda.lines).toBe(2);

    const vivas = facturas().filter((f) => f.status === "issued");
    expect(vivas, "una sola factura viva por venta").toHaveLength(1);
    expect(String(vivas[0].ncf)).not.toBe(String(facturas()[0].ncf));
  });
});

describe("anular un comprobante", () => {
  it("emite la nota de crédito con su propio número y referencia a la factura", async () => {
    // En República Dominicana un comprobante emitido no se borra: el cliente ya
    // lo tiene y probablemente ya está en su declaración.
    await issueInvoice(ctx, { orderId: "ord-1" });
    const factura = facturas()[0];

    const r = await voidInvoice(ctx, String(factura._id), "El cliente canceló el viaje", "07");

    expect(String(r.ncf)).toMatch(/^B04\d{8}$/);
    const nota = facturas().find((f) => f.invoice_type === "credit_note")!;
    expect(nota.credit_note_of).toBe(factura._id);
    expect(Number(nota.total)).toBe(Number(factura.total));
    expect(Number(secuencia("b04").next_number), "la nota gasta un número de SU serie").toBe(2);
  });

  it("anular sin motivo no vale", async () => {
    await issueInvoice(ctx, { orderId: "ord-1" });
    const factura = facturas()[0];
    await expect(voidInvoice(ctx, String(factura._id), "  ")).rejects.toThrow(/motivo/i);
  });
});
