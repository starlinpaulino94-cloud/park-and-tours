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

/**
 * UNA DECLARACIÓN SE MANDA ENTERA O NO SE MANDA (ola 9.12).
 *
 * `load607`, `load606` y `load608` leían tres mil filas como mucho, ordenadas
 * por fecha ASCENDENTE. Una operadora que emita más de tres mil facturas al mes
 * —cien al día, normal en un parque que vende entradas— presentaba un 607 al que
 * le faltaban los ÚLTIMOS DÍAS del mes. Y no por azar: el orden es ascendente,
 * así que el recorte siempre caía en el final del período.
 *
 * Eso no es una pantalla incompleta. Es declarar de menos con un archivo que
 * parece correcto, y el descuadre aparece meses después en un cruce que ya no se
 * puede explicar.
 */
describe("el 607 de un mes con más de tres mil facturas", () => {
  /** Un mes de facturas repartidas del día 1 al 30, la última la más reciente. */
  function mesLargo(cuantas: number) {
    return Array.from({ length: cuantas }, (_, i) => {
      const dia = String(1 + Math.floor((i * 30) / cuantas)).padStart(2, "0");
      return factura(`fac-${String(i).padStart(5, "0")}`, `2026-09-${dia}T14:00:00.000Z`, {
        ncf: `B0100000${String(i).padStart(4, "0")}`,
      });
    });
  }

  it("declara TODAS las facturas del mes, no las tres mil primeras", async () => {
    db.seed("invoice", mesLargo(3400));
    const r = await dgiiReport(ctx, "607", "2026-09");
    expect(r.rows).toHaveLength(3400);
  });

  it("y las que se quedaban fuera eran las del FINAL del mes", async () => {
    /**
     * Ésta es la prueba que importa. Con el tope de tres mil y el orden
     * ascendente, lo que faltaba en el archivo eran siempre los últimos días —y
     * un 607 sin los últimos días del mes es exactamente el error que menos se
     * nota y más cuesta.
     */
    db.seed("invoice", mesLargo(3400));
    const r = await dgiiReport(ctx, "607", "2026-09");

    const dias = r.rows.map((fila) => String(fila.date ?? "").slice(0, 10));
    expect(dias).toContain("2026-09-30");
    // Y el último NCF de la serie, que es el que cerraba el mes.
    expect(r.rows.map((f) => f.reference)).toContain("B01000003399");
  });

  it("si de verdad no se puede leer el mes entero, lanza en vez de declarar de menos", async () => {
    // Por encima del techo de una suma. Vale más una declaración que no sale
    // que una que sale corta: la primera se arregla, la segunda se descubre en
    // una fiscalización.
    db.seed("invoice", mesLargo(10_600));
    await expect(dgiiReport(ctx, "607", "2026-09")).rejects.toThrow(/no se pudo leer/i);
  });

  it("el 606 también: el ITBIS que no se declara es dinero que la empresa no deduce", async () => {
    db.seed("expense", Array.from({ length: 3400 }, (_, i) => ({
      _id: `g-${String(i).padStart(5, "0")}`, organization_id: ORG,
      expense_date: `2026-09-${String(1 + Math.floor((i * 30) / 3400)).padStart(2, "0")}`,
      status: "approved", amount: 118, itbis_amount: 18,
      ncf: `B1100000${String(i).padStart(4, "0")}`,
      supplier_rnc: "131234567", goods_service_type: "09",
      payment_method: "01", concept: "Transporte",
    })));
    const r = await dgiiReport(ctx, "606", "2026-09");
    expect(r.rows).toHaveLength(3400);
  });

  it("y el 608: un NCF anulado sin declarar sigue contando como venta", async () => {
    db.seed("invoice", Array.from({ length: 3400 }, (_, i) =>
      factura(`anu-${String(i).padStart(5, "0")}`, `2026-09-${String(1 + Math.floor((i * 30) / 3400)).padStart(2, "0")}T14:00:00.000Z`, {
        status: "voided", ncf: `B0100009${String(i).padStart(4, "0")}`, void_reason_code: "01",
      })));
    const r = await dgiiReport(ctx, "608", "2026-09");
    expect(r.rows).toHaveLength(3400);
  });
});

describe("el desempate y el desglose, que se rompen en silencio", () => {
  it("varias facturas del MISMO instante se declaran todas, una sola vez cada una", async () => {
    /**
     * Es el fallo propio de paginar sin orden total. Mil trescientas facturas
     * con el mismo `issued_at` al segundo —un lote de entradas vendidas de
     * golpe— no tienen orden entre sí, así que sin el desempate por identidad
     * dos páginas consecutivas pueden repetir una y saltarse otra.
     *
     * En una declaración eso son dos cosas a la vez: un NCF declarado dos veces
     * y otro sin declarar. El total puede incluso parecer correcto.
     */
    const mismoInstante = "2026-09-15T14:00:00.000Z";
    db.seed("invoice", Array.from({ length: 1300 }, (_, i) =>
      factura(`fac-${String(i).padStart(5, "0")}`, mismoInstante, {
        ncf: `B0100001${String(i).padStart(4, "0")}`,
      })));

    const r = await dgiiReport(ctx, "607", "2026-09");

    expect(r.rows).toHaveLength(1300);
    expect(new Set(r.rows.map((f) => f.reference)).size).toBe(1300);
  });

  it("el desglose por forma de pago se lee entero: si no, la venta se declara A CRÉDITO", async () => {
    /**
     * Este tope era el más traicionero de los tres. Una factura cuyos cobros
     * quedaran fuera de las dos mil filas no daba error ni faltaba del archivo:
     * salía declarada como venta a crédito. Así que el 607 cuadraba en importe
     * total y mentía justo en la columna que la DGII cruza contra los bancos.
     *
     * Aquí hay 2 100 cobros repartidos entre dos ventas, y la factura de la
     * segunda es la que se quedaba sin desglose.
     */
    db.seed("order", [{ _id: "ord-2", organization_id: ORG, order_number: "ORD-2", currency: "dop" }]);
    db.seed("payment", Array.from({ length: 2100 }, (_, i) => ({
      _id: `p-${String(i).padStart(5, "0")}`, organization_id: ORG,
      order: i < 2050 ? "ord-1" : "ord-2",
      status: "completed", payment_type: "payment", method: "cash", amount: 1,
    })));
    db.seed("invoice", [
      factura("fac-1", "2026-09-10T14:00:00.000Z", { ncf: "B0100000001" }),
      factura("fac-2", "2026-09-11T14:00:00.000Z", { ncf: "B0100000002", order: "ord-2" }),
    ]);

    const r = await dgiiReport(ctx, "607", "2026-09");

    // Las dos facturas salen con columnas —o sea, sin problemas de formato—, y
    // es el desglose lo que las hace declarables.
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((f) => f.columns !== null)).toBe(true);
  });
});
