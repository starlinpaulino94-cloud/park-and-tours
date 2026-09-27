import { describe, it, expect } from "vitest";
import { fakeDb, paxTotalsDeLaBase } from "@/test/fake-tenant";

/**
 * EL DOBLE, PROBADO.
 *
 * Un doble sin pruebas es una segunda implementación sin pruebas, y cuando se
 * desvía de la base de verdad no falla: hace pasar en verde justo la prueba que
 * tenía que ponerse roja.
 *
 * Pasó exactamente eso en esta ola. `_offset` se ignoraba, así que una lectura
 * que pidiera la página 2 recibía otra vez la página 1 — y la prueba de un
 * barrido que NO avanza su cursor, que es el fallo que se estaba arreglando,
 * habría salido en verde. Y `_sort` se quedaba con la primera clave, tirando el
 * desempate por identidad que es lo único que impide que dos páginas se solapen.
 *
 * Estas pruebas fijan las dos cosas contra lo que hace `applyQuery` con la base
 * real: `_limit`/`_offset` se traducen a `.range(offset, offset + limit - 1)`, y
 * cada clave de `_sort` a un `.order()` encadenado.
 */

const ORG = "org-1";

/** Cien filas con una fecha repetida cada diez: el empate es a propósito. */
function cien() {
  return fakeDb({
    booking: Array.from({ length: 100 }, (_, i) => ({
      _id: `b${String(i).padStart(3, "0")}`,
      organization_id: ORG,
      travel_date: `2026-09-${String(1 + Math.floor(i / 10)).padStart(2, "0")}`,
    })),
  });
}

describe("_offset es una ventana, no un adorno", () => {
  it("salta las filas pedidas", async () => {
    const db = cien();
    const p1 = await db.tenantQuery(ORG, "booking", { _limit: 10, _offset: 0, _sort: { _id: "asc" } });
    const p2 = await db.tenantQuery(ORG, "booking", { _limit: 10, _offset: 10, _sort: { _id: "asc" } });

    expect(p1.map((f) => f._id)).toEqual(["b000", "b001", "b002", "b003", "b004", "b005", "b006", "b007", "b008", "b009"]);
    // Si `_offset` se ignorara, esto sería otra vez la primera página — y con
    // eso un bucle de paginación daría vueltas para siempre sobre las mismas
    // diez filas, o su prueba pasaría creyendo que avanza.
    expect(p2.map((f) => f._id)).toEqual(["b010", "b011", "b012", "b013", "b014", "b015", "b016", "b017", "b018", "b019"]);
  });

  it("paginar de diez en diez recorre las cien sin repetir ni saltarse ninguna", async () => {
    const db = cien();
    const vistas: string[] = [];
    for (let salto = 0; salto < 200; salto += 10) {
      const p = await db.tenantQuery(ORG, "booking", { _limit: 10, _offset: salto, _sort: { _id: "asc" } });
      if (p.length === 0) break;
      vistas.push(...p.map((f) => String(f._id)));
    }
    expect(vistas).toHaveLength(100);
    expect(new Set(vistas).size).toBe(100);
  });

  it("un salto más allá del final devuelve vacío, que es la señal de final", async () => {
    const db = cien();
    const p = await db.tenantQuery(ORG, "booking", { _limit: 10, _offset: 500 });
    expect(p).toEqual([]);
  });
});

describe("_sort ordena por TODAS las claves", () => {
  it("el desempate por identidad hace el orden total", async () => {
    const db = cien();
    const todas = await db.tenantQuery(ORG, "booking", {
      _limit: 100, _sort: { travel_date: "asc", _id: "asc" },
    });

    // Diez filas comparten cada fecha: sin el desempate, el orden entre ellas
    // es el que salga, y dos páginas consecutivas pueden repetir una y saltarse
    // otra sin que nada lo avise.
    expect(todas.slice(0, 10).map((f) => f._id))
      .toEqual(["b000", "b001", "b002", "b003", "b004", "b005", "b006", "b007", "b008", "b009"]);
  });

  it("la primera clave manda y la segunda solo deshace empates", async () => {
    const db = cien();
    const todas = await db.tenantQuery(ORG, "booking", {
      _limit: 100, _sort: { travel_date: "desc", _id: "asc" },
    });
    expect(todas[0].travel_date).toBe("2026-09-10");
    expect(todas[0]._id).toBe("b090");
    expect(todas[99].travel_date).toBe("2026-09-01");
    expect(todas[99]._id).toBe("b009");
  });

  it("paginar con orden total no solapa páginas ni deja huecos", async () => {
    const db = cien();
    const vistas: string[] = [];
    for (let salto = 0; salto < 100; salto += 7) {
      const p = await db.tenantQuery(ORG, "booking", {
        _limit: 7, _offset: salto, _sort: { travel_date: "asc", _id: "asc" },
      });
      vistas.push(...p.map((f) => String(f._id)));
    }
    expect(new Set(vistas).size).toBe(100);
  });
});


/**
 * EL RECUENTO DE PASAJEROS DEL DOBLE (0094).
 *
 * Este ayudante no es un adorno: reproduce la función que decide si cabe una
 * venta. Si se desviara de ella, media docena de ficheros de prueba estarían
 * comprobando la guarda contra la sobreventa con una suma distinta de la que
 * corre en producción — y en verde.
 */
describe("paxTotalsDeLaBase", () => {
  const ORG = "org-1";
  const base = () => fakeDb({
    departure: [{ _id: "sal-1", organization_id: ORG, capacity: 100 }],
    booking: [
      { _id: "b1", organization_id: ORG, departure: "sal-1", status: "paid", pax_total: 4 },
      { _id: "b2", organization_id: ORG, departure: "sal-1", status: "pending", pax_total: 3 },
      { _id: "b3", organization_id: ORG, departure: "sal-1", status: "cancelled", pax_total: 9 },
    ],
  });
  const args = (salida: string, org = ORG) => ({
    p_org: org, p_departure: salida,
    p_confirmed: ["paid", "confirmed"], p_pending: ["pending"],
  });

  it("suma por las listas que le llegan, sin saber qué significan", () => {
    const { data } = paxTotalsDeLaBase(base())(args("sal-1")) as {
      data: { booked: number; pending: number };
    };
    expect(data.booked).toBe(4);
    expect(data.pending).toBe(3);
  });

  it("lo que no está en ninguna de las dos listas no cuenta", () => {
    const { data } = paxTotalsDeLaBase(base())(args("sal-1")) as {
      data: { booked: number; pending: number };
    };
    // La cancelada de 9 plazas no ocupa asiento.
    expect(data.booked + data.pending).toBe(7);
  });

  it("una salida que no existe devuelve found:false, NO ceros", () => {
    /**
     * Ceros querrían decir «la salida está vacía, caben todos» sobre algo que
     * no está — y eso es una venta autorizada contra una salida inventada. Es
     * la misma decisión que toma la función de verdad, y por eso se prueba
     * aquí: si el doble perdonara este caso, la prueba de la aplicación que lo
     * comprueba saldría en verde con el código roto.
     */
    const { data } = paxTotalsDeLaBase(base())(args("no-existe")) as {
      data: { found: boolean };
    };
    expect(data.found).toBe(false);
  });

  it("la salida de otra empresa tampoco se encuentra", () => {
    const { data } = paxTotalsDeLaBase(base())(args("sal-1", "org-2")) as {
      data: { found: boolean };
    };
    expect(data.found).toBe(false);
  });
});
