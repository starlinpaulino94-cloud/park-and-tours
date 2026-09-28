import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El cupo del socio con la base simulada.
 *
 * Lo que importa aquí son las dos cosas que se pagan dos veces: vender una
 * plaza que el socio no tenía, y dejar bloqueadas diez que nunca iba a usar.
 */

const tenantQuery = vi.fn();
const tenantUpdate = vi.fn();

/**
 * El doble de la base para el RECLAMO del cupo (0100).
 *
 * Lleva el contador de verdad porque la mitad del fallo que esto corrige es
 * justamente que el contador se perdía: un doble que siempre dijera `true` sin
 * contar nada perdonaría exactamente el bug bajo prueba.
 */
const cupos = new Map<string, { seats: number; used: number; released: number }>();
const rpcNormal = async (nombre: string, args: Record<string, unknown>) => {
  const id = String(args.p_allotment ?? "");
  const pax = Number(args.p_pax ?? 0);
  const fila = cupos.get(id);
  if (nombre === "claim_allotment_seats") {
    if (!fila) return { data: false, error: null };
    if (fila.seats - fila.used - fila.released < pax) return { data: false, error: null };
    fila.used += pax;
    return { data: true, error: null };
  }
  if (nombre === "release_allotment_seats") {
    if (!fila) return { data: 0, error: null };
    const devueltas = Math.min(pax, fila.used);
    fila.used -= devueltas;
    return { data: devueltas, error: null };
  }
  return { data: null, error: { message: `rpc desconocida: ${nombre}` } };
};
const rpc = vi.fn(rpcNormal);
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc }) }));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});

import {
  assertAllotment, consumeAllotment, releaseBookingAllotment,
  releaseExpiredAllotments, resolveAllotment,
} from "@/lib/allotment-service";

const GARANTIZADO = {
  _id: "a1", allotment_type: "guaranteed", seats: 10, seats_used: 3, seats_released: 0,
  release_days: 3, partner: "p1", product: "prod1", status: "active",
};

beforeEach(() => {
  tenantQuery.mockReset();
  tenantUpdate.mockReset();
  tenantUpdate.mockResolvedValue({});
  cupos.clear();
  cupos.set("a1", { seats: 10, used: 3, released: 0 });
  // Una prueba que simula una caída se la dejaba puesta a las siguientes.
  rpc.mockClear();
  rpc.mockImplementation(rpcNormal);
});

describe("vender contra el cupo", () => {
  it("deja vender lo que le queda", async () => {
    tenantQuery.mockResolvedValue([GARANTIZADO]);
    const r = await assertAllotment("org", { partnerId: "p1", productId: "prod1" }, 7);
    expect(r.state.remaining).toBe(7);
  });

  it("impide pasar del cupo, y dice cuántas le quedan", async () => {
    tenantQuery.mockResolvedValue([GARANTIZADO]);
    const err = await assertAllotment("org", { partnerId: "p1", productId: "prod1" }, 8).catch((e) => e);
    expect((err as { status?: number }).status).toBe(409);
    expect((err as { code?: string }).code).toBe("ALLOTMENT_NO_SEATS");
    // El comercial tiene que poder ampliarle el cupo, no quedarse con un «no».
    expect((err as { remaining?: number }).remaining).toBe(7);
  });

  it("un cupo cerrado no vende, aunque tenga plazas", async () => {
    tenantQuery.mockResolvedValue([{ ...GARANTIZADO, allotment_type: "closed", seats_used: 0 }]);
    await expect(assertAllotment("org", { partnerId: "p1", productId: "prod1" }, 1)).rejects.toThrow(/cerrado/);
  });

  it("sin cupo el socio vende igual: no todos los socios tienen contrato de plazas", async () => {
    tenantQuery.mockResolvedValue([]);
    const r = await assertAllotment("org", { partnerId: "p9", productId: "prod1" }, 40);
    expect(r.row).toBeNull();
    expect(r.state.remaining).toBe(Infinity);
  });

  it("solo mira los cupos ACTIVOS de ese socio", async () => {
    tenantQuery.mockResolvedValue([]);
    await resolveAllotment("org", { partnerId: "p1" });
    expect(tenantQuery.mock.calls[0][2]._filter).toEqual({ partner: "p1", status: "active" });
  });
});

