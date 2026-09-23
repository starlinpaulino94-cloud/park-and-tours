import { describe, it, expect } from "vitest";
import {
  sellerFilterFor, sellerCanReadRow, isSellerScoped, sellerFieldFor,
  sellerScopeApplies, SELLER_SCOPED,
  ventaSelladaPorVendedor, sellerStampFor, assertSellerOwnsRow,
  esEstricta, SELLER_ESTRICTAS, NADIE,
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
    expect(sellerScopeApplies({ role: "seller" })).toBe(true);
    for (const role of ["cashier", "operations", "manager", "admin", "owner", "superadmin"] as const) {
      expect(sellerScopeApplies({ role: role }), role).toBe(false);
    }
  });

  it("un gerente sigue viendo la empresa entera", () => {
    expect(sellerFilterFor("order", { role: "manager", sellerId: null })).toBeNull();
    expect(sellerFilterFor("order", { role: "manager", sellerId: "v1" })).toBeNull();
  });
});

describe("el filtro", () => {
  it("trae lo suyo y lo que no es de ningún vendedor", () => {
    expect(sellerFilterFor("order", { role: "seller", sellerId: "v1" })).toEqual({
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
    expect(sellerFilterFor("order", { role: "seller", sellerId: null })).toEqual({ seller: null });
    expect(sellerFilterFor("order", { role: "seller", sellerId: undefined })).toEqual({ seller: null });
  });

  it("el campo del cliente no se llama igual que el de la venta", () => {
    // `customer` no se acota, pero si algún día se acotara sería por
    // `assigned_seller`. Filtrar por `seller` no fallaría: no traería NADA.
    expect(sellerFieldFor("order")).toBe("seller");
    expect(sellerFieldFor("customer")).toBeNull();
  });

  it("una tabla sin dimensión de vendedor no se acota", () => {
    expect(sellerFilterFor("product", { role: "seller", sellerId: "v1" })).toBeNull();
  });
});

describe("una fila concreta", () => {
  it("la de otro vendedor, no", () => {
    expect(sellerCanReadRow("order", { role: "seller", sellerId: "v1" }, "v2")).toBe(false);
  });

  it("la suya, sí", () => {
    expect(sellerCanReadRow("order", { role: "seller", sellerId: "v1" }, "v1")).toBe(true);
  });

  it("la que no tiene vendedor, sí", () => {
    expect(sellerCanReadRow("order", { role: "seller", sellerId: "v1" }, null)).toBe(true);
  });

  it("sin ficha vinculada, solo las que no tienen vendedor", () => {
    expect(sellerCanReadRow("order", { role: "seller", sellerId: null }, null)).toBe(true);
    expect(sellerCanReadRow("order", { role: "seller", sellerId: null }, "v2")).toBe(false);
  });

  it("un gerente abre cualquiera", () => {
    expect(sellerCanReadRow("order", { role: "manager", sellerId: null }, "v2")).toBe(true);
  });

  it("una tabla no acotada se abre entera", () => {
    expect(sellerCanReadRow("product", { role: "seller", sellerId: "v1" }, "v2")).toBe(true);
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

describe("donde «sin vendedor» NO significa «de la empresa»", () => {
  /**
   * EL FALLO QUE ESTAS PRUEBAS EVITAN.
   *
   * La regla «lo mío o lo de nadie» es correcta para la VENTA: una orden sin
   * vendedor entró por la web o la registró un administrador, y esconderla
   * sería perder el pasado.
   *
   * En el dinero es al revés, y no se ve hasta mirar el esquema: `commission`,
   * `settlement` y `payable` tienen `beneficiary_type`, así que una fila sin
   * `seller_id` no es «de nadie» — es de un SOCIO o de un PROVEEDOR. Abrirle
   * las comisiones a un vendedor con la regla indulgente le habría abierto
   * todas las comisiones de los tour centers y todas las facturas de los
   * proveedores de una vez.
   */

  it("la venta es indulgente: lo suyo y lo de la empresa", () => {
    expect(esEstricta("order")).toBe(false);
    expect(sellerFilterFor("order", { role: "seller", sellerId: "v1" })).toEqual({
      _or: [{ seller: "v1" }, { seller: null }],
    });
  });

  it("el dinero es estricto: SOLO lo suyo", () => {
    for (const tabla of ["commission", "settlement", "payable"]) {
      expect(esEstricta(tabla), tabla).toBe(true);
      expect(sellerFilterFor(tabla, { role: "seller", sellerId: "v1" }), tabla).toEqual({ seller: "v1" });
    }
  });

  it("las reglas generales de la empresa tampoco son «de nadie»", () => {
    // Una `price_rule` sin vendedor es la tarifa general: con la regla
    // indulgente, el vendedor habría leído el tarifario entero.
    for (const tabla of ["price_rule", "commission_rule"]) {
      expect(sellerFilterFor(tabla, { role: "seller", sellerId: "v1" }), tabla).toEqual({ seller: "v1" });
    }
  });

  it("en una tabla estricta, sin ficha vinculada no se trae NADA", () => {
    // Un filtro imposible, no la ausencia de filtro: no saber quién eres no
    // puede significar «te lo enseño todo».
    expect(sellerFilterFor("commission", { role: "seller", sellerId: null })).toEqual({ seller: NADIE });
  });

  it("y una fila sin vendedor NO se abre en una tabla estricta", () => {
    expect(sellerCanReadRow("commission", { role: "seller", sellerId: "v1" }, null)).toBe(false);
    expect(sellerCanReadRow("settlement", { role: "seller", sellerId: "v1" }, null)).toBe(false);
    // Mientras que en la venta sí, que es de lo que depende el punto de venta.
    expect(sellerCanReadRow("order", { role: "seller", sellerId: "v1" }, null)).toBe(true);
  });

  it("toda tabla estricta está declarada como acotada", () => {
    // Una estricta que no esté en el mapa de ámbito no se acota en absoluto:
    // la declaración de estrictez sería decorativa.
    for (const tabla of SELLER_ESTRICTAS) {
      expect(isSellerScoped(tabla), `${tabla} no está en SELLER_SCOPED`).toBe(true);
    }
  });

  it("y las tablas de la venta NO están entre las estrictas", () => {
    // Meterlas ahí escondería al vendedor su propia venta sin atribuir, un
    // segundo después de hacerla.
    for (const tabla of ["order", "booking", "quote", "lead"]) {
      expect(SELLER_ESTRICTAS.has(tabla), tabla).toBe(false);
    }
  });
});

describe("a quién se acota — el vendedor del tour center", () => {
  const agente = (extra: Record<string, unknown> = {}) => ({
    role: "partner" as const, partnerId: "soc-1", isPartnerMember: true,
    partnerRole: "agent", ...extra,
  });

  it("dentro de la operadora lo dice el rol; dentro de un tour center, la ficha", () => {
    /**
     * LA ASIMETRÍA, Y POR QUÉ NO ES UNA INCOHERENCIA.
     *
     * El rol `seller` declara por sí solo «esta persona está acotada», así que
     * sin ficha se acota a «lo de nadie» —falla cerrado—. En un tour center
     * todas las personas tienen el mismo rol desde 0073: el rol no distingue
     * nada, y la señal pasa a ser la ficha.
     */
    expect(sellerScopeApplies({ role: "seller" }), "interno sin ficha").toBe(true);
    expect(sellerScopeApplies(agente()), "agente sin ficha").toBe(false);
    expect(sellerScopeApplies(agente({ sellerId: "v-1" })), "agente con ficha").toBe(true);
  });

  it("quien administra su tour center no se acota nunca", () => {
    expect(sellerScopeApplies(agente({ partnerRole: "admin", sellerId: "v-1" }))).toBe(false);
  });

  it("y el sello de la venta lo sigue al pie de la letra", () => {
    // Lo que reserva el vendedor de un tour center nace a su nombre: es lo que
    // hace que el filtro combinado signifique algo al día siguiente.
    expect(ventaSelladaPorVendedor({ ...agente({ sellerId: "v-1" }), userId: "u-1" })).toBe(true);
    expect(ventaSelladaPorVendedor({ ...agente(), userId: "u-1" }), "sin ficha").toBe(false);
    expect(
      ventaSelladaPorVendedor({ ...agente({ partnerRole: "admin", sellerId: "v-1" }), userId: "u-1" }),
      "quien administra"
    ).toBe(false);
  });

  it("los motores que fabrican contexto siguen sin sellar", () => {
    // `public-booking-service` y `octo-service` arman `role: "seller"` con
    // `userId: ""` a propósito. Sellar ahí apagaría el motor de atribución web
    // sin ningún error que lo delatara.
    expect(ventaSelladaPorVendedor({ role: "seller", userId: "" })).toBe(false);
  });
});
