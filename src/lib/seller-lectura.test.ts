import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertCanReadTable, readRoleFor, sellerCanReadTable, RESOURCES } from "@/lib/resources";
import { isSellerScoped, esEstricta } from "@/lib/seller-scope";
import { assertGerenciaOVendedorDe } from "@/lib/seller-identity";

/**
 * LA COMPUERTA SE EVALÚA ANTES QUE EL ÁMBITO.
 *
 * Es el error conceptual más caro de este dominio: meter una tabla en el
 * ámbito del vendedor NO la abre, porque `READ_ROLE` rechaza por rango antes de
 * que el filtro por fila llegue a aplicarse. Por eso el vendedor recibía 403 en
 * su propia comisión aunque el filtro estuviera escrito desde hacía semanas.
 *
 * Y abrirla mal es peor que no abrirla. Estas pruebas fijan las dos mitades:
 * qué se abre, y que lo que se abre esté acotado de verdad.
 */

const ROOT = path.resolve(__dirname, "../..");

const vendedor = (sellerId: string | null = "v1") => ({ role: "seller" as const, sellerId });
const gerente = { role: "manager" as const, sellerId: null };
const cajero = { role: "cashier" as const, sellerId: null };

/**
 * NINGUNA TABLA DE DETALLE ES MÁS ABIERTA QUE SU CABECERA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTO
 *
 * `commission` está reservada a gerencia. `commission_adjustment` —la fila que
 * dice cuánto se le descontó a una persona concreta y POR QUÉ, en texto
 * libre— no estaba en `READ_ROLE`, y `assertCanReadTable` deja pasar lo que no
 * tiene entrada. Cualquier usuario del inquilino podía pedir
 * `/api/erp/commission_adjustment` y leer los ajustes de TODA la empresa.
 *
 * Tampoco está en `SELLER_SCOPED`, así que ni siquiera se acotaba por fila: no
 * era «cada uno los suyos», era todo.
 *
 * Y no estaba sola. Medido sobre el catálogo entero, eran tres, las tres con la
 * misma forma: la cabecera con compuerta y el detalle sin ella.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE VIO TAN TARDE
 *
 * Porque la tabla tenía CERO FILAS. Una puerta abierta a una habitación vacía
 * no la abre nadie, y el día que se llena ya nadie se acuerda de la puerta.
 */
describe("el detalle no puede ser más abierto que la cabecera", () => {
  const RANGO: Record<string, number> = {
    seller: 1, cashier: 2, operations: 3, manager: 4, admin: 5,
  };

  it("ningún recurso expande una tabla con compuerta sin tener la suya", () => {
    const flojas: string[] = [];
    for (const def of Object.values(RESOURCES)) {
      const propia = readRoleFor(def.table);
      for (const padre of Object.keys(def.expand ?? {})) {
        const delPadre = readRoleFor(padre);
        if (!delPadre) continue;
        if (!propia || RANGO[propia] < RANGO[delPadre]) {
          flojas.push(
            `${def.table} expande ${padre} (${delPadre}) y su compuerta es ${propia ?? "NINGUNA"}`
          );
        }
      }
    }
    expect(flojas).toEqual([]);
  });

  it("y las tres que lo incumplían siguen cerradas, uno por uno", () => {
    // Nombradas a mano además del barrido: el barrido se cumple también
    // quitando la compuerta de la CABECERA, que sería el arreglo al revés.
    for (const tabla of ["commission_adjustment", "seller_bonus", "invoice_line"]) {
      expect(readRoleFor(tabla), tabla).toBe("manager");
      expect(() => assertCanReadTable(cajero, tabla), `${tabla}: el cajero entra`).toThrow();
      expect(() => assertCanReadTable(vendedor(), tabla), `${tabla}: el vendedor entra`).toThrow();
    }
    // Y sus cabeceras, que es la otra mitad del barrido.
    for (const tabla of ["commission", "settlement", "invoice"]) {
      expect(readRoleFor(tabla), tabla).toBe("manager");
    }
  });

  it("el ajuste no se le abre al vendedor por la puerta del ámbito", () => {
    /**
     * `commission_adjustment` no tiene columna de vendedor —cuelga de la
     * comisión—, así que el ámbito por fila no sabría acotarlo y abrirlo le
     * enseñaría los ajustes de sus compañeros con el motivo escrito.
     *
     * Lo suyo lo ve por donde corresponde: el neto de SU comisión, que sí está
     * acotada, y el motivo en su estado de cuenta, que comprueba que la
     * liquidación es suya antes de servirla.
     */
    expect(sellerCanReadTable("commission_adjustment")).toBe(false);
    expect(isSellerScoped("commission_adjustment")).toBe(false);
  });
});

