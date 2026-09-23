import { describe, it, expect } from "vitest";
import {
  projectRow, projectRows, hiddenFieldsFor, hasHiddenFields, HIDDEN_BELOW,
  OCULTO_AL_SOCIO, camposRecortadosPara, ES_PROPIA, type ProjectionCtx,
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
    /**
     * Un campo mal escrito aquí no rompe nada: simplemente no se recorta, y la
     * promesa de que el coste no viaja sería mentira. Ya cazó una vez a
     * `product_modality.base_cost`, que en realidad se llama `cost`.
     *
     * Los recursos declaran los campos que se ESCRIBEN. Un par de columnas que
     * hay que recortar no se escriben nunca —llegan a la respuesta porque la
     * fila cruda las arrastra—, y van en la lista de abajo con su motivo en vez
     * de ensanchar la regla hasta que no compruebe nada.
     */
    const NO_DECLARADOS: Record<string, string> = {
      "partner.metadata":
        "columna cruda de organizations que la ficha arrastra al reconstruirse; es donde vive `notes`",
    };
    const declarados = (table: string, campos: string[]) => {
      const resource = Object.values(RESOURCES).find((r) => r.table === table);
      expect(resource, `${table} no existe en RESOURCES`).toBeTruthy();
      for (const campo of campos) {
        if (NO_DECLARADOS[`${table}.${campo}`]) continue;
        const declarado =
          resource!.writable.includes(campo) || (resource!.numeric || []).includes(campo);
        expect(declarado, `${table}.${campo} no existe en el recurso`).toBe(true);
      }
    };
    for (const [table, campos] of Object.entries(HIDDEN_BELOW)) declarados(table, Object.keys(campos));
    for (const [table, campos] of Object.entries(OCULTO_AL_SOCIO)) declarados(table, campos);
  });

  it("y los dos ejes se suman: el socio pierde lo suyo Y lo de su rango", () => {
    /**
     * `camposRecortadosPara` es el único sitio donde se juntan. Si devolviera
     * solo uno de los dos, la guarda de más arriba —que mira cada lista por
     * separado— seguiría pasando y el recorte real sería la mitad.
     */
    const socio = { role: "partner" as const, partnerId: "soc-1", isPartnerMember: true };
    expect(camposRecortadosPara("partner", socio).sort()).toEqual(["metadata", "notes"]);
    expect(camposRecortadosPara("product", socio)).toContain("base_cost");
    // Y al personal interno no le quita lo del socio.
    expect(camposRecortadosPara("partner", { role: "operations" as const })).toEqual([]);
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

describe("la ficha del socio no viaja entera a la empresa asociada", () => {
  const socio: ProjectionCtx = { role: "partner", partnerId: "soc-1", isPartnerMember: true };
  const interno: ProjectionCtx = { role: "operations" };

  it("el socio no ve las notas que la operadora escribió sobre él", () => {
    const ficha = projectRow("partner", socio, {
      _id: "soc-1", name: "Caribe Tour Center",
      notes: "Paga tarde. Revisar crédito antes de ampliar.",
      credit_limit: 5000, commercial_terms: "20% sobre neto",
    });
    expect(ficha.notes).toBeUndefined();
    // Y sigue viendo lo suyo: el crédito y las condiciones que ha firmado son
    // la relación, no una nota sobre él.
    expect(ficha.credit_limit).toBe(5000);
    expect(ficha.commercial_terms).toBe("20% sobre neto");
  });

  it("y tampoco a través de metadata, que es donde vive el texto", () => {
    /**
     * LA MITAD QUE CONVIERTE EL RECORTE EN TEATRO SI SE OLVIDA.
     *
     * La ficha se reconstruye desde `organizations`, y esa fila arrastra su
     * `metadata` entera. Borrar `notes` de arriba dejando el saco debajo deja
     * el mismo texto en la respuesta, una clave más adentro.
     */
    const ficha = projectRow("partner", socio, {
      _id: "soc-1", notes: "Paga tarde",
      metadata: { notes: "Paga tarde", commercial_name: "Caribe" },
    });
    expect(ficha.metadata).toBeUndefined();
    expect(JSON.stringify(ficha)).not.toMatch(/Paga tarde/);
  });

  it("el recorte NO se exime por ser su propia fila", () => {
    /**
     * El vendedor sí se exime de `HIDDEN_BELOW` en su ficha —su comisión es
     * suya—, y por analogía sería fácil eximir aquí. Sería exactamente al
     * revés: la ficha propia del socio es donde están las notas ajenas.
     *
     * La exención vive en `ES_PROPIA`, así que la regresión concreta es añadir
     * ahí una entrada para `partner`. Se afirma sobre eso y no solo sobre el
     * resultado: hoy el recorte sale bien PORQUE esa entrada no existe, y una
     * comprobación que solo mire la salida pasaría el día que se añada.
     */
    expect(projectRow("partner", socio, { _id: "soc-1", notes: "x" }).notes).toBeUndefined();
    expect(
      Object.keys(ES_PROPIA),
      "el socio no puede eximirse de su propio recorte"
    ).not.toContain("partner");
  });

  it("el personal interno de menos rango que un gerente SÍ las ve", () => {
    /**
     * Por eso es un eje aparte y no un umbral más alto: con `HIDDEN_BELOW` la
     * única forma de esconderlas al socio —rango 10— sería pedir un rango que
     * también dejaría fuera a operaciones y a caja, que son quienes trabajan
     * con esas notas todos los días.
     */
    const ficha = projectRow("partner", interno, { _id: "soc-1", notes: "Paga tarde" });
    expect(ficha.notes).toBe("Paga tarde");
  });

  it("y el recorte baja a la ficha expandida dentro de una reserva", () => {
    // Es el camino por el que el socio recibe la ficha en la práctica: su
    // pantalla de reservas expande el socio de cada una.
    const reserva = projectRow("booking", socio, {
      _id: "b1",
      partner: { _id: "soc-1", name: "Caribe", notes: "Paga tarde", metadata: { notes: "Paga tarde" } },
    });
    const dentro = reserva.partner as Record<string, unknown>;
    expect(dentro.notes).toBeUndefined();
    expect(dentro.metadata).toBeUndefined();
    expect(dentro.name).toBe("Caribe");
  });

  it("y a la que viene dentro de una orden", () => {
    const orden = projectRow("order", socio, {
      _id: "o1",
      partner: { _id: "soc-1", notes: "Paga tarde" },
    });
    expect((orden.partner as Record<string, unknown>).notes).toBeUndefined();
  });
});

describe("el equipo del tour center: su comisión sí, la de la operadora no", () => {
  const adminDeSocio: ProjectionCtx = {
    role: "partner", partnerId: "soc-1", isPartnerMember: true, partnerRole: "admin",
  };
  const agenteDeSocio: ProjectionCtx = {
    role: "partner", partnerId: "soc-1", isPartnerMember: true, partnerRole: "agent",
  };

  it("quien administra el tour center ve las condiciones de SU gente", () => {
    /**
     * El recorte por rango se las escondía: el rango de un socio es el más
     * bajo que hay. Y `/portal/vendedores` existe justamente para enseñar la
     * comisión por persona — una pantalla que promete eso y devuelve huecos no
     * es una pantalla acotada, es una rota.
     */
    const ficha = projectRow("seller", adminDeSocio, {
      _id: "v-1", partner: "soc-1", first_name: "Ana", commission_pct: 8, monthly_goal: 12000,
    });
    expect(ficha.commission_pct).toBe(8);
    expect(ficha.monthly_goal).toBe(12000);
  });

  it("el agente NO ve las de sus compañeros", () => {
    const ficha = projectRow("seller", agenteDeSocio, {
      _id: "v-2", partner: "soc-1", commission_pct: 8,
    });
    expect(ficha.commission_pct).toBeUndefined();
  });

  it("y la exención no alcanza a una ficha de otro socio ni a una interna", () => {
    /**
     * Hoy no le llega ninguna —`seller` está en su ámbito como propia por
     * socio— pero el recorte no puede APOYARSE en eso: son dos capas, y la
     * segunda tiene que sostenerse sola el día que una ficha llegue por una
     * expansión que nadie revisó.
     */
    expect(projectRow("seller", adminDeSocio, { _id: "v-3", partner: "soc-2", commission_pct: 8 })
      .commission_pct).toBeUndefined();
    expect(projectRow("seller", adminDeSocio, { _id: "v-4", partner: null, commission_pct: 8 })
      .commission_pct).toBeUndefined();
  });

  it("el vendedor interno sigue viendo la suya y no la de al lado", () => {
    const vendedorInterno: ProjectionCtx = { role: "seller", sellerId: "v-1" };
    expect(projectRow("seller", vendedorInterno, { _id: "v-1", commission_pct: 6 }).commission_pct).toBe(6);
    expect(projectRow("seller", vendedorInterno, { _id: "v-2", commission_pct: 6 }).commission_pct).toBeUndefined();
  });
});
