import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL MONEDERO PREPAGO CONTRA LA BASE, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las reglas del monedero —el signo de cada tipo, que no hay descubierto, que la
 * moneda tiene que coincidir— viven en `monedero-socio.ts` y están probadas. Lo
 * que decide ESTE fichero es **contra qué se comparan**:
 *
 *   · de dónde sale la moneda del monedero;
 *   · qué movimientos entran en el saldo;
 *   · y si un fallo al apuntar tumba la venta o no.
 *
 * Las tres son la diferencia entre una regla escrita y una regla que se aplica.
 */

let db: FakeDb;

/**
 * El consumo ya no es un `insert`: desde 0091 va por `spend_partner_wallet`,
 * que suma el saldo dentro de su propia transacción y detrás de un cerrojo.
 *
 * Lo que esta prueba NO puede demostrar es la atomicidad: la función vive en
 * Postgres y aquí no hay Postgres. Eso lo sujetan las guardas que leen la
 * migración y la verificación que se corre contra la base de verdad. Lo que sí
 * se comprueba es todo lo que decide ESTE lado: qué se le manda, qué se hace
 * con lo que contesta, y que un fallo no tumbe la venta.
 */
const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc }) }));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
  };
});

import {
  saldoDeSocio, assertSaldo, apuntarMovimiento, descontarVenta, gastarDelMonedero,
  devolverAlMonedero, monedaDelMonederoDe, movimientosDe,
} from "@/lib/monedero-service";

const SOCIO = "soc-1";

const mov = (over: Record<string, unknown>) => ({
  partner: SOCIO, currency: "usd", ...over,
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      movement_id: "mov-1", amount: 120, currency: "usd",
      balance_before: 500, balance_after: 380, overdraft: false, already: false,
    },
    error: null,
  });
  db = fakeDb();
  db.seed("partner", [
    { _id: SOCIO, name: "Tour Center", currency: "usd", payment_mode: "prepaid" },
    { _id: "soc-sin-moneda", name: "Sin moneda", payment_mode: "prepaid" },
  ]);
});

describe("la moneda del monedero", () => {
  it("SALE DEL CONTRATO, no del movimiento", async () => {
    /**
     * Es el eje de todo lo demás. Comparar un movimiento consigo mismo es una
     * comprobación que no puede fallar nunca — y era exactamente lo que hacía la
     * venta: le pasaba a `descontarVenta` la moneda de la venta COMO moneda del
     * monedero.
     */
    expect(await monedaDelMonederoDe("c1", SOCIO)).toBe("usd");
  });

  it("y un contrato sin moneda lo dice con null, no con un valor inventado", async () => {
    // Un «usd» por defecto autorizaría ventas en dólares contra un monedero que
    // nadie declaró en dólares.
    expect(await monedaDelMonederoDe("c1", "soc-sin-moneda")).toBeNull();
  });
});

