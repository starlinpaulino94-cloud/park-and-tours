import { describe, it, expect } from "vitest";
import { branchFilterFor, branchStampFor, isBranchScoped, BRANCH_SCOPED } from "@/lib/branch-scope";
import { buildListFilter } from "@/lib/erp-query";
import { RESOURCES } from "@/lib/resources";
import type { TenantContext } from "@/lib/tenant";

/**
 * Dos propiedades sostienen esta función, y las dos son sobre NO perder cosas:
 * quien no tiene sucursal sigue viendo todo (nadie pierde acceso al activarlo),
 * y las filas sin sucursal las ve todo el mundo (separar los puntos de venta no
 * puede significar perder el histórico).
 */

const ctxWith = (branchId: string | null, role = "seller"): TenantContext => ({
  userId: "u1", email: "u@x.com", name: "u", role: role as never,
  companyId: "org-1", partnerId: null, branchId, company: null,
});

describe("qué se acota", () => {
  it("las tablas de un punto de venta, sí", () => {
    for (const table of ["booking", "cash_session", "expense", "departure"]) {
      expect(isBranchScoped(table), table).toBe(true);
    }
  });

  it("los catálogos de la empresa, NO", () => {
    /**
     * Acotarlo todo dejaría al vendedor de una sucursal sin poder vender: el
     * producto, el hotel, el cliente y la política de cancelación son de la
     * empresa entera.
     */
    for (const table of ["product", "hotel", "customer", "cancellation_policy", "price_rule", "partner"]) {
      expect(isBranchScoped(table), table).toBe(false);
    }
  });

  it("toda tabla acotada existe y tiene ese campo declarado escribible o expandible", () => {
    // Una tabla mal escrita aquí no rompe nada: simplemente no se acota, y la
    // separación de sucursales sería mentira para esa lista.
    for (const table of Object.keys(BRANCH_SCOPED)) {
      const resource = Object.values(RESOURCES).find((r) => r.table === table);
      expect(resource, `${table} no existe en RESOURCES`).toBeTruthy();
    }
  });
});

describe("el filtro", () => {
  it("sin sucursal no acota nada", () => {
    // Es lo que garantiza que esta migración no le quite acceso a nadie.
    expect(branchFilterFor("booking", null)).toBeNull();
    expect(branchFilterFor("booking", undefined)).toBeNull();
  });

  it("con sucursal trae la suya y las que no son de ninguna", () => {
    expect(branchFilterFor("booking", "b1")).toEqual({
      _or: [{ branch: "b1" }, { branch: null }],
    });
  });

  it("una tabla que no es de sucursal no se acota aunque la persona tenga una", () => {
    expect(branchFilterFor("product", "b1")).toBeNull();
  });
});

describe("el sello al crear", () => {
  it("pone la sucursal de quien crea", () => {
    expect(branchStampFor("expense", "b1", { amount: 100 })).toEqual({ amount: 100, branch: "b1" });
  });

  it("respeta la que se eligió explícitamente", () => {
    // Un gerente registrando algo PARA otra sucursal está en su derecho, y
    // pisarle el dato sería un error silencioso.
    expect(branchStampFor("expense", "b1", { branch: "b2" })).toEqual({ branch: "b2" });
  });

  it("no sella lo que no es de sucursal, ni a quien no tiene", () => {
    expect(branchStampFor("product", "b1", { name: "Saona" })).toEqual({ name: "Saona" });
    expect(branchStampFor("expense", null, { amount: 1 })).toEqual({ amount: 1 });
  });
});

describe("el listado y su exportación comparten el corte", () => {
  const def = RESOURCES.booking;

  it("el filtro del listado lleva la sucursal combinada con «y», no fusionada", () => {
    /**
     * Dos grupos `_or` en el mismo objeto se pisan: solo sobreviviría uno, y ese
     * decidiría solo. Con `_and`, el traductor los aplica uno tras otro, que es
     * lo que hace que «lo mío» y «lo de mi sucursal» se cumplan a la vez.
     */
    const sp = new URLSearchParams({ q: "Perez" });
    const filter = buildListFilter(def, ctxWith("b1"), sp) as Record<string, unknown>;
    expect(Array.isArray(filter._and)).toBe(true);
    const [previo, sucursal] = filter._and as Record<string, unknown>[];
    expect(previo._or).toBeTruthy();                 // la búsqueda sigue ahí
    expect(sucursal).toEqual({ _or: [{ branch: "b1" }, { branch: null }] });
  });

  it("sin sucursal, el filtro queda exactamente como antes", () => {
    const filter = buildListFilter(def, ctxWith(null), new URLSearchParams()) as Record<string, unknown>;
    expect(filter._and).toBeUndefined();
  });

  it("un recurso de catálogo no se acota ni con sucursal", () => {
    const filter = buildListFilter(RESOURCES.product, ctxWith("b1"), new URLSearchParams()) as Record<string, unknown>;
    expect(filter._and).toBeUndefined();
  });
});
