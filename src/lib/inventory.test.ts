import { describe, it, expect, vi, beforeEach } from "vitest";
import { reorderThreshold, isLowStock } from "@/lib/inventory-rules";

/**
 * EL MOTOR QUE ESCRIBE, PROBADO POR PRIMERA VEZ.
 *
 * Este fichero tenía cinco casos y los cinco eran de las dos funciones puras de
 * arriba. `postMovement` —las doscientas líneas que mueven el saldo, bloquean el
 * negativo, recalculan el costo promedio, escriben las dos patas de una
 * transferencia y disparan el aviso de reposición— **no tenía ninguno**.
 *
 * No se notaba porque la pantalla del kardex no lo llamaba: tenía un formulario
 * genérico que escribía la fila de `stock_movement` a mano y dejaba el saldo sin
 * tocar. Todo lo que se prueba aquí abajo es exactamente lo que ese formulario se
 * saltaba.
 */

const tenantQuery = vi.fn();
const tenantFindOne = vi.fn();
const tenantCreate = vi.fn();
const tenantUpdate = vi.fn();
const notify = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantFindOne: (...a: unknown[]) => tenantFindOne(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});
vi.mock("@/lib/notify-service", () => ({ notify: (...a: unknown[]) => notify(...a) }));

const { postMovement } = await import("@/lib/inventory");

const ORG = "org-1";
const ITEM = "item-1";
const ORIGEN = "w-origen";
const DESTINO = "w-destino";

/**
 * Monta el mundo: un saldo por almacén, los almacenes y el artículo.
 *
 * Las lecturas se distinguen por TABLA, no por orden de llamada: reordenar el
 * motor no debe romper las pruebas por el motivo equivocado.
 */
function montar({
  saldos = { [ORIGEN]: { quantity: 50, reserved: 0, avg_cost: 10 } } as Record<string, any>,
  negativo = false,
  articulo = { name: "Cerveza", reorder_point: 10 } as any,
} = {}) {
  for (const f of [tenantQuery, tenantFindOne, tenantCreate, tenantUpdate, notify]) f.mockReset();

  tenantQuery.mockImplementation(async (_o: string, tabla: string, q: any) => {
    if (tabla !== "stock_level") return [];
    const w = q?._filter?.warehouse;
    const s = saldos[w];
    return s ? [{ _id: `lvl-${w}`, ...s }] : [];
  });
  tenantFindOne.mockImplementation(async (_o: string, tabla: string, id: string) => {
    if (tabla === "warehouse") return { _id: id, name: `Almacén ${id}`, allows_negative: negativo };
    if (tabla === "inventory_item") return articulo;
    return {};
  });
  let n = 0;
  tenantCreate.mockImplementation(async (_o: string, tabla: string, row: any) => {
    if (tabla === "stock_level") return { _id: `lvl-${row.warehouse}`, ...row };
    return { _id: `mov-${++n}` };
  });
  tenantUpdate.mockResolvedValue({});
  notify.mockResolvedValue(undefined);
}

/** El movimiento escrito, por tabla. */
const movimientos = () => tenantCreate.mock.calls.filter((c) => c[1] === "stock_movement").map((c) => c[2]);
/** Los saldos reescritos: [idDelSaldo, parche]. */
const saldosEscritos = () => tenantUpdate.mock.calls.filter((c) => c[1] === "stock_level").map((c) => [c[2], c[3]] as const);

const BASE = { warehouse: ORIGEN, inventory_item: ITEM };

