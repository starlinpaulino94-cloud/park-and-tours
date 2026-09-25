import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL DINERO DE UNA COTIZACIÓN, CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * La aritmética —qué suma una línea, qué suma una alternativa, cómo se reparte
 * el impuesto— vive en `quotes.ts` y está probada. Lo que decide ESTE fichero
 * es qué se GUARDA, y ahí hay dos cosas que el módulo puro no puede ver:
 *
 *   · el total de la cabecera se escribe, no se calcula al vuelo, así que
 *     escribirlo sobre un desglose leído a medias deja un precio permanente que
 *     su propio desglose contradice;
 *   · y hay columnas con un rango que una propuesta mal tecleada se salta, y un
 *     `UPDATE` rechazado deja la cotización sin recalcular ninguna de las dos
 *     cosas.
 *
 * Más el ámbito: editar el desglose de la cotización de un compañero es
 * cambiarle el precio a su cliente.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});

import {
  loadQuoteBundle, recalculateQuote, nextSortOrder, persistedLineTotal,
} from "@/lib/quote-service";

const ORG = "org-1";
const ADMIN = { role: "admin" as const, userId: "usr-1", sellerId: null };

const linea = (over: Record<string, unknown>) => ({
  quote: "cot-1", quantity: 1, unit_price: 0, unit_cost: 0,
  discount_percent: 0, sort_order: 10, ...over,
});

function propuesta(extra: Record<string, Record<string, unknown>[]> = {}) {
  db = fakeDb({
    quote: [{
      _id: "cot-1", code: "COT-0001", status: "draft", currency: "usd",
      tax_percent: null, tax: null, seller: "ven-1",
    }],
    quote_option: [],
    quote_line: [
      linea({ _id: "ln-1", quantity: 2, unit_price: 100, unit_cost: 40 }),
      linea({ _id: "ln-2", quantity: 1, unit_price: 50, unit_cost: 20, sort_order: 20 }),
    ],
    ...extra,
  });
}

beforeEach(() => { propuesta(); });

/* ══════════════════════════ lo que se guarda ════════════════════════════ */

describe("el total de la cabecera es una proyección de las líneas", () => {
  it("se guarda sumando el desglose, no lo que mande la pantalla", async () => {
    const out = await recalculateQuote(ORG, "cot-1");
    expect(out.subtotal).toBe(250);
    expect(out.total).toBe(250);
    expect(db.row("quote", { _id: "cot-1" })!.total).toBe(250);
  });

  it("el coste y el margen salen con él", async () => {
    const out = await recalculateQuote(ORG, "cot-1");
    expect(out.cost_total).toBe(100);
    expect(out.margin_amount).toBe(150);
    expect(out.margin_percent).toBe(60);
  });

  it("un extra opcional se ofrece pero no se cobra", async () => {
    propuesta({
      quote_line: [
        linea({ _id: "ln-1", quantity: 1, unit_price: 100 }),
        linea({ _id: "ln-2", quantity: 1, unit_price: 500, is_optional: true }),
      ],
    });
    const out = await recalculateQuote(ORG, "cot-1");
    expect(out.total).toBe(100);
  });

  it("cada alternativa guarda SU total: el cliente compara precios cerrados", async () => {
    propuesta({
      quote_option: [
        { _id: "opt-a", quote: "cot-1", name: "Económica", sort_order: 1 },
        { _id: "opt-b", quote: "cot-1", name: "Premium", sort_order: 2, is_selected: true },
      ],
      quote_line: [
        linea({ _id: "ln-comun", quantity: 1, unit_price: 50 }),
        linea({ _id: "ln-a", quantity: 1, unit_price: 100, option_id: "opt-a" }),
        linea({ _id: "ln-b", quantity: 1, unit_price: 300, option_id: "opt-b" }),
      ],
    });
    await recalculateQuote(ORG, "cot-1");
    expect(Number(db.row("quote_option", { _id: "opt-a" })!.total)).toBe(150);
    expect(Number(db.row("quote_option", { _id: "opt-b" })!.total)).toBe(350);
  });

  it("y la cabecera toma el de la ESCOGIDA", async () => {
    // Es la única respuesta que importa al convertir: ¿qué compró el cliente?
    propuesta({
      quote_option: [
        { _id: "opt-a", quote: "cot-1", name: "Económica", sort_order: 1 },
        { _id: "opt-b", quote: "cot-1", name: "Premium", sort_order: 2, is_selected: true },
      ],
      quote_line: [
        linea({ _id: "ln-a", quantity: 1, unit_price: 100, option_id: "opt-a" }),
        linea({ _id: "ln-b", quantity: 1, unit_price: 300, option_id: "opt-b" }),
      ],
    });
    const out = await recalculateQuote(ORG, "cot-1");
    expect(out.total).toBe(300);
    expect(Number(db.row("quote", { _id: "cot-1" })!.total)).toBe(300);
  });

  it("sin escogida manda la recomendada, y sin ninguna la primera", async () => {
    propuesta({
      quote_option: [
        { _id: "opt-a", quote: "cot-1", name: "Económica", sort_order: 1 },
        { _id: "opt-b", quote: "cot-1", name: "Premium", sort_order: 2, is_recommended: true },
      ],
      quote_line: [
        linea({ _id: "ln-a", quantity: 1, unit_price: 100, option_id: "opt-a" }),
        linea({ _id: "ln-b", quantity: 1, unit_price: 300, option_id: "opt-b" }),
      ],
    });
    expect((await recalculateQuote(ORG, "cot-1")).total).toBe(300);
  });
});