describe("el saldo", () => {
  it("es la suma de los movimientos con el signo de su tipo", async () => {
    db.seed("partner_wallet_movement", [
      { _id: "m1", ...mov({ movement_type: "topup", amount: 1000 }) },
      { _id: "m2", ...mov({ movement_type: "consumption", amount: 300 }) },
      { _id: "m3", ...mov({ movement_type: "refund", amount: 100 }) },
      { _id: "m4", ...mov({ movement_type: "adjustment", amount: 50 }) },
    ]);
    expect(await saldoDeSocio("c1", SOCIO)).toBe(750);
  });

  it("SOLO DE SU MONEDA: una fila en otra no infla el saldo", async () => {
    /**
     * EL FALLO QUE ESTA PRUEBA EXISTE PARA FIJAR.
     *
     * `saldoDe` suma lo que se le dé sin mirar la moneda —es su contrato— y nadie
     * filtraba antes. Así que el saldo salía de sumar TODOS los movimientos del
     * socio: una recarga de 30.000 pesos sumaba 30.000 a un saldo de dólares, y
     * `assertSaldo` autorizaba ventas contra ese número.
     *
     * El módulo puro avisa de este escenario en su cabecera y lo defendía solo al
     * ESCRIBIR. Al leer —que es lo que autoriza la venta— no había nada.
     */
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    db.seed("partner_wallet_movement", [
      { _id: "m1", ...mov({ movement_type: "topup", amount: 500 }) },
      { _id: "m2", ...mov({ movement_type: "topup", amount: 30_000, currency: "dop" }) },
    ]);
    expect(await saldoDeSocio("c1", SOCIO)).toBe(500);

    /**
     * Y NO EN SILENCIO. Esos 30.000 son dinero que el socio ingresó y que ya no
     * cuadra con nada: dejarlos fuera del saldo es lo correcto —sumarlos sería
     * peor— pero callarlo convierte un problema visible en uno que aparece
     * liquidando, meses después.
     */
    expect(aviso, "los movimientos en otra moneda se descartan sin decirlo").toHaveBeenCalled();
    expect(String(aviso.mock.calls[0]?.[0] ?? "")).toContain("otra moneda");
    aviso.mockRestore();
  });

  it("y sin moneda declarada suma todo, pero no en silencio", async () => {
    /**
     * Sin moneda no se puede filtrar sin inventarse una, así que se hace lo de
     * antes —sumar todo— y se deja dicho. La diferencia con el estado anterior no
     * es el número: es que ahora alguien puede enterarse.
     */
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    db.seed("partner_wallet_movement", [
      { _id: "m1", partner: "soc-sin-moneda", currency: "usd", movement_type: "topup", amount: 100 },
    ]);
    expect(await saldoDeSocio("c1", "soc-sin-moneda")).toBe(100);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("un tipo desconocido NO se cuenta", async () => {
    // Contarlo como suma le regalaría saldo y como resta se lo quitaría: las dos
    // son peor que dejarlo fuera y que el descuadre se vea en el listado.
    db.seed("partner_wallet_movement", [
      { _id: "m1", ...mov({ movement_type: "topup", amount: 100 }) },
      { _id: "m2", ...mov({ movement_type: "regalo", amount: 900 }) },
    ]);
    expect(await saldoDeSocio("c1", SOCIO)).toBe(100);
  });

  it("y el listado es de UNA página; el saldo, de todo", async () => {
    // Un saldo por página crece solo cuando el socio pasa de quinientos
    // movimientos, y crece hacia arriba: se pierden consumos viejos.
    db.seed("partner_wallet_movement", Array.from({ length: 12 }, (_, i) => ({
      _id: `m${i}`, ...mov({ movement_type: "topup", amount: 10, created_at: `2026-01-${String(i + 1).padStart(2, "0")}` }),
    })));
    expect(await movimientosDe("c1", SOCIO, 5)).toHaveLength(5);
    expect(await saldoDeSocio("c1", SOCIO)).toBe(120);
  });
});

describe("autorizar una venta contra el saldo", () => {
  beforeEach(() => {
    db.seed("partner_wallet_movement", [
      { _id: "m1", ...mov({ movement_type: "topup", amount: 500 }) },
    ]);
  });

  it("pasa cuando le llega", async () => {
    const v = await assertSaldo("c1", SOCIO, 300, "usd");
    expect(v.allowed).toBe(true);
    expect(v.saldo).toBe(500);
  });

  it("y cuando no, es 402 y dice cuánto falta", async () => {
    // 402 y no 403: no le faltan permisos, le falta dinero — y el importe es lo
    // que necesita para ir a transferirlo.
    await expect(assertSaldo("c1", SOCIO, 800, "usd")).rejects.toMatchObject({
      status: 402, code: "WALLET_INSUFFICIENT", faltan: 300,
    });
  });

  it("UNA VENTA EN OTRA MONEDA SE RECHAZA ANTES DE VENDER", async () => {
    /**
     * La otra mitad del fallo. La venta llamaba a `assertSaldo` sin decirle en qué
     * moneda iba, así que nunca se comparó nada: una venta en pesos contra un
     * monedero en dólares pasaba el control y descontaba 30.000 de un saldo de
     * dólares.
     *
     * Y se rechaza AQUÍ, antes de la venta, no al descontar: `descontarVenta` se
     * traga sus errores a propósito —el cliente ya tiene su voucher—, así que un
     * rechazo allí no impide nada.
     */
    await expect(assertSaldo("c1", SOCIO, 100, "dop")).rejects.toMatchObject({
      status: 409, code: "WALLET_CURRENCY_MISMATCH", monedero: "usd", venta: "dop",
    });
  });

  it("y un socio prepago sin moneda declarada no se autoriza a ciegas", async () => {
    // No se puede comparar contra nada, así que no se puede afirmar que le llega.
    await expect(assertSaldo("c1", "soc-sin-moneda", 10, "usd")).rejects.toMatchObject({
      status: 409, code: "WALLET_NO_CURRENCY",
    });
  });

  it("el céntimo de tolerancia no tumba una venta por un redondeo", async () => {
    // El mismo que usa el control de crédito: los redondeos de una venta con
    // varias líneas no pueden dejar a un cliente sin reserva por 0,004.
    await expect(assertSaldo("c1", SOCIO, 500.004, "usd")).resolves.toMatchObject({ allowed: true });
  });
});

describe("apuntar un movimiento", () => {
  it("guarda el importe en POSITIVO: el signo lo pone el tipo", async () => {
    /**
     * Con importes con signo, una recarga de −500 vacía el monedero sin que nada
     * parezca raro: en el listado se lee como una recarga.
     */
    await apuntarMovimiento("c1", {
      partnerId: SOCIO, tipo: "topup", importe: 500, moneda: "usd", referencia: "TR-1",
    }, "usd");
    expect(db.rows("partner_wallet_movement")[0]).toMatchObject({
      movement_type: "topup", amount: 500, currency: "usd", reference: "TR-1",
    });
  });

  it("y LANZA si la moneda no es la del monedero: aquí se mueve dinero", async () => {
    /**
     * Al revés que el consumo de cupo, que nunca tumba una venta. Una recarga que
     * se traga su error deja al socio creyendo que ingresó y a la operadora sin el
     * apunte.
     */
    await expect(apuntarMovimiento("c1", {
      partnerId: SOCIO, tipo: "topup", importe: 30_000, moneda: "dop",
    }, "usd")).rejects.toThrow(/USD.*DOP|DOP.*USD/);
    expect(db.rows("partner_wallet_movement")).toEqual([]);
  });

  it("ni un importe de cero ni uno negativo llegan a la base", async () => {
    for (const importe of [0, -100]) {
      await expect(apuntarMovimiento("c1", {
        partnerId: SOCIO, tipo: "topup", importe, moneda: "usd",
      }, "usd")).rejects.toThrow();
    }
    expect(db.rows("partner_wallet_movement")).toEqual([]);
  });
});

describe("descontar y devolver, que NO pueden tumbar la operación", () => {
  it("un descuento que falla deja la venta en pie", async () => {
    /**
     * En este punto el cliente ya tiene su reserva y su voucher: revertir todo por
     * no poder escribir una fila de saldo sería cambiar un descuadre —visible en el
     * listado al día siguiente— por una reserva perdida con el turista delante.
     */
    rpc.mockResolvedValueOnce({ data: null, error: { message: "el monedero está en USD" } });
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await descontarVenta("c1", {
      partnerId: SOCIO, tipo: "consumption", importe: 100, moneda: "dop",
    }, "usd");
    expect(r).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("y uno que va bien manda la venta ENTERA a la función con cerrojo", async () => {
    /**
     * Ya no es un `insert` desde aquí. Entre que `assertSaldo` autoriza y esto
     * descuenta pasa toda la venta: dos ventas a la vez del mismo socio leían el
     * mismo saldo y las dos pasaban. La suma tiene que hacerse donde se escribe.
     */
    const r = await descontarVenta("c1", {
      partnerId: SOCIO, tipo: "consumption", importe: 120, moneda: "usd",
      orderId: "ord-1", bookingId: "bk-1", userId: "usr-1",
    }, "usd");

    expect(rpc).toHaveBeenCalledWith("spend_partner_wallet", {
      p_org: "c1",
      p_partner: SOCIO,
      p_movement: expect.objectContaining({
        amount: 120, currency: "usd", order_id: "ord-1", booking_id: "bk-1", created_by: "usr-1",
      }),
    });
    expect(r).toMatchObject({ _id: "mov-1", movement_type: "consumption", amount: 120 });
  });

  it("LA MONEDA QUE VIAJA ES LA DEL MONEDERO, no la de la venta", async () => {
    // El argumento existe justamente para eso: comparar el movimiento consigo
    // mismo es la comprobación que no puede fallar nunca.
    await descontarVenta("c1", {
      partnerId: SOCIO, tipo: "consumption", importe: 120, moneda: "dop",
    }, "usd");
    const enviado = rpc.mock.calls[0][1] as { p_movement: { currency: string } };
    expect(enviado.p_movement.currency).toBe("usd");
  });

  it("UN DESCUBIERTO SE GRITA en vez de quedarse mudo", async () => {
    /**
     * El consumo se apunta igual —el servicio ya se prestó, y un libro que se
     * niega a anotar dinero gastado es un libro que miente— pero alguien tiene
     * que ir a cobrar la diferencia, y para eso hay que enterarse.
     */
    rpc.mockResolvedValueOnce({
      data: {
        movement_id: "mov-2", amount: 200, currency: "usd",
        balance_before: 100, balance_after: -100, overdraft: true, already: false,
      },
      error: null,
    });
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    let hecho;
    try {
      hecho = await gastarDelMonedero("c1", {
        partnerId: SOCIO, tipo: "consumption", importe: 200, moneda: "usd",
      }, "usd");
    } finally {
      console.error = real;
    }
    expect(hecho?.descubierto).toBe(true);
    expect(hecho?.saldoDespues).toBe(-100);
    expect(gritos.join(" ")).toMatch(/DESCUBIERTO/);
  });

  it("y un saldo que aguanta no grita nada", async () => {
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    try {
      await gastarDelMonedero("c1", { partnerId: SOCIO, tipo: "consumption", importe: 120, moneda: "usd" }, "usd");
    } finally {
      console.error = real;
    }
    expect(gritos).toEqual([]);
  });

  it("un reintento de la misma venta se reconoce, no se descuenta otra vez", async () => {
    // Antes lo paraba el índice único lanzando un error que esta función se
    // tragaba: quedaba como «no se pudo descontar», que es otra cosa.
    rpc.mockResolvedValueOnce({
      data: { movement_id: "mov-1", amount: 120, currency: "usd", already: true },
      error: null,
    });
    const hecho = await gastarDelMonedero("c1", {
      partnerId: SOCIO, tipo: "consumption", importe: 120, moneda: "usd", orderId: "ord-1",
    }, "usd");
    expect(hecho?.yaEstaba).toBe(true);
    expect(hecho?.movementId).toBe("mov-1");
  });

  it("una devolución de CERO no ensucia el listado", async () => {
    // Una reserva sin importe no devolvió nada: la fila no diría nada y habría que
    // explicarla cada vez que alguien la vea.
    expect(await devolverAlMonedero("c1", {
      partnerId: SOCIO, tipo: "refund", importe: 0, moneda: "usd",
    }, "usd")).toBeNull();
    expect(db.rows("partner_wallet_movement")).toEqual([]);
  });

  it("y la cancelación tampoco se cae si la devolución no se puede apuntar", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await devolverAlMonedero("c1", {
      partnerId: SOCIO, tipo: "refund", importe: 50, moneda: "dop",
    }, "usd")).toBeNull();
    aviso.mockRestore();
  });
});
