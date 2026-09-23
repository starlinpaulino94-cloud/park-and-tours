import { describe, it, expect } from "vitest";
import {
  sellerFilterFor, sellerCanReadRow, isSellerScoped, sellerFieldFor,
  sellerScopeApplies, SELLER_SCOPED,
  ventaSelladaPorVendedor, sellerStampFor, assertSellerOwnsRow,
} from "@/lib/seller-scope";
import { buildListFilter } from "@/lib/erp-query";
import { RESOURCES } from "@/lib/resources";
import type { TenantContext } from "@/lib/tenant";

/**
 * LO QUE SE REPORTÓ: «el vendedor ve las ventas de todos».
 *
 * Tres propiedades sostienen el arreglo, y las tres se prueban aquí:
 *
 *  1. Un vendedor NUNCA ve una fila de otro vendedor —ni listada, ni abierta
 *     por su identificador, ni editándola—.
 *  2. Un vendedor SÍ ve las filas sin vendedor: son de la empresa, y esconderlas
 *     le quitaría su propia venta recién hecha (el punto de venta no sella el
 *     vendedor) y el histórico entero.
 *  3. No saber quién es el vendedor NO abre el ámbito: acota a «lo de nadie».
 */

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  userId: "u1", email: "u@x.com", name: "u", role: "seller",
  companyId: "org-1", partnerId: null, branchId: null, sellerId: "v1",
  company: null, ...over,
});

describe("qué se acota", () => {
  it("la venta y su embudo, sí", () => {
    for (const table of ["order", "booking", "quote", "lead"]) {
      expect(isSellerScoped(table), table).toBe(true);
    }
  });

  it("el desempeño y la paga de cada uno, también", () => {
    for (const table of ["seller_goal", "seller_bonus", "seller_link", "seller_attribution", "commission"]) {
      expect(isSellerScoped(table), table).toBe(true);
    }
  });

  it("el libro de clientes y la lista de espera, NO", () => {
    /**
     * Son operativos: quien esté en el mostrador tiene que encontrar al cliente
     * que vuelve —si no, lo da de alta otra vez y el directorio se llena de
     * duplicados— y tiene que poder llamar al siguiente de la cola cuando se
     * libera una plaza, aunque lo apuntara un compañero que hoy libra.
     */
    expect(isSellerScoped("customer")).toBe(false);
    expect(isSellerScoped("waitlist_entry")).toBe(false);
  });

  it("el catálogo de la empresa, NO", () => {
    // Acotarlo dejaría al vendedor sin poder vender.
    for (const table of ["product", "departure", "hotel", "cancellation_policy"]) {
      expect(isSellerScoped(table), table).toBe(false);
    }
  });

  it("toda tabla acotada existe como recurso y declara ese campo", () => {
    /**
     * Una tabla mal escrita aquí no rompe nada visible: simplemente no se
     * acota, y la separación entre vendedores sería mentira para esa lista.
     * Un campo mal escrito es peor todavía —filtraría por una columna que no
     * existe—, así que se comprueba contra lo que el recurso declara.
     */
    for (const [table, field] of Object.entries(SELLER_SCOPED)) {
      const resource = Object.values(RESOURCES).find((r) => r.table === table);
      expect(resource, `${table} no existe en RESOURCES`).toBeTruthy();
      const declarado =
        resource!.writable.includes(field) ||
        Object.keys(resource!.expand || {}).includes(field) ||
        Object.keys(resource!.expandOne || {}).includes(field);
      expect(declarado, `${table}.${field} no está declarado en el recurso`).toBe(true);
    }
  });
});

describe("a quién se acota", () => {
  it("solo al rango más bajo", () => {
    expect(sellerScopeApplies("seller")).toBe(true);
    for (const role of ["cashier", "operations", "manager", "admin", "owner", "superadmin"] as const) {
      expect(sellerScopeApplies(role), role).toBe(false);
    }
  });

  it("un gerente sigue viendo la empresa entera", () => {
    expect(sellerFilterFor("order", "manager", null)).toBeNull();
    expect(sellerFilterFor("order", "manager", "v1")).toBeNull();
  });
});

