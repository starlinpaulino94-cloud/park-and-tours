import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LA RETENCIÓN, POR LO QUE HACE.
 *
 * Lo que esta prueba NO puede demostrar es la atomicidad: las dos inserciones
 * están dentro de una función de Postgres y aquí no hay Postgres. Eso lo
 * sujetan las guardas que leen la migración y la verificación que se corre
 * contra la base de verdad.
 *
 * Lo que sí se comprueba es todo lo que decide ESTE lado: que el techo se
 * aplica antes de llamar, que una comisión de cero no llama, que el fallo no se
 * traga, y que un reintento se reconoce.
 */

const rpc = vi.fn();
let sesiones: { _id: string }[] = [];

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc }) }));
vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return { ...actual, tenantQuery: vi.fn(async () => sesiones) };
});

import { retenerComision, turnoAbiertoDe } from "@/lib/comision-retenida";

const base = {
  companyId: "org-1",
  bookingId: "bk-1",
  orderId: "ord-1",
  sellerId: "v-1",
  cashSessionId: "cs-1",
  currency: "usd",
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { commission_id: "c-1", movement_id: "m-1", already: false }, error: null });
  sesiones = [{ _id: "cs-1" }];
});

describe("retener la comisión del vendedor", () => {
  it("le retiene su comisión y deja el resto por cobrar", async () => {
    const r = await retenerComision({ ...base, total: 100, comision: 15 });
    expect(r).toMatchObject({ commissionId: "c-1", movementId: "m-1", retenido: 15, pendiente: 85 });
    expect(rpc).toHaveBeenCalledWith("retain_seller_commission", expect.objectContaining({
      p_org: "org-1", p_cash_session: "cs-1",
    }));
  });

  it("EL TECHO SE APLICA ANTES DE ESCRIBIR NADA", async () => {
    /**
     * Con una comisión mal configurada el vendedor retendría más de lo que
     * cobró y el cliente subiría a la guagua con saldo NEGATIVO. Y el tope se
     * aplica aquí, no en la base: lo que se manda ya viene topado, así que no
     * hay forma de que se escriba el número grande.
     */
    const r = await retenerComision({ ...base, total: 100, comision: 140 });
    expect(r.retenido).toBe(100);
    expect(r.pendiente).toBe(0);
    const enviado = rpc.mock.calls[0][1] as { p_commission: { amount: number } };
    expect(enviado.p_commission.amount, "se manda el importe topado").toBe(100);
  });

  it("una comisión de cero no llama a nadie", async () => {
    // Una retención de cero es una fila de caja que no dice nada y una comisión
    // cobrada de cero que luego hay que explicar.
    const r = await retenerComision({ ...base, total: 100, comision: 0 });
    expect(r.retenido).toBe(0);
    expect(r.pendiente).toBe(100);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("EL FALLO NO SE TRAGA", async () => {
    /**
     * Al revés que el consumo de cupo —que nunca tumba una venta porque un
     * contador mal puesto no puede dejar a un cliente sin reserva—, aquí lo que
     * está en juego es que el vendedor se lleve dinero sin que conste, o que
     * conste sin que se lo lleve. Quien llama decide qué hacer, pero no puede
     * no enterarse.
     */
    rpc.mockResolvedValue({ data: null, error: { message: "El turno de caja está cerrado" } });
    await expect(retenerComision({ ...base, total: 100, comision: 15 }))
      .rejects.toThrow(/turno de caja está cerrado/);
  });

  it("un reintento se reconoce y no saca el dinero otra vez", async () => {
    rpc.mockResolvedValue({ data: { commission_id: "c-1", movement_id: "m-1", already: true }, error: null });
    const r = await retenerComision({ ...base, total: 100, comision: 15 });
    expect(r.yaEstaba).toBe(true);
    expect(r.commissionId).toBe("c-1");
  });

  it("los datos de la comisión van en un objeto, no en argumentos sueltos", async () => {
    /**
     * Con trece argumentos —cinco `uuid` seguidos— intercambiar dos compila, se
     * ejecuta y escribe la comisión de otro vendedor sobre otra reserva sin que
     * nada se queje. Es la misma razón por la que el ámbito del vendedor dejó
     * de recibir cuatro cadenas en fila.
     */
    await retenerComision({ ...base, total: 100, comision: 15, beneficiaryName: "Kenia" });
    const enviado = rpc.mock.calls[0][1] as { p_commission: Record<string, unknown> };
    expect(enviado.p_commission).toMatchObject({
      booking_id: "bk-1", order_id: "ord-1", seller_id: "v-1",
      beneficiary_name: "Kenia", amount: 15, currency: "usd",
    });
  });

  it("la moneda viaja en minúsculas, como la guarda el enum", async () => {
    await retenerComision({ ...base, currency: "USD", total: 100, comision: 15 });
    const enviado = rpc.mock.calls[0][1] as { p_commission: { currency: string } };
    expect(enviado.p_commission.currency).toBe("usd");
  });
});

describe("el turno abierto del vendedor", () => {
  it("devuelve el suyo cuando lo tiene", async () => {
    expect(await turnoAbiertoDe("org-1", "v-1")).toBe("cs-1");
  });

  it("y NULL cuando no, que no es lo mismo que inventarse uno", async () => {
    /**
     * Sin turno no se retiene. El dinero que el vendedor se queda tiene que
     * salir de algún arqueo, o al cerrar el día nadie sabe cuánto entregó y
     * cuánto se quedó.
     */
    sesiones = [];
    expect(await turnoAbiertoDe("org-1", "v-1")).toBeNull();
  });
});
