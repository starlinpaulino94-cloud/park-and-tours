import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL ESTADO DE CUENTA DEL VENDEDOR — SU NÓMINA.
 *
 * `totalizar` y `esAnulada` estaban probados de refilón por la guarda de acceso,
 * pero la REUNIÓN de los datos no la probaba nadie: qué comisiones entran, con
 * qué porcentaje y cuántas. Y de este papel sale lo que se le paga a una
 * persona el día 30.
 *
 * Leía con `_limit: 1000`, así que un vendedor con más comisiones en el período
 * recibía un estado de cuenta corto —y un estado de cuenta corto es una nómina
 * corta—. No daba error: daba un número menor y lo presentaba como el bueno.
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

import { loadSellerStatement, totalizar, esAnulada } from "@/lib/seller-settlement-service";

const ORG = "org-1";
const LIQ = "liq-1";

/** Una comisión de la liquidación. */
const comision = (id: string, extra: Record<string, unknown> = {}) => ({
  _id: id, organization_id: ORG, settlement: LIQ, seller: "vend-1",
  booking: "res-1", base_amount: 1000, percentage: 10, amount: 100,
  currency: "usd", status: "settled", service_date: "2026-09-15",
  ...extra,
});

function libros(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Caribe Tours" }],
    seller: [{ _id: "vend-1", organization_id: ORG, name: "Ana", currency: "usd" }],
    product: [{ _id: "prod-1", organization_id: ORG, name: "Isla Saona" }],
    booking: [{ _id: "res-1", organization_id: ORG, booking_number: "RES-1", product: "prod-1" }],
    settlement: [{
      _id: LIQ, organization_id: ORG, beneficiary_type: "seller", seller: "vend-1",
      currency: "usd", status: "pending",
    }],
    ...extra,
  });
}

beforeEach(() => { db = libros(); });

describe("lo vivo y lo anulado", () => {
  it("una comisión anulada se MARCA, no se esconde ni se suma al neto", async () => {
    db = libros({ commission: [
      comision("c1"),
      comision("c2", { status: "cancelled", amount: 250 }),
    ] });

    const estado = await loadSellerStatement(ORG, LIQ);

    // Las dos se enseñan: esconderla genera más reclamaciones de las que evita.
    expect(estado.lines).toHaveLength(2);
    expect(estado.totals.devengado).toBe(100);
    expect(estado.totals.anulado).toBe(250);
    expect(estado.totals.neto).toBe(100);
  });

  it("el porcentaje que se enseña es el CONGELADO de la comisión", async () => {
    // Si se leyera el vigente del vendedor, cambiarle la tarifa hoy
    // reescribiría lo que se le debe por lo que vendió en marzo.
    db = libros({ commission: [comision("c1", { percentage: 7 })] });
    const estado = await loadSellerStatement(ORG, LIQ);
    expect(estado.lines[0].percentage).toBe(7);
  });

  it("los tres estados de anulación cuentan como anulados", () => {
    for (const s of ["cancelled", "held", "disputed"]) expect(esAnulada(s)).toBe(true);
    for (const s of ["settled", "pending", "paid", null, undefined]) expect(esAnulada(s)).toBe(false);
  });

  it("totalizar no mete lo anulado en el neto", () => {
    const t = totalizar([
      { amount: 100, ajustes: 0, anulada: false }, { amount: 50, ajustes: 0, anulada: true },
    ] as Parameters<typeof totalizar>[0]);
    expect(t).toEqual({ devengado: 100, anulado: 50, ajustes: 0, neto: 100, lineas: 2 });
  });

  it("y el ajuste de lo vivo SÍ baja el neto", () => {
    // El neto era `devengado` a secas mientras la liquidación transfería el
    // neto de verdad. Ésta es la mitad pura de esa diferencia.
    const t = totalizar([
      { amount: 100, ajustes: -25, anulada: false },
    ] as Parameters<typeof totalizar>[0]);
    expect(t.devengado).toBe(100);
    expect(t.ajustes).toBe(-25);
    expect(t.neto).toBe(75);
  });
});