/* ════════════════════ el desglose que no cabe de una vez ════════════════ */

describe("un total no se escribe sobre un desglose recortado", () => {
  it("DOSCIENTAS LÍNEAS NO SE SUMAN A MEDIAS", async () => {
    /**
     * `loadQuoteBundle` lee con tope y esta función GUARDA lo que suma. Con el
     * desglose recortado, la cabecera se quedaba con la suma de las primeras
     * doscientas líneas —escrita, no calculada al vuelo— y la propuesta salía
     * en PDF con un precio que su propio desglose contradice. Y de ahí sale la
     * orden al convertir.
     */
    propuesta({
      quote_line: Array.from({ length: 200 }, (_, i) =>
        linea({ _id: `ln-${i}`, quantity: 1, unit_price: 10, sort_order: i })),
    });
    await expect(recalculateQuote(ORG, "cot-1")).rejects.toThrow(/a medias/);
  });

  it("y el total anterior se queda como estaba en vez de empeorar", async () => {
    propuesta({
      quote_line: Array.from({ length: 200 }, (_, i) =>
        linea({ _id: `ln-${i}`, quantity: 1, unit_price: 10, sort_order: i })),
    });
    await db.tenantUpdate(ORG, "quote", "cot-1", { total: 1234 });
    await expect(recalculateQuote(ORG, "cot-1")).rejects.toThrow();
    expect(Number(db.row("quote", { _id: "cot-1" })!.total)).toBe(1234);
  });

  it("ciento noventa y nueve sí se suman", async () => {
    propuesta({
      quote_line: Array.from({ length: 199 }, (_, i) =>
        linea({ _id: `ln-${i}`, quantity: 1, unit_price: 10, sort_order: i })),
    });
    expect((await recalculateQuote(ORG, "cot-1")).total).toBe(1990);
  });
});

/* ═════════════════════ el margen que no cabe en su columna ══════════════ */

describe("el margen se acota al rango de su columna", () => {
  it("un coste con un dedazo no deja la cotización sin recalcular", async () => {
    /**
     * `margin_percent` es numeric(6,3). Una propuesta cuyo coste multiplica al
     * precio da un porcentaje de cuatro cifras y el UPDATE entero reventaría,
     * dejando sin escribir también el total — que es el dato que el cliente va
     * a leer. Se acota lo que no cabe; el importe del margen, que es el dato
     * real, va sin tocar.
     */
    propuesta({
      quote_line: [linea({ _id: "ln-1", quantity: 1, unit_price: 1, unit_cost: 100000 })],
    });
    const out = await recalculateQuote(ORG, "cot-1");
    expect(Number(db.row("quote", { _id: "cot-1" })!.margin_percent)).toBe(-999.999);
    expect(out.margin_amount).toBe(-99999);
    expect(Number(db.row("quote", { _id: "cot-1" })!.margin_amount)).toBe(-99999);
  });

  it("y sin coste declarado el margen no se inventa", async () => {
    propuesta({ quote_line: [linea({ _id: "ln-1", quantity: 1, unit_price: 100 })] });
    const out = await recalculateQuote(ORG, "cot-1");
    expect(out.margin_percent).toBe(100);
  });
});

/* ═══════════════════════════ de quién es ════════════════════════════════ */

describe("de quién es la cotización", () => {
  it("el ámbito del vendedor viaja hasta la carga", async () => {
    // Editar el desglose de la cotización de un compañero es cambiarle el
    // precio a su cliente.
    await expect(
      loadQuoteBundle(ORG, "cot-1", { role: "seller", userId: "u2", sellerId: "ven-2" })
    ).rejects.toThrow();
  });

  it("y el dueño sí la abre", async () => {
    const bundle = await loadQuoteBundle(ORG, "cot-1", { role: "seller", userId: "u1", sellerId: "ven-1" });
    expect(bundle.lines).toHaveLength(2);
  });

  it("un rango que lo ve todo la abre igual", async () => {
    const bundle = await loadQuoteBundle(ORG, "cot-1", ADMIN);
    expect(bundle.quote.code).toBe("COT-0001");
  });

  it("`null` es uso interno y solo lo usa el recálculo", async () => {
    // Corre DESPUÉS de una escritura ya autorizada: el parámetro es obligatorio
    // justo para que la siguiente ruta tenga que decidir qué pasa.
    const bundle = await loadQuoteBundle(ORG, "cot-1", null);
    expect(bundle.lines).toHaveLength(2);
  });
});

/* ══════════════════════════ el orden del papel ══════════════════════════ */

describe("el orden del documento", () => {
  it("la línea nueva va al final de SU alternativa", async () => {
    const lineas = [
      { sort_order: 10, option_id: null },
      { sort_order: 20, option_id: null },
      { sort_order: 90, option_id: "opt-a" },
    ];
    expect(nextSortOrder(lineas, null)).toBe(30);
    expect(nextSortOrder(lineas, "opt-a")).toBe(100);
  });

  it("y la primera de una alternativa vacía empieza en diez", async () => {
    expect(nextSortOrder([], "opt-b")).toBe(10);
  });

  it("el importe guardado de una línea es el mismo que suma el total", () => {
    // Si fueran dos cuentas distintas, el desglose y el total dejarían de
    // cuadrar sin que nada avisara.
    expect(persistedLineTotal({ quantity: 3, unit_price: 100, discount_percent: 10 })).toBe(270);
  });
});