describe("el filtro", () => {
  it("trae lo suyo y lo que no es de ningún vendedor", () => {
    expect(sellerFilterFor("order", "seller", "v1")).toEqual({
      _or: [{ seller: "v1" }, { seller: null }],
    });
  });

  it("sin ficha vinculada NO abre: acota a lo de nadie", () => {
    /**
     * Es la diferencia con el ámbito de sucursal, que sin sucursal no acota.
     * Aquí «no sé quién eres» no puede significar «te enseño todo»: sería
     * exactamente el agujero que esto viene a cerrar, y bastaría con no
     * vincular la ficha para conservarlo.
     */
    expect(sellerFilterFor("order", "seller", null)).toEqual({ seller: null });
    expect(sellerFilterFor("order", "seller", undefined)).toEqual({ seller: null });
  });

  it("el campo del cliente no se llama igual que el de la venta", () => {
    // `customer` no se acota, pero si algún día se acotara sería por
    // `assigned_seller`. Filtrar por `seller` no fallaría: no traería NADA.
    expect(sellerFieldFor("order")).toBe("seller");
    expect(sellerFieldFor("customer")).toBeNull();
  });

  it("una tabla sin dimensión de vendedor no se acota", () => {
    expect(sellerFilterFor("product", "seller", "v1")).toBeNull();
  });
});

describe("una fila concreta", () => {
  it("la de otro vendedor, no", () => {
    expect(sellerCanReadRow("order", "seller", "v1", "v2")).toBe(false);
  });

  it("la suya, sí", () => {
    expect(sellerCanReadRow("order", "seller", "v1", "v1")).toBe(true);
  });

  it("la que no tiene vendedor, sí", () => {
    expect(sellerCanReadRow("order", "seller", "v1", null)).toBe(true);
  });

  it("sin ficha vinculada, solo las que no tienen vendedor", () => {
    expect(sellerCanReadRow("order", "seller", null, null)).toBe(true);
    expect(sellerCanReadRow("order", "seller", null, "v2")).toBe(false);
  });

  it("un gerente abre cualquiera", () => {
    expect(sellerCanReadRow("order", "manager", null, "v2")).toBe(true);
  });

  it("una tabla no acotada se abre entera", () => {
    expect(sellerCanReadRow("product", "seller", "v1", "v2")).toBe(true);
  });
});

describe("el listado y su exportación comparten el corte", () => {
  it("el filtro del listado lleva el vendedor", () => {
    const filter = buildListFilter(RESOURCES.order, ctx(), new URLSearchParams()) as Record<string, unknown>;
    expect(filter._and).toContainEqual({ _or: [{ seller: "v1" }, { seller: null }] });
  });

  it("el ámbito de sucursal y el de vendedor se acumulan, no se pisan", () => {
    /**
     * Dos grupos `_or` fusionados en el mismo objeto dejarían solo uno vivo, y
     * ese decidiría solo: el vendedor vería las ventas de sus compañeros en su
     * sucursal, o las suyas en todas. Como elementos distintos de `_and`, el
     * traductor los aplica uno tras otro y se cumplen los dos.
     */
    const filter = buildListFilter(
      RESOURCES.booking, ctx({ branchId: "b1" }), new URLSearchParams()
    ) as Record<string, unknown>;
    const partes = filter._and as Record<string, unknown>[];
    expect(partes).toContainEqual({ _or: [{ branch: "b1" }, { branch: null }] });
    expect(partes).toContainEqual({ _or: [{ seller: "v1" }, { seller: null }] });
  });

  it("un gerente exporta sin ámbito de vendedor", () => {
    const filter = buildListFilter(
      RESOURCES.order, ctx({ role: "manager" }), new URLSearchParams()
    ) as Record<string, unknown>;
    expect(filter._and).toBeUndefined();
  });

  it("el catálogo sigue entero para el vendedor", () => {
    const filter = buildListFilter(RESOURCES.product, ctx(), new URLSearchParams()) as Record<string, unknown>;
    expect(filter._and).toBeUndefined();
  });
});