describe("apuntar el consumo", () => {
  it("suma a las vendidas del cupo garantizado", async () => {
    // La suma la hace ahora la base (0100). Lo que se comprueba sigue siendo lo
    // mismo —cuatro plazas más en ESTE cupo— pero sobre el contador de verdad y
    // no sobre el valor que la aplicación calculaba de una lectura vieja.
    const r = await consumeAllotment("org", GARANTIZADO, 4);
    expect(r).toEqual({ allotmentId: "a1", seats: 4 });
    expect(cupos.get("a1")!.used).toBe(7);
  });

  it("la venta libre NO lleva cuenta: sería un contador sin significado", async () => {
    expect(await consumeAllotment("org", { ...GARANTIZADO, allotment_type: "free_sale" }, 4)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si el reclamo falla, la venta SÍ se entera", async () => {
    /**
     * ESTA PRUEBA DECÍA LO CONTRARIO, Y DECÍA MAL.
     *
     * «Si el apunte falla, la venta no se entera» era deliberado: un contador
     * mal puesto no puede dejar a un cliente sin su reserva. Pero convertía el
     * cupo en un adorno —la única comprobación real era una lectura vieja— y el
     * contrato con la agencia en una sugerencia. Medido: 30 ventas contra un
     * cupo de 10, las 30 pasando.
     *
     * Ahora el reclamo va ANTES de escribir la venta y con la base decidiendo,
     * así que rechazar no deja a nadie a medias: no hay reserva que deshacer.
     */
    rpc.mockResolvedValueOnce({ data: null, error: { message: "base caída" } });
    await expect(consumeAllotment("org", GARANTIZADO, 4)).rejects.toThrow(/cupo/i);
  });
});

describe("devolver las plazas al cancelar", () => {
  it("devuelve a SU cupo y por SUS plazas", async () => {
    cupos.set("a1", { seats: 10, used: 7, released: 0 });
    const devueltas = await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 4 });
    expect(devueltas).toBe(4);
    expect(cupos.get("a1")!.used).toBe(3);
  });

  it("nunca deja el contador en negativo", async () => {
    // Un negativo dejaría el cupo prometiendo plazas que no existen. Y ahora
    // además DICE cuántas devolvió de verdad, que es una sola: el papel del
    // socio no puede afirmar que se le devolvieron nueve.
    cupos.set("a1", { seats: 10, used: 1, released: 0 });
    expect(await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 9 })).toBe(1);
    expect(cupos.get("a1")!.used).toBe(0);
  });

  it("una reserva sin cupo no toca nada", async () => {
    expect(await releaseBookingAllotment("org", {})).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("la liberación automática", () => {
  const AHORA = new Date("2026-09-16T12:00:00Z");
  const conSalida = (extra: Record<string, unknown> = {}) => ([{
    ...GARANTIZADO,
    departure: { _id: "d1", departure_at: "2026-09-18T08:00:00Z" },
    ...extra,
  }]);

  it("libera lo no vendido cuando entra en la ventana", async () => {
    tenantQuery.mockResolvedValue(conSalida());
    const r = await releaseExpiredAllotments("org", AHORA);
    expect(r.released).toBe(1);
    expect(r.seats).toBe(7); // 10 − 3 vendidas
    expect(tenantUpdate.mock.calls[0][3].seats_released).toBe(7);
  });

  it("no libera lo que todavía está lejos", async () => {
    tenantQuery.mockResolvedValue(conSalida({ departure: { _id: "d1", departure_at: "2026-10-30T08:00:00Z" } }));
    const r = await releaseExpiredAllotments("org", AHORA);
    expect(r.released).toBe(0);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("correr dos veces no libera dos veces", async () => {
    // Tras el primer barrido, `seats_released` ya cubre lo liberable.
    tenantQuery.mockResolvedValue(conSalida({ seats_released: 7 }));
    const r = await releaseExpiredAllotments("org", AHORA);
    expect(r.released).toBe(0);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("un cupo sin fecha de salida no se libera: no hay contra qué contar los días", async () => {
    tenantQuery.mockResolvedValue([{ ...GARANTIZADO, departure: null }]);
    const r = await releaseExpiredAllotments("org", AHORA);
    expect(r.reviewed).toBe(0);
    expect(r.released).toBe(0);
  });

  it("solo mira los cupos garantizados y activos", async () => {
    tenantQuery.mockResolvedValue([]);
    await releaseExpiredAllotments("org", AHORA);
    expect(tenantQuery.mock.calls[0][2]._filter).toEqual({ allotment_type: "guaranteed", status: "active" });
  });
});

/**
 * UNA PLATAFORMA CON MÁS DE DOS MIL CUPOS (ola 9.13).
 *
 * `releaseExpiredAllotments` leía con `_limit: 2000`. Lo que quedaba fuera eran
 * plazas garantizadas a un socio que ya no las va a usar y que nadie más puede
 * vender — y como el orden no cambia entre pasadas, siempre las mismas: no se
 * liberaban el lunes, ni el martes, ni nunca.
 *
 * La prueba cuenta PLAZAS, no filas: liberar 2 000 cupos de 7 plazas y liberar
 * 2 400 dan el mismo tipo de respuesta y 2 800 plazas de diferencia.
 */
describe("liberar cupos por encima del tope viejo", () => {
  const AHORA_ = new Date("2026-09-16T12:00:00Z");

  /** `cuantos` cupos vencidos, cada uno con 7 plazas sin vender. */
  const muchos = (cuantos: number) =>
    Array.from({ length: cuantos }, (_, i) => ({
      ...GARANTIZADO,
      _id: `a-${String(i).padStart(5, "0")}`,
      departure: { _id: `d-${i}`, departure_at: "2026-09-18T08:00:00Z" },
    }));

  /** Ventanas de verdad: sin esto, un bucle que no avanza saldría en verde. */
  const porVentanas = (filas: Record<string, unknown>[]) => {
    tenantQuery.mockImplementation((_o: string, tabla: string, opts: Record<string, number>) => {
      if (tabla !== "allotment") return Promise.resolve([]);
      const salto = Number(opts?._offset ?? 0);
      const limite = Number(opts?._limit ?? 50);
      return Promise.resolve(filas.slice(salto, salto + limite));
    });
  };

  it("libera TODOS los vencidos, no los dos mil primeros", async () => {
    porVentanas(muchos(2400));

    const r = await releaseExpiredAllotments("org", AHORA_);

    expect(r.reviewed).toBe(2400);
    expect(r.released).toBe(2400);
    // 2 400 × 7 = 16 800 plazas. Con el tope salían 14 000 y 2 800 se quedaban
    // bloqueadas para siempre.
    expect(r.seats).toBe(16_800);
  });

  it("y ninguno se libera dos veces al cambiar de página", async () => {
    porVentanas(muchos(2400));
    await releaseExpiredAllotments("org", AHORA_);
    const tocados = tenantUpdate.mock.calls.filter((c) => c[1] === "allotment").map((c) => c[2]);
    expect(new Set(tocados).size).toBe(tocados.length);
  });

  it("si de verdad no se pueden leer, no se libera media plataforma", async () => {
    porVentanas(muchos(10_600));
    await expect(releaseExpiredAllotments("org", AHORA_)).rejects.toThrow(/no se pudo leer/i);
  });
});

/**
 * EL CUPO SE RECLAMA, NO SE RECALCULA (0100, dimensión F).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO MEDIDO
 *
 * Treinta ventas simultáneas de una plaza contra un cupo garantizado de 10:
 * `seats_used` acabó en **2**, y las treinta pasaron. `assertAllotment` lee la
 * fila al empezar la venta; `consumeAllotment` escribía al terminarla
 * `seats_used = <lo que leyó> + pax` —un valor ABSOLUTO sobre una lectura
 * vieja— con la venta entera de por medio.
 *
 * Es peor que una sobreventa de plazas: allí el contador ENSEÑABA el exceso.
 * Aquí el socio vendió 30 de un contrato de 10 y la matriz dice «2 usadas, 8
 * libres», así que el comercial vuelve a vender el mismo hueco.
 */
describe("el reclamo del cupo", () => {
  const cupoDe = (id = "a1") => cupos.get(id)!;

  it("reclama en la base y NO escribe el contador a mano", async () => {
    const hecho = await consumeAllotment("org", GARANTIZADO, 2);

    expect(hecho).toEqual({ allotmentId: "a1", seats: 2 });
    expect(rpc).toHaveBeenCalledWith("claim_allotment_seats", { p_allotment: "a1", p_pax: 2 });
    expect(cupoDe().used).toBe(5);
    // Escribir `seats_used` desde aquí volvería a pisar lo que otra venta
    // acabe de reclamar: es el fallo entero.
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("dos ventas seguidas SUMAN, no se pisan", async () => {
    // Las dos llegan con la misma fila leída —`used: 3`—, que es exactamente
    // lo que pasaba en producción: dos ventas del mismo cupo abiertas a la vez.
    await consumeAllotment("org", GARANTIZADO, 2);
    await consumeAllotment("org", GARANTIZADO, 2);

    // Con la escritura vieja las dos habrían dejado el contador en 5.
    expect(cupoDe().used).toBe(7);
  });

  it("cuando ya no cabe, la venta NO pasa", async () => {
    cupos.set("a1", { seats: 10, used: 9, released: 0 });

    await expect(consumeAllotment("org", GARANTIZADO, 4)).rejects.toThrow(/cupo|plazas/i);
    // Y no deja el cupo a medias: sería vender media excursión a una familia.
    expect(cupoDe().used).toBe(9);
  });

  it("un cupo que no aparta plazas no reclama nada", async () => {
    const libre = { ...GARANTIZADO, allotment_type: "free_sale" };
    expect(await consumeAllotment("org", libre, 3)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("si la base se cae, la venta no sigue a ciegas", async () => {
    /**
     * Tragarse el error aquí es vender contra un contrato sin saber si queda
     * sitio, que es la misma decisión que `assertCapacity`: ante la duda, se
     * rechaza. Antes se escribía `console.error` y la venta continuaba.
     */
    rpc.mockResolvedValueOnce({ data: null, error: { message: "se cayó la conexión" } });
    await expect(consumeAllotment("org", GARANTIZADO, 1)).rejects.toThrow(/cupo/i);
  });
});

describe("la devolución del cupo", () => {
  it("devuelve en la base, sin leer y escribir por su cuenta", async () => {
    cupos.set("a1", { seats: 10, used: 6, released: 0 });

    const devueltas = await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 2 });

    expect(devueltas).toBe(2);
    expect(rpc).toHaveBeenCalledWith("release_allotment_seats", { p_allotment: "a1", p_pax: 2 });
    expect(cupos.get("a1")!.used).toBe(4);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("dos cancelaciones a la vez devuelven las dos", async () => {
    // Con la lectura y escritura sueltas, la segunda escribía sobre lo que leyó
    // antes de que la primera guardara: el socio se quedaba sin cupo pagado.
    cupos.set("a1", { seats: 10, used: 6, released: 0 });

    await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 2 });
    await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 2 });

    expect(cupos.get("a1")!.used).toBe(2);
  });

  it("devolver no tumba nada si la base falla: se dice y se sigue", async () => {
    // Al revés que el reclamo: no devolver una plaza deja un cupo corto, y eso
    // se arregla; tumbar la cancelación de un cliente, no.
    rpc.mockResolvedValueOnce({ data: null, error: { message: "se cayó" } });
    await expect(releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 2 }))
      .resolves.toBe(0);
  });
});