/**
 * UN VENDEDOR CON MÁS DE MIL COMISIONES (ola 9.12).
 *
 * Estas pruebas suman dinero, no cuentan filas: un estado de cuenta que enseña
 * mil líneas de mil trescientas y uno que enseña las mil trescientas dan el
 * mismo tipo de respuesta y distinto importe.
 */
describe("un vendedor con más comisiones que el tope viejo", () => {
  const muchas = (cuantas: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: cuantas }, (_, i) =>
      comision(`m-${String(i).padStart(5, "0")}`, { amount: 100, ...extra }));

  it("el devengado es la suma de TODAS sus comisiones", async () => {
    db = libros({ commission: muchas(1300) });

    const estado = await loadSellerStatement(ORG, LIQ);

    // Con el tope de mil esto pagaba 100 000 de los 130 000 que se le debían.
    expect(estado.lines).toHaveLength(1300);
    expect(estado.totals.devengado).toBe(130_000);
  });

  it("y ninguna se cuenta dos veces al cambiar de página", async () => {
    // Paginar sin orden total puede solapar dos páginas, y aquí eso significa
    // pagarle dos veces la misma comisión.
    db = libros({ commission: muchas(1300) });

    const estado = await loadSellerStatement(ORG, LIQ);

    expect(new Set(estado.lines.map((l) => l._id)).size).toBe(1300);
    expect(estado.totals.devengado)
      .toBe(estado.lines.filter((l) => !l.anulada).reduce((t, l) => t + l.amount, 0));
  });

  it("lo anulado tampoco se trunca: si no, el neto sale ALTO", async () => {
    /**
     * El truncamiento no siempre paga de menos. Si lo que se queda fuera son
     * las anuladas, el papel dice que se le debe un dinero que se le quitó — y
     * ése es el error que el vendedor no reclama.
     */
    db = libros({ commission: [
      ...muchas(600),
      ...muchas(700, { status: "cancelled", amount: 50 }).map((c, i) => ({ ...c, _id: `anu-${i}` })),
    ] });

    const estado = await loadSellerStatement(ORG, LIQ);

    expect(estado.totals.devengado).toBe(60_000);
    expect(estado.totals.anulado).toBe(35_000);
    expect(estado.totals.lineas).toBe(1300);
  });

  it("si de verdad no se puede leer todo, no se enseña una nómina a medias", async () => {
    db = libros({ commission: muchas(10_600) });
    await expect(loadSellerStatement(ORG, LIQ)).rejects.toThrow(/no se pudo leer/i);
  });
});

/**
 * EL AJUSTE, EN EL PAPEL DEL VENDEDOR (bloque 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS DOS CIFRAS QUE NO COINCIDÍAN
 *
 * `/api/settlements/generate` suma `net_amount ?? amount`, con un comentario
 * que dice por qué: «SE LIQUIDA EL NETO, NO EL IMPORTE». Este papel —el que se
 * le entrega a esa misma persona para explicarle esa misma transferencia—
 * sumaba `amount`.
 *
 * Es decir: la empresa transfiere el neto y el documento dice el bruto. Con un
 * solo ajuste, la diferencia aparece en el banco y en ninguna pantalla, y la
 * persona se entera de que le recuperaron una comisión porque le llega menos
 * dinero del que pone en su estado de cuenta.
 *
 * No saltó antes porque `commission_adjustment` tiene CERO FILAS: las dos
 * fórmulas llevan desde 0059 sin poder discrepar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE LEEN LOS AJUSTES DE ESTA LIQUIDACIÓN, NO EL NETO DE HOY
 *
 * Un ajuste posterior no reescribe un documento ya entregado. Es la misma
 * decisión que el porcentaje congelado: nadie puede discutir un papel que
 * cambia solo.
 */
