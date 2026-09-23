import { describe, it, expect } from "vitest";
import { supplierScopeFor } from "@/lib/resources";
import { scopeFiltersFor, assertRowInScope } from "@/lib/row-scope";
import { projectRow, camposFueraDeLaListaBlanca, VISIBLE_AL_PROVEEDOR } from "@/lib/field-projection";

/**
 * EL ÁMBITO DEL PROVEEDOR, POR LO QUE DEVUELVE.
 *
 * Es el actor con más datos personales de terceros al alcance: una ruta de
 * recogida es una lista de clientes con su hotel, su habitación y su teléfono.
 * Así que aquí no se comprueba que se llame a nada — se comprueba qué sale.
 */

const proveedor = { role: "supplier" as const, supplierId: "prov-1" };
const otroProveedor = { role: "supplier" as const, supplierId: "prov-2" };
const interno = { role: "manager" as const };

describe("a qué filas llega un proveedor", () => {
  it("a las suyas, por COLUMNA", () => {
    /**
     * Por columna y no por unión: el vínculo existía de lado —el recurso apunta
     * al vehículo, y es él quien cuelga del proveedor— y la capa de consulta no
     * sabe filtrar por columna de una tabla unida. Un filtro sobre una columna
     * que no existe NO da error: devuelve la empresa entera.
     */
    expect(scopeFiltersFor("pickup_route", proveedor)).toEqual([{ supplier: "prov-1" }]);
    expect(scopeFiltersFor("departure_resource", proveedor)).toEqual([{ supplier: "prov-1" }]);
  });

  it("y a su propia ficha", () => {
    expect(supplierScopeFor("supplier", "prov-1")).toEqual({ kind: "own", field: "_id", supplierId: "prov-1" });
  });

  it("DENIEGA POR DEFECTO: una tabla nueva no se abre sola", () => {
    // La lista es corta a propósito. Lo que nadie declaró, no se ve.
    for (const tabla of ["booking", "customer", "pickup", "order", "commission", "hotel"]) {
      expect(() => scopeFiltersFor(tabla, proveedor), tabla).toThrow(/No tienes acceso/);
    }
  });

  it("sin ficha de proveedor NO se abre nada", () => {
    // Fallar hacia el silencio, igual que el resto del ámbito: nulo no es
    // «cualquier proveedor», es «no es un proveedor».
    expect(() => scopeFiltersFor("pickup_route", { role: "supplier" as const }))
      .toThrow(/No tienes acceso/);
  });

  it("el detalle no se abre aunque la lista esté acotada", () => {
    /**
     * `tenantFindOne` solo comprueba la empresa, así que sin esto acotar la
     * lista sería cosmético: basta con pedir la ruta de otro por su
     * identificador, que aparece en cualquier informe.
     */
    expect(() => assertRowInScope("pickup_route", proveedor, { supplier: "prov-2" }))
      .toThrow(/fuera de tu ámbito/);
    expect(() => assertRowInScope("pickup_route", proveedor, { supplier: "prov-1" })).not.toThrow();
  });

  it("y el interno lo sigue viendo todo", () => {
    expect(scopeFiltersFor("pickup_route", interno)).toEqual([]);
    expect(() => assertRowInScope("pickup_route", interno, { supplier: "prov-2" })).not.toThrow();
  });
});

describe("qué campos ve de esas filas", () => {
  it("LISTA BLANCA: lo que nadie declaró NO sale", () => {
    /**
     * Al revés que con el socio, al que se le esconden campos concretos. Con
     * lista negra, cada columna nueva sale por omisión — y una columna nueva en
     * una ruta de recogida es un teléfono de cliente en la pantalla de un
     * transportista.
     */
    const fila = {
      _id: "r-1", name: "Bávaro AM", start_time: "07:30", pax_total: 12,
      notes: "el chofer llegó tarde dos veces",
      telefono_del_cliente: "+1 809 555 0000",
    };
    const visto = projectRow("pickup_route", proveedor, fila);
    expect(visto).toHaveProperty("name");
    expect(visto).toHaveProperty("pax_total");
    expect(visto, "las notas internas no son suyas").not.toHaveProperty("notes");
    expect(visto, "una columna que nadie declaró no puede salir")
      .not.toHaveProperty("telefono_del_cliente");
  });

  it("una tabla SIN lista declarada no devuelve nada", () => {
    /**
     * Es la parte que hace que falle por omisión. Si el ámbito abriera una
     * tabla y nadie declarara sus campos, el proveedor recibe filas vacías y se
     * queja — en vez de recibirlas enteras y que no se entere nadie.
     */
    expect(camposFueraDeLaListaBlanca("una_tabla_nueva", { a: 1, b: 2 })).toEqual(["a", "b"]);
    expect(projectRow("una_tabla_nueva", proveedor, { a: 1, b: 2 })).toEqual({});
  });

  it("al interno no se le recorta por esta lista", () => {
    const fila = { _id: "r-1", name: "Bávaro AM", notes: "nota interna" };
    expect(projectRow("pickup_route", interno, fila)).toHaveProperty("notes");
  });

  it("el coste de su línea NO está en la lista", () => {
    // Lo que la operadora le paga se ve en su estado de cuenta, con su detalle
    // y su forma de discutirlo, no colgando de cada fila.
    expect(VISIBLE_AL_PROVEEDOR.departure_resource).not.toContain("cost");
    expect(VISIBLE_AL_PROVEEDOR.departure_resource).not.toContain("currency");
    // Ni el saldo en su ficha.
    expect(VISIBLE_AL_PROVEEDOR.supplier).not.toContain("balance");
    expect(VISIBLE_AL_PROVEEDOR.supplier).not.toContain("notes");
  });

  it("y otro proveedor no comparte ámbito con el primero", () => {
    expect(scopeFiltersFor("pickup_route", otroProveedor)).toEqual([{ supplier: "prov-2" }]);
  });
});
