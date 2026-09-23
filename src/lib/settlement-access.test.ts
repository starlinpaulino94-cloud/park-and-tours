import { describe, it, expect } from "vitest";
import { assertSettlementBeneficiary, beneficiaryOf } from "@/lib/settlement-access";
import { esAnulada, totalizar } from "@/lib/seller-settlement-service";

/**
 * QUIÉN PUEDE ABRIR UNA LIQUIDACIÓN.
 *
 * Mientras solo entrara gerencia, el rango bastaba: quien manda las ve todas.
 * En el momento en que se le abre el estado de cuenta a su beneficiario, el
 * rango deja de decidir nada — y bastaría con cambiar el identificador de la
 * dirección para bajarse la de un proveedor, con sus costes y sus retenciones.
 */

const gerente = { role: "manager" as const, partnerId: null, sellerId: null };
const vendedor = (sellerId: string | null) => ({ role: "seller" as const, partnerId: null, sellerId });
const socio = (partnerId: string | null) => ({ role: "partner" as const, partnerId, sellerId: null });

describe("de quién es la liquidación", () => {
  it("lo dice el tipo de beneficiario, no el identificador suelto", () => {
    expect(beneficiaryOf({ beneficiary_type: "seller", seller: "v1" })).toEqual({ kind: "seller", id: "v1" });
    expect(beneficiaryOf({ beneficiary_type: "supplier", supplier: { _id: "p9" } })).toEqual({ kind: "supplier", id: "p9" });
  });

  it("una liquidación que no declara beneficiario no es de nadie", () => {
    expect(beneficiaryOf({ beneficiary_type: "seller" })).toBeNull();
    expect(beneficiaryOf({ seller: "v1" })).toBeNull();
  });
});

describe("la guarda", () => {
  it("gerencia abre cualquiera", () => {
    expect(() => assertSettlementBeneficiary(gerente, { beneficiary_type: "supplier", supplier: "p1" })).not.toThrow();
  });

  it("los rangos intermedios NO abren la de nadie", () => {
    /**
     * `cashier` y `operations` están por encima del vendedor en el escalafón y
     * por debajo de gerencia, y no tienen ficha: si la puerta se apoyara en
     * «rango suficiente» en vez de en «gerencia o beneficiario», cualquiera de
     * los dos abriría TODAS las liquidaciones, proveedores incluidos, con sus
     * costes y sus retenciones dentro.
     */
    for (const role of ["cashier", "operations"] as const) {
      const quien = { role, partnerId: null, sellerId: null };
      expect(
        () => assertSettlementBeneficiary(quien, { beneficiary_type: "supplier", supplier: "s1" }),
        role
      ).toThrow();
      expect(
        () => assertSettlementBeneficiary(quien, { beneficiary_type: "seller", seller: "v1" }),
        role
      ).toThrow();
    }
  });

  it("el vendedor abre la suya", () => {
    expect(() => assertSettlementBeneficiary(vendedor("v1"), { beneficiary_type: "seller", seller: "v1" })).not.toThrow();
  });

  it("y NO la de un compañero", () => {
    expect(() => assertSettlementBeneficiary(vendedor("v1"), { beneficiary_type: "seller", seller: "v2" })).toThrow();
  });

  it("ni la de un proveedor, que es la que lleva costes y retenciones", () => {
    expect(() => assertSettlementBeneficiary(vendedor("v1"), { beneficiary_type: "supplier", supplier: "s1" })).toThrow();
  });

  it("un identificador NO se compara contra el de otra clase de beneficiario", () => {
    /**
     * Los uuid son de tablas distintas. Sin mirar el tipo, la comprobación se
     * convierte en «¿este uuid aparece en algún sitio de la fila?», que es una
     * pregunta que puede responder que sí por accidente — y que abre la
     * liquidación de un socio a un vendedor cuyo identificador coincida.
     */
    const mismoId = "colision";
    expect(() =>
      assertSettlementBeneficiary(vendedor(mismoId), { beneficiary_type: "partner", partner: mismoId })
    ).toThrow();
    expect(() =>
      assertSettlementBeneficiary(socio(mismoId), { beneficiary_type: "seller", seller: mismoId })
    ).toThrow();
  });

  it("DOS NULOS NO CASAN", () => {
    /**
     * El fallo que evita comprobar el tipo ANTES que el identificador: una
     * liquidación de proveedor tiene `seller_id` nulo, y un vendedor sin ficha
     * vinculada tiene `sellerId` nulo. Comparando solo identificadores,
     * `null === null` le habría abierto todas las liquidaciones de
     * proveedores a cualquier cuenta sin vincular.
     */
    expect(() => assertSettlementBeneficiary(vendedor(null), { beneficiary_type: "supplier", supplier: "s1" })).toThrow();
    expect(() => assertSettlementBeneficiary(vendedor(null), { beneficiary_type: "seller", seller: null })).toThrow();
    expect(() => assertSettlementBeneficiary(socio(null), { beneficiary_type: "partner", partner: null })).toThrow();
  });

  it("una liquidación sin beneficiario declarado no se abre a nadie de fuera", () => {
    expect(() => assertSettlementBeneficiary(vendedor("v1"), { beneficiary_type: null })).toThrow();
    // Pero gerencia sí la ve: es un dato de su empresa que además hay que
    // poder arreglar.
    expect(() => assertSettlementBeneficiary(gerente, { beneficiary_type: null })).not.toThrow();
  });
});

describe("las comisiones anuladas se marcan, no se esconden ni se suman", () => {
  const linea = (amount: number, status: string) => ({
    _id: status, booking_number: null, product: null, sold_at: null, service_date: null,
    base_amount: 0, percentage: 0, amount, currency: "usd", status, anulada: esAnulada(status),
  });

  it("cancelada, retenida y en disputa cuentan aparte", () => {
    // Una comisión anulada mostrada como pendiente genera más reclamaciones de
    // las que evita; escondida, el vendedor no entiende por qué falta una venta
    // que sabe que hizo.
    for (const estado of ["cancelled", "held", "disputed"]) {
      expect(esAnulada(estado), estado).toBe(true);
    }
    for (const estado of ["pending", "approved", "settled", "paid"]) {
      expect(esAnulada(estado), estado).toBe(false);
    }
  });

  it("el neto no incluye lo anulado, pero lo anulado se informa", () => {
    const t = totalizar([linea(100, "approved"), linea(50, "cancelled"), linea(25, "pending")]);
    expect(t.devengado).toBe(125);
    expect(t.anulado).toBe(50);
    expect(t.neto).toBe(125);
    expect(t.lineas).toBe(3);
  });
});
