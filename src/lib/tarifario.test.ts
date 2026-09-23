import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL TARIFARIO NETO, POR LO QUE DEVUELVE.
 *
 * Esto no mira el código del tarifario: lo ejecuta. La diferencia importa
 * porque la propiedad que hay que defender —«un producto sin tarifa no tumba
 * el archivo entero»— es una propiedad de lo que SALE, y un guardia de texto
 * que se conforme con ver un `catch` la da por buena aunque dentro se vuelva a
 * lanzar el error.
 */

let db: FakeDb;
/** Productos cuyo precio revienta, para simular una tarifa que falta. */
let sinTarifa: Set<string>;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
  };
});

vi.mock("@/lib/pricing", () => ({
  resolvePrice: vi.fn(async (input: { productId: string; modalityId?: string | null }) => {
    if (sinTarifa.has(input.productId)) {
      throw new Error(`No hay tarifa vigente para ${input.productId}`);
    }
    return {
      unitPrice: 40,
      grossAmount: 40,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 40,
      currency: "usd",
      snapshot: { applied_rule_name: "Neto socio" },
      appliedRule: null,
    };
  }),
}));

import { tarifarioDeSocio } from "@/lib/tarifario";
import { resolvePrice } from "@/lib/pricing";

const ORG = "org-1";
const SOCIO = "partner-1";

function base() {
  return fakeDb({
    product: [
      { _id: "p-1", name: "Isla Saona", code: "SAO", status: "active" },
      { _id: "p-2", name: "Hoyo Azul", code: "HOY", status: "active" },
      { _id: "p-3", name: "Montaña Redonda", code: "MON", status: "active" },
    ],
    product_modality: [
      { _id: "m-1", product: "p-1", name: "Adulto", modality_type: "adult", status: "active" },
      { _id: "m-2", product: "p-2", name: "Adulto", modality_type: "adult", status: "active" },
      { _id: "m-3", product: "p-3", name: "Adulto", modality_type: "adult", status: "active" },
    ],
    partner_product: [
      { _id: "pp-1", partner: SOCIO, product: "p-1", status: "active" },
      { _id: "pp-2", partner: SOCIO, product: "p-2", status: "active" },
      { _id: "pp-3", partner: SOCIO, product: "p-3", status: "active" },
    ],
  });
}

beforeEach(() => {
  db = base();
  sinTarifa = new Set();
  vi.clearAllMocks();
});

describe("el tarifario neto de un tour center", () => {
  it("una línea por producto autorizado, con la regla que ganó", async () => {
    const lineas = await tarifarioDeSocio(ORG, SOCIO, "2026-07-15");
    expect(lineas.map((l) => l.product_name)).toEqual(["Hoyo Azul", "Isla Saona", "Montaña Redonda"]);
    expect(lineas[0]).toMatchObject({
      product_code: "HOY", modality_name: "Adulto", currency: "usd", net_price: 40, rule: "Neto socio",
    });
  });

  it("UN PRODUCTO SIN TARIFA NO TUMBA EL TARIFARIO ENTERO", async () => {
    /**
     * Lo contrario le quitaría al socio los cuarenta precios que sí tiene por
     * culpa del que falta, y el arreglo está del lado de la operadora: el socio
     * se quedaría esperando un archivo que nadie sabe que no se genera.
     */
    sinTarifa.add("p-2");

    const lineas = await tarifarioDeSocio(ORG, SOCIO, "2026-07-15");

    expect(lineas.map((l) => l.product_id)).toEqual(["p-1", "p-3"]);
    // Y el que falta se cae solo: los otros dos siguen con su precio.
    expect(lineas.every((l) => l.net_price === 40)).toBe(true);
  });

  it("si fallan todos, el tarifario sale vacío en vez de reventar", async () => {
    sinTarifa = new Set(["p-1", "p-2", "p-3"]);
    await expect(tarifarioDeSocio(ORG, SOCIO, "2026-07-15")).resolves.toEqual([]);
  });

  it("sin nada autorizado no se pregunta el precio de nada", async () => {
    db = fakeDb({ product: [{ _id: "p-1", name: "Isla Saona", status: "active" }] });
    expect(await tarifarioDeSocio(ORG, SOCIO, "2026-07-15")).toEqual([]);
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it("un producto sin modalidades declaradas también tiene su línea", async () => {
    db = fakeDb({
      product: [{ _id: "p-9", name: "Traslado", code: "TRA", status: "active" }],
      partner_product: [{ _id: "pp-9", partner: SOCIO, product: "p-9", status: "active" }],
    });
    const lineas = await tarifarioDeSocio(ORG, SOCIO, "2026-07-15");
    expect(lineas).toHaveLength(1);
    expect(lineas[0].modality_id).toBeNull();
    expect(lineas[0].modality_name).toBeNull();
  });

  it("el precio se pide con la fecha y el canal con el que se reserva", async () => {
    /**
     * El canal decide la regla. Con otro canal aquí, el archivo diría un precio
     * y la reserva cobraría otro — y eso sale a la luz facturando, no probando.
     */
    await tarifarioDeSocio(ORG, SOCIO, "2026-07-15");
    expect(resolvePrice).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "b2b_portal", travelDate: "2026-07-15", partnerId: SOCIO, quantity: 1 })
    );
  });

  it("lo desautorizado no aparece", async () => {
    db = base();
    await db.tenantQuery(ORG, "partner_product", {});
    db = fakeDb({
      product: [
        { _id: "p-1", name: "Isla Saona", status: "active" },
        { _id: "p-2", name: "Hoyo Azul", status: "active" },
      ],
      partner_product: [
        { _id: "pp-1", partner: SOCIO, product: "p-1", status: "active" },
        { _id: "pp-2", partner: SOCIO, product: "p-2", status: "inactive" },
      ],
    });
    const lineas = await tarifarioDeSocio(ORG, SOCIO, "2026-07-15");
    expect(lineas.map((l) => l.product_id)).toEqual(["p-1"]);
  });
});