describe("quién sella la venta", () => {
  const persona = { role: "seller" as const, userId: "u1", sellerId: "v1" };
  const web = { role: "seller" as const, userId: "", sellerId: null };

  it("una persona con rango de vendedor, sí", () => {
    expect(ventaSelladaPorVendedor(persona)).toBe(true);
  });

  it("los motores sin sesión, NO", () => {
    /**
     * El motor de la web pública y el de reservas de revendedor fabrican un
     * contexto con rol `seller` y sin usuario, a propósito. Sellar por el rol a
     * secas habría puesto `seller_id` en null en toda venta web y apagado el
     * motor de atribución entero —la cookie del visitante es lo único que
     * encuentra al conserje que compartió el enlace— sin ningún error que lo
     * delatara.
     */
    expect(ventaSelladaPorVendedor(web)).toBe(false);
  });

  it("de cajero hacia arriba, NO", () => {
    // Registrar la venta de otro es trabajo normal en el mostrador.
    for (const role of ["cashier", "manager", "admin", "owner"] as const) {
      expect(ventaSelladaPorVendedor({ role, userId: "u1" }), role).toBe(false);
    }
  });
});

describe("el sello al crear", () => {
  const persona = { role: "seller" as const, userId: "u1", sellerId: "v1" };

  it("pone al vendedor de quien crea", () => {
    expect(sellerStampFor("lead", persona, { name: "Ana" })).toEqual({ name: "Ana", seller: "v1" });
  });

  it("PISA el que venía en el cuerpo", () => {
    /**
     * Aquí está la diferencia con el sello de sucursal, que respeta lo elegido:
     * un gerente creando algo para otra sucursal está en su derecho, pero un
     * vendedor eligiendo a otro vendedor no es una decisión legítima — es
     * regalar o quedarse una comisión.
     */
    expect(sellerStampFor("lead", persona, { seller: "v2" })).toEqual({ seller: "v1" });
  });

  it("sin ficha vinculada sella a nadie, y tampoco deja pasar lo del cuerpo", () => {
    // Si dejara pasar el valor del cuerpo, bastaría con no vincular la ficha
    // para poder atribuirse lo que sea.
    const sinFicha = { role: "seller" as const, userId: "u1", sellerId: null };
    expect(sellerStampFor("lead", sinFicha, { seller: "v2" })).toEqual({ seller: null });
  });

  it("no sella lo que no tiene dimensión de vendedor, ni a quien manda", () => {
    expect(sellerStampFor("product", persona, { name: "Saona" })).toEqual({ name: "Saona" });
    expect(sellerStampFor("lead", { role: "manager", userId: "u1" }, { seller: "v2" })).toEqual({ seller: "v2" });
  });
});

describe("actuar sobre una fila ajena", () => {
  const persona = { role: "seller" as const, userId: "u1", sellerId: "v1" };

  it("la reserva de otro se rechaza con 403", () => {
    // Cancelar anula la comisión de quien vendió: sin esto, un vendedor le
    // borraba el mes a un compañero con una llamada.
    try {
      assertSellerOwnsRow("booking", persona, { seller: "v2" }, "Esta reserva");
      throw new Error("no lanzó");
    } catch (err) {
      expect((err as Error).message).toBe("Esta reserva es de otro vendedor");
      expect((err as { status?: number }).status).toBe(403);
    }
  });

  it("la suya y la de nadie pasan, y la referencia expandida también", () => {
    expect(() => assertSellerOwnsRow("booking", persona, { seller: "v1" })).not.toThrow();
    expect(() => assertSellerOwnsRow("booking", persona, { seller: null })).not.toThrow();
    // La fila puede traer la relación expandida como objeto: comparar en crudo
    // habría dejado pasar la de otro.
    expect(() => assertSellerOwnsRow("booking", persona, { seller: { _id: "v2" } })).toThrow();
    expect(() => assertSellerOwnsRow("booking", persona, { seller: { _id: "v1" } })).not.toThrow();
  });

  it("un gerente actúa sobre cualquiera", () => {
    expect(() => assertSellerOwnsRow("booking", { role: "manager", userId: "u1" }, { seller: "v2" })).not.toThrow();
  });
});
