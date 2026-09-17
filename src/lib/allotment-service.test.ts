import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El cupo del socio con la base simulada.
 *
 * Lo que importa aquí son las dos cosas que se pagan dos veces: vender una
 * plaza que el socio no tenía, y dejar bloqueadas diez que nunca iba a usar.
 */

const tenantQuery = vi.fn();
const tenantUpdate = vi.fn();

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
    const r = await consumeAllotment("org", GARANTIZADO, 4);
    expect(r).toEqual({ allotmentId: "a1", seats: 4 });
    expect(tenantUpdate.mock.calls[0][3]).toEqual({ seats_used: 7 });
  });

  it("la venta libre NO lleva cuenta: sería un contador sin significado", async () => {
    expect(await consumeAllotment("org", { ...GARANTIZADO, allotment_type: "free_sale" }, 4)).toBeNull();
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("si el apunte falla, la venta no se entera", async () => {
    tenantUpdate.mockRejectedValue(new Error("base caída"));
    await expect(consumeAllotment("org", GARANTIZADO, 4)).resolves.toBeNull();
  });
});

describe("devolver las plazas al cancelar", () => {
  it("devuelve a SU cupo y por SUS plazas", async () => {
    tenantQuery.mockResolvedValue([{ ...GARANTIZADO, seats_used: 7 }]);
    const devueltas = await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 4 });
    expect(devueltas).toBe(4);
    expect(tenantUpdate.mock.calls[0][3]).toEqual({ seats_used: 3 });
  });

  it("nunca deja el contador en negativo", async () => {
    tenantQuery.mockResolvedValue([{ ...GARANTIZADO, seats_used: 1 }]);
    await releaseBookingAllotment("org", { allotment: "a1", allotment_seats: 9 });
    expect(tenantUpdate.mock.calls[0][3]).toEqual({ seats_used: 0 });
  });

  it("una reserva sin cupo no toca nada", async () => {
    expect(await releaseBookingAllotment("org", {})).toBe(0);
    expect(tenantQuery).not.toHaveBeenCalled();
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