describe("un movimiento mueve el saldo, no solo el kardex", () => {
  beforeEach(() => montar());

  /**
   * LA PROPIEDAD QUE EL FORMULARIO VIEJO ROMPÍA.
   *
   * Escribir la fila de `stock_movement` es la mitad del trabajo. Si el saldo no
   * se reescribe, el kardex dice «merma de 10» y la existencia sigue en 50, y la
   * diferencia no aparece hasta el conteo físico.
   */
  it("escribe el movimiento Y reescribe el saldo", async () => {
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 10 });
    expect(movimientos()).toHaveLength(1);
    expect(saldosEscritos()).toHaveLength(1);
    const [id, parche] = saldosEscritos()[0];
    expect(id).toBe(`lvl-${ORIGEN}`);
    expect(parche.quantity).toBe(40);
  });

  it("el saldo del movimiento es el saldo resultante, no lo que le pasen", async () => {
    // `balance_after` era escribible por el CRUD genérico: se podía teclear un
    // saldo que no se correspondía con nada.
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 10, balance_after: 999 } as never);
    expect(movimientos()[0].balance_after).toBe(40);
  });

  it("una entrada suma y una merma resta", async () => {
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 5 });
    expect(saldosEscritos()[0][1].quantity).toBe(55);
    montar();
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 5 });
    expect(saldosEscritos()[0][1].quantity).toBe(45);
  });

  it("un conteo FIJA el saldo, no se le suma", async () => {
    // Es la diferencia entre «conté 8» y «entraron 8», y la confunde cualquiera.
    await postMovement(ORG, { ...BASE, movement_type: "count", quantity: 8 });
    expect(saldosEscritos()[0][1].quantity).toBe(8);
    expect(saldosEscritos()[0][1].last_counted_at, "un conteo tiene que dejar su fecha").toBeTruthy();
  });

  it("un ajuste lleva el signo de quien lo manda", async () => {
    await postMovement(ORG, { ...BASE, movement_type: "adjustment", quantity: -7 });
    expect(saldosEscritos()[0][1].quantity).toBe(43);
    montar();
    await postMovement(ORG, { ...BASE, movement_type: "adjustment", quantity: 7 });
    expect(saldosEscritos()[0][1].quantity).toBe(57);
  });

  it("lo disponible descuenta lo reservado", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 8, avg_cost: 0 } } });
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 10 });
    expect(saldosEscritos()[0][1].available, "disponible = existencia − reservado").toBe(52);
  });

  it("el primer movimiento de un par (almacén, artículo) crea su saldo en cero", async () => {
    montar({ saldos: {} });
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 3 });
    const creado = tenantCreate.mock.calls.find((c) => c[1] === "stock_level")![2];
    expect(creado).toMatchObject({ quantity: 0, reserved: 0, available: 0, avg_cost: 0 });
    expect(saldosEscritos()[0][1].quantity).toBe(3);
  });
});

describe("lo que no se puede mover", () => {
  it("una salida que dejaría el saldo en negativo se rechaza, y no escribe nada", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 3, reserved: 0 } } });
    await expect(postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 10 }))
      .rejects.toMatchObject({ status: 409 });
    expect(movimientos(), "ni el kardex ni el saldo pueden quedar tocados").toEqual([]);
    expect(saldosEscritos()).toEqual([]);
  });

  it("…salvo que el almacén admita negativos", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 3, reserved: 0 } }, negativo: true });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 10 });
    expect(saldosEscritos()[0][1].quantity).toBe(-7);
  });

  /**
   * `allows_negative` es BOOLEANO en la base (0013). Antes se comparaba con la
   * cadena "yes", así que un almacén configurado para admitir negativos igual
   * bloqueaba la salida. Esta prueba fija el tipo, no el valor.
   */
  it("«yes» no es true: el permiso de negativos es booleano", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 3, reserved: 0 } } });
    tenantFindOne.mockImplementation(async (_o: string, tabla: string) =>
      tabla === "warehouse" ? { allows_negative: "yes" } : { name: "X" });
    await expect(postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 10 }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("cantidad cero, sin almacén o sin artículo: 400 y sin escribir", async () => {
    for (const malo of [
      { ...BASE, movement_type: "receipt" as const, quantity: 0 },
      { warehouse: "", inventory_item: ITEM, movement_type: "receipt" as const, quantity: 1 },
      { warehouse: ORIGEN, inventory_item: "", movement_type: "receipt" as const, quantity: 1 },
    ]) {
      montar();
      await expect(postMovement(ORG, malo)).rejects.toMatchObject({ status: 400 });
      expect(movimientos()).toEqual([]);
    }
  });

  it("un tipo de movimiento inventado no pasa", async () => {
    montar();
    await expect(postMovement(ORG, { ...BASE, movement_type: "regalo" as never, quantity: 1 }))
      .rejects.toThrow(/inválido/);
    expect(movimientos()).toEqual([]);
  });
});

