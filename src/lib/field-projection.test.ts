import { describe, it, expect } from "vitest";
import {
  projectRow, projectRows, hiddenFieldsFor, hasHiddenFields, HIDDEN_BELOW,
} from "@/lib/field-projection";
import { RESOURCES } from "@/lib/resources";

/**
 * Se PROYECTA, no se bloquea.
 *
 * `READ_ROLE` decide sobre la tabla entera y con `product` eso no vale: un
 * vendedor sin catálogo no puede vender. Lo que sobra no es la tabla, son dos
 * columnas.
 */

const vendedor = { role: "seller" as const, sellerId: "v1" };
const gerente = { role: "manager" as const, sellerId: null };

describe("qué se recorta", () => {
  it("el coste del catálogo, para quien no manda", () => {
    expect(hiddenFieldsFor("product", "seller")).toEqual(["base_cost"]);
    expect(hiddenFieldsFor("product", "manager")).toEqual([]);
  });

  it("las condiciones del equipo", () => {
    expect(hiddenFieldsFor("seller", "seller").sort())
      .toEqual(["commission_pct", "max_discount_pct", "monthly_goal"]);
  });

  it("la modalidad esconde `cost`, que NO se llama `base_cost`", () => {
    /**
     * Esta prueba nació de un fallo mío: declaré `product_modality.base_cost`,
     * que no existe —la columna se llama `cost`—, y el recorte no habría
     * recortado nada sin dar un solo error. La comprobación de abajo contra el
     * recurso real es la que lo cazó.
     */
    expect(hiddenFieldsFor("product_modality", "seller")).toEqual(["cost"]);
  });

  it("una tabla sin nada que esconder no se toca", () => {
    expect(hasHiddenFields("booking")).toBe(false);
    expect(hiddenFieldsFor("booking", "seller")).toEqual([]);
  });

  it("todo campo recortado existe en su recurso", () => {
    // Un campo mal escrito aquí no rompe nada: simplemente no se recorta, y la
    // promesa de que el coste no viaja sería mentira.
    for (const [table, campos] of Object.entries(HIDDEN_BELOW)) {
      const resource = Object.values(RESOURCES).find((r) => r.table === table);
      expect(resource, `${table} no existe en RESOURCES`).toBeTruthy();
      for (const campo of Object.keys(campos)) {
        const declarado =
          resource!.writable.includes(campo) || (resource!.numeric || []).includes(campo);
        expect(declarado, `${table}.${campo} no existe en el recurso`).toBe(true);
      }
    }
  });
});

describe("el recorte", () => {
  it("BORRA la clave, no la pone a cero", () => {
    /**
     * Un coste en cero no es «no puedes verlo»: es «esta excursión no cuesta
     * nada», y el margen que se dibuja a partir de ahí sale del 100 %. La
     * ausencia se distingue; el cero miente.
     */
    const fila = projectRow("product", vendedor, { _id: "p1", name: "Saona", base_cost: 30, base_price: 80 });
    expect("base_cost" in fila).toBe(false);
    expect(fila).toEqual({ _id: "p1", name: "Saona", base_price: 80 });
  });

  it("un gerente lo recibe entero", () => {
    const fila = projectRow("product", gerente, { _id: "p1", base_cost: 30 });
    expect(fila.base_cost).toBe(30);
  });

  it("baja por las relaciones expandidas", () => {
    /**
     * Recortar solo la fila de arriba habría sido teatro: la reserva expande su
     * producto con el coste dentro, y la orden expande su vendedor con la
     * comisión dentro.
     */
    const reserva = projectRow("booking", vendedor, {
      _id: "b1",
      product: { _id: "p1", name: "Saona", base_cost: 30 },
      seller: { _id: "v2", first_name: "Ana", commission_pct: 8 },
    }) as any;
    expect("base_cost" in reserva.product).toBe(false);
    expect("commission_pct" in reserva.seller).toBe(false);
    expect(reserva.product.name).toBe("Saona");
  });

  it("y por las listas de hijos", () => {
    const orden = projectRow("order", vendedor, {
      _id: "o1",
      booking: [{ _id: "b1", product: { _id: "p1", base_cost: 30 } }],
    }) as any;
    expect("base_cost" in orden.booking[0].product).toBe(false);
  });

  it("la propia ficha del vendedor NO se le recorta", () => {
    // Su apartado existe justamente para enseñarle su comisión y su meta.
    const propia = projectRow("seller", vendedor, { _id: "v1", commission_pct: 6, monthly_goal: 20000 });
    expect(propia.commission_pct).toBe(6);
    expect(propia.monthly_goal).toBe(20000);

    const ajena = projectRow("seller", vendedor, { _id: "v2", commission_pct: 8 });
    expect("commission_pct" in ajena).toBe(false);
  });

  it("no toca la fila cuando no hay nada que quitar", () => {
    // Devolver la MISMA referencia evita copiar cada fila de cada listado.
    const fila = { _id: "b1", notes: "hola" };
    expect(projectRow("booking", vendedor, fila)).toBe(fila);
  });

  it("recorta un listado entero", () => {
    const filas = projectRows("product", vendedor, [
      { _id: "p1", base_cost: 10 }, { _id: "p2", base_cost: 20 },
    ]);
    expect(filas.every((f) => !("base_cost" in f))).toBe(true);
  });
});