describe("qué se le abre al vendedor", () => {
  it("su dinero: comisiones, liquidaciones y lo que se le debe", () => {
    for (const tabla of ["commission", "settlement", "payable"]) {
      expect(sellerCanReadTable(tabla), tabla).toBe(true);
      expect(() => assertCanReadTable(vendedor(), tabla), tabla).not.toThrow();
    }
  });

  it("y sigue siendo lectura reservada para los demás rangos bajos", () => {
    // La excepción es del VENDEDOR sobre lo suyo, no una rebaja general: un
    // cajero no tiene ámbito por fila, así que abrirle la tabla se la abriría
    // entera.
    expect(() => assertCanReadTable(cajero, "commission")).toThrow();
  });

  it("NO se le abre el tarifario ni el esquema de comisiones", () => {
    /**
     * Aquí estaba la trampa del plan original: eximir «las tablas que el ámbito
     * ya acota» habría incluido `price_rule` y `commission_rule` —que sí se
     * acotan por vendedor— y cuyo contenido es la tarifa y el esquema de
     * comisiones de toda la empresa y de sus socios.
     */
    for (const tabla of ["price_rule", "commission_rule"]) {
      expect(sellerCanReadTable(tabla), tabla).toBe(false);
      expect(() => assertCanReadTable(vendedor(), tabla), tabla).toThrow();
    }
  });

  it("ni el calendario de cobros, ni la nómina, ni la bitácora", () => {
    for (const tabla of ["payment_schedule", "payroll_line", "audit_log", "receivable"]) {
      expect(() => assertCanReadTable(vendedor(), tabla), tabla).toThrow();
    }
  });

  it("un gerente sigue entrando a todo lo suyo de siempre", () => {
    for (const tabla of ["commission", "settlement", "payable", "price_rule"]) {
      expect(() => assertCanReadTable(gerente, tabla), tabla).not.toThrow();
    }
  });

  it("y una tabla sin rango declarado sigue abierta a cualquiera con sesión", () => {
    expect(readRoleFor("product")).toBeNull();
    expect(() => assertCanReadTable(vendedor(), "product")).not.toThrow();
  });
});

describe("lo que se abre está acotado, y de la forma correcta", () => {
  it("toda tabla abierta al vendedor la acota el ámbito por fila", () => {
    /**
     * Sin esto, añadir una tabla a la lista de exención le daría al vendedor la
     * tabla ENTERA de la empresa. La lista de lo que se abre y la de lo que se
     * acota tienen que moverse juntas, y esta prueba es lo que las ata.
     */
    for (const tabla of ["commission", "settlement", "payable"]) {
      expect(isSellerScoped(tabla), `${tabla} se abre pero NO se acota`).toBe(true);
    }
  });

  it("y las acota en modo ESTRICTO, no «o de nadie»", () => {
    /**
     * Las tres llevan `beneficiary_type`: una fila sin `seller_id` es de un
     * socio o de un proveedor. Con la regla indulgente, abrirle las comisiones
     * a un vendedor le habría abierto todas las de los tour centers y todas las
     * facturas de los proveedores de una vez.
     */
    for (const tabla of ["commission", "settlement", "payable"]) {
      expect(esEstricta(tabla), `${tabla} se abre en modo indulgente`).toBe(true);
    }
  });
});

describe("la regla vive en un solo sitio", () => {
  it("ninguna ruta se guarda su propia copia de la compuerta", () => {
    // Copiada, basta con que una se quede atrás para que un rol lea por un
    // camino lo que el otro le niega — y la que se queda atrás suele ser la
    // exportación, que es la que se lleva TODO.
    for (const rel of [
      "src/app/api/erp/[resource]/route.ts",
      "src/app/api/erp/[resource]/[id]/route.ts",
      "src/app/api/export/[resource]/route.ts",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, rel).toContain("assertCanReadTable(ctx, def.table)");
      expect(src, `${rel} reimplementa la compuerta`).not.toMatch(/readRoleFor\(/);
    }
  });
});

describe("abrir a su dueño algo que era de gerencia", () => {
  /**
   * `assertSellerOwnsRow` no sirve para esto y la diferencia importa: aquel es
   * un ÁMBITO —deja pasar a quien no es vendedor, porque a un gerente no hay
   * nada que acotarle—, así que usarlo para ABRIR el enlace y el embudo habría
   * dejado entrar también a caja y a operaciones, que no tienen ficha y para
   * quienes «no hay nada que acotar» significa «lo ven todo».
   */
  it("gerencia y arriba, sí", () => {
    for (const role of ["manager", "admin", "owner", "superadmin"] as const) {
      expect(() => assertGerenciaOVendedorDe({ role, sellerId: null }, "v1"), role).not.toThrow();
    }
  });

  it("el vendedor, solo lo suyo", () => {
    expect(() => assertGerenciaOVendedorDe({ role: "seller", sellerId: "v1" }, "v1")).not.toThrow();
    expect(() => assertGerenciaOVendedorDe({ role: "seller", sellerId: "v1" }, "v2")).toThrow();
  });

  it("sin ficha vinculada, nada — ni siquiera lo que no tiene dueño", () => {
    // Si `null === null` casara, cualquier cuenta sin vincular abriría todos
    // los enlaces sin vendedor asignado.
    expect(() => assertGerenciaOVendedorDe({ role: "seller", sellerId: null }, null)).toThrow();
  });

  it("caja y operaciones, NO", () => {
    // Están por encima del vendedor y por debajo de gerencia, y no tienen
    // ficha: con un ámbito a secas habrían pasado de largo.
    for (const role of ["cashier", "operations"] as const) {
      expect(() => assertGerenciaOVendedorDe({ role, sellerId: null }, "v1"), role).toThrow();
      expect(() => assertGerenciaOVendedorDe({ role, sellerId: null }, null), role).toThrow();
    }
  });

  it("el socio del portal tampoco", () => {
    expect(() => assertGerenciaOVendedorDe({ role: "partner", sellerId: null }, "v1")).toThrow();
  });
});