describe("el ajuste sale en el estado de cuenta", () => {
  const ajuste = (id: string, extra: Record<string, unknown> = {}) => ({
    _id: id, organization_id: ORG, commission: "c1", settlement: LIQ,
    amount: -100, currency: "usd", reason: "La venta se canceló después de pagarse",
    reason_code: "clawback", created_at: "2026-09-20T10:00:00Z",
    ...extra,
  });

  it("el neto del papel es el que se transfiere, no el bruto", async () => {
    db = libros({
      // Pagada y NO anulada: sigue estando pagada, porque se pagó.
      commission: [comision("c1", { amount: 100, status: "paid" })],
      commission_adjustment: [ajuste("a1", { amount: -100 })],
    });

    const estado = await loadSellerStatement(ORG, LIQ);

    expect(estado.totals.devengado).toBe(100);
    expect(estado.totals.ajustes).toBe(-100);
    expect(estado.totals.neto).toBe(0);
  });

  it("y la línea dice cuánto se ajustó y POR QUÉ", async () => {
    db = libros({
      commission: [comision("c1", { amount: 100, status: "paid" })],
      commission_adjustment: [ajuste("a1", { amount: -100 })],
    });

    const [linea] = (await loadSellerStatement(ORG, LIQ)).lines;

    expect(linea.amount).toBe(100);
    expect(linea.ajustes).toBe(-100);
    expect(linea.neto).toBe(0);
    // Sin el motivo, un descuento de cien es una reclamación.
    expect(linea.motivos).toEqual(["La venta se canceló después de pagarse"]);
  });

  it("varios ajustes sobre la misma comisión se suman con su signo", async () => {
    db = libros({
      commission: [comision("c1", { amount: 100, status: "settled" })],
      commission_adjustment: [
        ajuste("a1", { amount: -30, reason: "Descuento autorizado fuera de tarifa" }),
        ajuste("a2", { amount: 12, reason: "Premio pactado fuera de la regla" }),
      ],
    });

    const [linea] = (await loadSellerStatement(ORG, LIQ)).lines;
    expect(linea.ajustes).toBe(-18);
    expect(linea.neto).toBe(82);
    expect(linea.motivos).toHaveLength(2);
  });

  it("sin ajustes, el neto es el bruto y nada cambia", async () => {
    db = libros({ commission: [comision("c1", { amount: 100 })] });
    const estado = await loadSellerStatement(ORG, LIQ);
    expect(estado.totals.ajustes).toBe(0);
    expect(estado.totals.neto).toBe(100);
    expect(estado.lines[0].ajustes).toBe(0);
    expect(estado.lines[0].neto).toBe(100);
  });

  it("el ajuste de una comisión ANULADA no resta dos veces", async () => {
    /**
     * Lo anulado ya está fuera del devengado. Si además se le restara su
     * ajuste, el neto bajaría por una comisión que nunca entró.
     */
    db = libros({
      commission: [comision("c1", { amount: 100, status: "cancelled" })],
      commission_adjustment: [ajuste("a1", { amount: -100 })],
    });

    const estado = await loadSellerStatement(ORG, LIQ);
    expect(estado.totals.devengado).toBe(0);
    expect(estado.totals.anulado).toBe(100);
    expect(estado.totals.ajustes).toBe(0);
    expect(estado.totals.neto).toBe(0);
  });

  it("un ajuste de OTRA liquidación no entra en este papel", async () => {
    db = libros({
      commission: [comision("c1", { amount: 100, status: "paid" })],
      commission_adjustment: [
        ajuste("a1", { amount: -40 }),
        ajuste("a2", { amount: -60, settlement: "liq-2" }),
      ],
    });

    const estado = await loadSellerStatement(ORG, LIQ);
    expect(estado.totals.ajustes).toBe(-40);
    expect(estado.totals.neto).toBe(60);
  });
});