describe("una transferencia mueve los dos almacenes o ninguno", () => {
  it("escribe las dos patas, cada una en su almacén", async () => {
    montar({ saldos: {
      [ORIGEN]: { quantity: 50, reserved: 0 },
      [DESTINO]: { quantity: 4, reserved: 0 },
    } });
    const r = await postMovement(ORG, {
      ...BASE, movement_type: "transfer_out", quantity: 10, to_warehouse: DESTINO,
    });
    expect(r.legs).toHaveLength(2);

    const movs = movimientos();
    expect(movs.map((m) => m.movement_type)).toEqual(["transfer_out", "transfer_in"]);
    expect(movs[0].warehouse).toBe(ORIGEN);
    expect(movs[1].warehouse).toBe(DESTINO);
    // La misma cantidad en las dos: si no, la transferencia crea o destruye
    // mercancía por el camino.
    expect(movs[0].quantity).toBe(10);
    expect(movs[1].quantity).toBe(10);

    const porSaldo = Object.fromEntries(saldosEscritos().map(([id, p]) => [id, p.quantity]));
    expect(porSaldo[`lvl-${ORIGEN}`]).toBe(40);
    expect(porSaldo[`lvl-${DESTINO}`]).toBe(14);
  });

  it("sin destino, o al mismo almacén, no se mueve nada", async () => {
    montar();
    await expect(postMovement(ORG, { ...BASE, movement_type: "transfer_out", quantity: 5 }))
      .rejects.toMatchObject({ status: 400 });
    expect(movimientos()).toEqual([]);

    montar();
    await expect(postMovement(ORG, {
      ...BASE, movement_type: "transfer_out", quantity: 5, to_warehouse: ORIGEN,
    })).rejects.toMatchObject({ status: 400 });
    expect(movimientos()).toEqual([]);
  });

  it("la pata de entrada consulta el permiso de negativos de SU almacén", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 0 }, [DESTINO]: { quantity: 0, reserved: 0 } } });
    await postMovement(ORG, { ...BASE, movement_type: "transfer_out", quantity: 10, to_warehouse: DESTINO });
    const almacenesLeidos = tenantFindOne.mock.calls.filter((c) => c[1] === "warehouse").map((c) => c[2]);
    expect(almacenesLeidos, "el destino tiene sus propias reglas").toContain(DESTINO);
  });
});

describe("el costo promedio ponderado", () => {
  it("solo lo mueven las entradas que traen costo", async () => {
    // 50 a 10 + 10 a 20  →  (50·10 + 10·20) / 60 = 11,6667
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 0, avg_cost: 10 } } });
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 10, unit_cost: 20 });
    expect(saldosEscritos()[0][1].avg_cost).toBeCloseTo(11.6667, 4);
  });

  it("una entrada sin costo no lo toca", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 0, avg_cost: 10 } } });
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 10 });
    expect(saldosEscritos()[0][1].avg_cost).toBe(10);
  });

  it("una salida no lo toca, aunque le pasen costo", async () => {
    // Vender caro no encarece lo que queda en el almacén.
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 0, avg_cost: 10 } } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 5, unit_cost: 99 });
    expect(saldosEscritos()[0][1].avg_cost).toBe(10);
  });

  it("el costo total del movimiento va sobre el valor absoluto", async () => {
    montar();
    await postMovement(ORG, { ...BASE, movement_type: "adjustment", quantity: -4, unit_cost: 25 });
    expect(movimientos()[0].total_cost, "un costo negativo no es un costo").toBe(100);
  });
});

describe("el aviso de reposición", () => {
  it("avisa al BAJAR por debajo del umbral, diciendo dónde", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 12, reserved: 0 } }, articulo: { name: "Cerveza", reorder_point: 10 } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 5 });
    expect(notify).toHaveBeenCalledTimes(1);
    const aviso = notify.mock.calls[0][0];
    expect(aviso).toMatchObject({ event: "stock_low", entityType: "stock_level" });
    expect(aviso.vars.cantidad).toBe(7);
    expect(aviso.vars.minimo).toBe(10);
    // «Quedan 2» sin decir dónde deja al que lo lee con una pregunta.
    expect(aviso.vars.almacen, "el aviso tiene que nombrar el almacén").toBeTruthy();
  });

  it("una ENTRADA no avisa nunca, aunque siga bajo", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 1, reserved: 0 } }, articulo: { name: "Cerveza", reorder_point: 10 } });
    await postMovement(ORG, { ...BASE, movement_type: "receipt", quantity: 1 });
    expect(notify, "reponer no es una alarma").not.toHaveBeenCalled();
  });

  it("no avisa si sigue por encima del umbral", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 50, reserved: 0 } }, articulo: { name: "Cerveza", reorder_point: 10 } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 5 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("un artículo sin umbral no avisa nunca", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 2, reserved: 0 } }, articulo: { name: "Servilletas" } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 2 });
    expect(notify, "el sistema no sabe cuántas necesita esa empresa").not.toHaveBeenCalled();
  });

  it("el umbral se mide contra lo DISPONIBLE, no contra la existencia", async () => {
    // 20 en almacén con 15 ya vendidos: disponible 5, por debajo de 10.
    montar({ saldos: { [ORIGEN]: { quantity: 20, reserved: 15 } }, articulo: { name: "Cerveza", reorder_point: 10 } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 0.5 });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("se agrupa por mes para no avisar en cada salida del día", async () => {
    montar({ saldos: { [ORIGEN]: { quantity: 12, reserved: 0 } }, articulo: { name: "Cerveza", reorder_point: 10 } });
    await postMovement(ORG, { ...BASE, movement_type: "waste", quantity: 5 });
    expect(notify.mock.calls[0][0].dedupeSeed).toBe(new Date().toISOString().slice(0, 7));
  });
});


/**
 * El umbral de reposición decide dos cosas a la vez: qué sale en la lista de
 * compras y qué dispara el aviso de existencias bajas. Están atados a esta
 * función a propósito — con dos definiciones de «bajo», la pantalla señala lo
 * que la campana calla.
 */

describe("cuándo un artículo está bajo", () => {
  it("manda el punto de pedido cuando está puesto", () => {
    expect(reorderThreshold({ reorder_point: 10, min_stock: 4 })).toBe(10);
  });

  it("sin punto de pedido vale el mínimo", () => {
    expect(reorderThreshold({ min_stock: 4 })).toBe(4);
  });

  it("un artículo sin umbral NO tiene umbral, no tiene umbral cero", () => {
    /**
     * Con cero, cualquier artículo agotado se volvería «bajo» y la campana
     * avisaría de cosas que a nadie le importan: el sistema no sabe cuántas
     * unidades necesita esa empresa si nadie se lo dijo.
     */
    expect(reorderThreshold({})).toBeNull();
    expect(reorderThreshold({ min_stock: 0, reorder_point: 0 })).toBeNull();
    expect(reorderThreshold(null)).toBeNull();
    expect(isLowStock(0, {})).toBe(false);
  });

  it("estar EN el umbral ya es estar bajo", () => {
    // Avisar solo por debajo llega un movimiento tarde.
    expect(isLowStock(10, { reorder_point: 10 })).toBe(true);
    expect(isLowStock(11, { reorder_point: 10 })).toBe(false);
  });

  it("un saldo negativo también está bajo", () => {
    // Pasa en almacenes que admiten negativos; no avisar ahí sería absurdo.
    expect(isLowStock(-3, { min_stock: 2 })).toBe(true);
  });
});
