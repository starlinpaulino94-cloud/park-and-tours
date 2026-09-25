import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * DESHACER UNA VENTA.
 *
 * Cancelar no es cambiar un estado: es aplicar la política de reembolso, soltar
 * la plaza, anular las comisiones, cancelar el devengo del proveedor, liberar
 * las existencias, devolver las plazas al cupo del socio, cancelar las
 * recogidas, invalidar el voucher y registrar el reembolso. Trece cosas, y si
 * una se queda a medias nadie se entera: la reserva figura cancelada y la plaza
 * sigue ocupada, o el dinero sale dos veces.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn(), notifyRoles: vi.fn() }));
vi.mock("@/lib/messaging/events", () => ({ notifyBookingCancelled: vi.fn() }));
// El libro diario y MembeGo hablan con sistemas que aquí no existen y que, por
// diseño, no pueden tumbar una cancelación.
vi.mock("@/lib/ledger-events", () => ({ postPayment: vi.fn(), postSale: vi.fn() }));
const beneficioDevuelto = vi.fn(async () => []);
vi.mock("@/lib/membego-redemption-service", () => ({
  reverseForOrder: (...a: unknown[]) => beneficioDevuelto(...(a as [])),
}));

import { cancelBookingFully, TERMINAL_STATES } from "@/lib/booking-cancel-service";

const ORG = "org-1";
const ctx = {
  companyId: ORG, userId: "user-1", role: "manager", branchId: null,
  company: { _id: ORG, base_currency: "usd" },
} as unknown as Parameters<typeof cancelBookingFully>[0];

const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

/** Una reserva vendida, pagada entera, con su plaza ocupada y su voucher. */
function vendida(over: Record<string, unknown> = {}) {
  const booking = {
    _id: "res-1", booking_number: "RSV-0001", order: "ord-1", customer: "cli-1",
    product: { _id: "prod-saona", name: "Isla Saona", cancellation_policy: "pol-flex" },
    departure: "sal-saona",
    status: "paid", pax_total: 2, adults: 2,
    total_amount: 200, paid_amount: 200, balance_amount: 0, refund_amount: 0,
    currency: "usd", travel_date: futuro(10),
    ...over,
  };
  db = fakeDb({
    cancellation_policy: [{
      _id: "pol-flex", name: "Flexible",
      tiers: JSON.stringify([{ hours_before: 24, refund_pct: 100 }, { hours_before: 6, refund_pct: 50 }]),
    }],
    departure: [{ _id: "sal-saona", product: "prod-saona", departure_at: futuro(10),
      capacity: 40, booked_pax: 2, pending_pax: 0, status: "available" }],
    order: [{ _id: "ord-1", total: 200, paid_total: 200, balance: 0, currency: "usd", status: "paid" }],
    booking: [booking],
    voucher: [{ _id: "vch-1", booking: "res-1", order: "ord-1", code: "VCH-1", status: "valid" }],
  });
  return booking;
}

beforeEach(() => { vendida(); });

describe("el reembolso lo manda la política", () => {
  it("cancelar con diez días de margen devuelve el 100 %", async () => {
    const b = vendida();
    const r = await cancelBookingFully(ctx, b as never, { reason: "El cliente no viaja" });
    expect(r.refundPct).toBe(100);
    expect(r.refund).toBe(200);
    expect(db.row("booking", { _id: "res-1" })!.status).toBe("refunded");
  });

  it("dentro de las 24 horas devuelve la mitad", async () => {
    const b = vendida({ travel_date: new Date(Date.now() + 10 * 3_600_000).toISOString() });
    const r = await cancelBookingFully(ctx, b as never, {});
    expect(r.refundPct).toBe(50);
    expect(r.refund).toBe(100);
    expect(db.row("booking", { _id: "res-1" })!.status).toBe("partially_refunded");
  });

  it("a última hora no devuelve nada, y la reserva queda cancelada sin más", async () => {
    const b = vendida({ travel_date: new Date(Date.now() + 2 * 3_600_000).toISOString() });
    const r = await cancelBookingFully(ctx, b as never, {});
    expect(r.refund).toBe(0);
    expect(db.row("booking", { _id: "res-1" })!.status).toBe("cancelled");
  });

  it("nunca se devuelve más de lo que el cliente pagó", async () => {
    // El 100 % de una reserva de 200 con 50 cobrados son 50, no 200. Devolver
    // el total sería sacar de la caja dinero que nunca entró.
    const b = vendida({ paid_amount: 50, balance_amount: 150, status: "partially_paid" });
    const r = await cancelBookingFully(ctx, b as never, {});
    expect(r.refund).toBe(50);
  });

  it("un reembolso forzado tampoco puede superar lo pagado", async () => {
    const b = vendida({ paid_amount: 50, balance_amount: 150, status: "partially_paid" });
    const r = await cancelBookingFully(ctx, b as never, { refundOverride: 500 });
    expect(r.refund).toBe(50);
  });

  it("forzar un reembolso exige rango de gestión", async () => {
    const b = vendida();
    const vendedor = { ...ctx, role: "seller" } as unknown as Parameters<typeof cancelBookingFully>[0];
    await expect(cancelBookingFully(vendedor, b as never, { refundOverride: 10 }))
      .rejects.toThrow(/permiso/i);
  });

  it("sin política definida no se inventa un reembolso", async () => {
    const b = vendida({ product: { _id: "prod-saona", name: "Isla Saona" } });
    const r = await cancelBookingFully(ctx, b as never, {});
    expect(r.refundPct).toBe(0);
    expect(r.policyName).toBe("Sin política definida");
  });
});

describe("lo que la cancelación tiene que soltar", () => {
  it("la plaza vuelve a la salida", async () => {
    const b = vendida();
    await cancelBookingFully(ctx, b as never, {});
    expect(Number(db.row("departure", { _id: "sal-saona" })!.booked_pax)).toBe(0);
  });

  it("el voucher deja de valer", async () => {
    // Un voucher vivo de una reserva cancelada abre la puerta del parque.
    const b = vendida();
    await cancelBookingFully(ctx, b as never, {});
    expect(db.row("voucher", { _id: "vch-1" })!.status).toBe("cancelled");
  });

  it("la recogida se cancela y sale de su ruta", async () => {
    // Sin esto el conductor pasa igual por el hotel a buscar a alguien que
    // canceló, y el cupo del vehículo lo sigue contando.
    const b = vendida();
    db.seed("pickup", [{ _id: "pk-1", booking: "res-1", hotel: "hot-1", route: "ruta-1", status: "confirmed" }]);
    const r = await cancelBookingFully(ctx, b as never, {});
    expect(r.pickupsCancelled).toBe(1);
    const pk = db.row("pickup", { _id: "pk-1" })!;
    expect(pk.status).toBe("cancelled");
    expect(pk.route).toBeNull();
  });

  it("una recogida YA hecha no se toca: eso ya ocurrió", async () => {
    const b = vendida();
    db.seed("pickup", [{ _id: "pk-1", booking: "res-1", route: "ruta-1", status: "picked_up" }]);
    await cancelBookingFully(ctx, b as never, {});
    expect(db.row("pickup", { _id: "pk-1" })!.status).toBe("picked_up");
  });

  it("las plazas vuelven a SU cupo y por SUS plazas", async () => {
    const b = vendida({ allotment: "cupo-1", allotment_seats: 2 });
    db.seed("allotment", [{ _id: "cupo-1", partner: "soc-1", allotment_type: "guaranteed",
      seats: 10, seats_used: 5, seats_released: 0, status: "active" }]);
    await cancelBookingFully(ctx, b as never, {});
    expect(Number(db.row("allotment", { _id: "cupo-1" })!.seats_used)).toBe(3);
  });

  it("el saldo de la reserva queda a cero: ya no se le debe ni se le cobra", async () => {
    const b = vendida({ paid_amount: 50, balance_amount: 150, status: "partially_paid" });
    await cancelBookingFully(ctx, b as never, {});
    expect(Number(db.row("booking", { _id: "res-1" })!.balance_amount)).toBe(0);
  });

  it("el reembolso queda registrado como pago de salida", async () => {
    const b = vendida();
    await cancelBookingFully(ctx, b as never, {});
    const pago = db.rows("payment").find((p) => p.payment_type === "refund");
    expect(pago, "un reembolso sin asiento en caja no lo cuadra nadie").toBeTruthy();
    expect(Number(pago!.amount)).toBe(200);
  });
});

describe("cancelar un paquete", () => {
  it("cancela también sus actividades", async () => {
    // Si no, quedan tres reservas vivas ocupando plazas en tres salidas, con
    // importe cero y sin nadie que las reclame.
    const b = vendida();
    db.seed("booking", [
      { _id: "comp-1", bundle_booking: "res-1", booking_number: "RSV-0002", order: "ord-1",
        product: { _id: "prod-buggy" }, departure: "sal-saona",
        status: "paid", pax_total: 1, total_amount: 0, paid_amount: 0, balance_amount: 0 },
    ]);
    await cancelBookingFully(ctx, b as never, {});
    expect(db.row("booking", { _id: "comp-1" })!.status).toBe("cancelled");
  });

  it("una actividad ya cancelada no se vuelve a cancelar", async () => {
    const b = vendida();
    db.seed("booking", [
      { _id: "comp-1", bundle_booking: "res-1", booking_number: "RSV-0002", order: "ord-1",
        product: { _id: "prod-buggy" }, status: "cancelled", refund_amount: 0,
        pax_total: 1, total_amount: 0, paid_amount: 0, balance_amount: 0 },
    ]);
    await cancelBookingFully(ctx, b as never, {});
    const pagos = db.rows("payment").filter((p) => p.booking === "comp-1");
    expect(pagos).toHaveLength(0);
  });
});

describe("cancelar dos veces", () => {
  it("la segunda cancelación se rechaza", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * El propio módulo dice en su cabecera que existe para que haya UNA sola
     * cancelación para todos los orígenes, precisamente para que quien llame no
     * tenga que acordarse de las trece cosas. Y la constante `TERMINAL_STATES`
     * declara aquí mismo la regla: «cancelar dos veces reembolsa dos veces».
     *
     * Pero la comprobación vivía en cada llamador. Los dos de hoy —la ruta de
     * mostrador y el conector OCTO— la hacen. El tercero que llegue tendría que
     * acordarse, y si no: un segundo pago de reembolso, el cobrado de la orden
     * en negativo y las plazas devueltas al cupo del socio por partida doble.
     *
     * Y dentro de esta misma función los COMPONENTES de un paquete sí estaban
     * protegidos. La cabecera no.
     */
    const b = vendida();
    await cancelBookingFully(ctx, b as never, {});
    const yaCancelada = db.row("booking", { _id: "res-1" })!;
    expect(TERMINAL_STATES).toContain(String(yaCancelada.status));

    await expect(
      cancelBookingFully(ctx, yaCancelada as never, {}),
      "cancelar dos veces reembolsa dos veces"
    ).rejects.toThrow();
  });

  it("y no sale un segundo reembolso", async () => {
    const b = vendida();
    await cancelBookingFully(ctx, b as never, {});
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {}).catch(() => {});
    const reembolsos = db.rows("payment").filter((p) => p.payment_type === "refund");
    expect(reembolsos, "el dinero no puede salir dos veces por la misma reserva").toHaveLength(1);
  });
});

describe("una cancelación no deja saldo, cobre lo que cobre", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * EL INVARIANTE QUE FALTABA, Y LO QUE COSTABA NO TENERLO
   *
   * `syncOrderTotals` tenía dos listas de estados terminales y a las dos les
   * faltaba `partially_refunded`, que es el estado de una cancelación con
   * penalización: la más normal de todas.
   *
   * El resultado, comprobado: un cliente que cancelaba con 10 horas de margen
   * recibía sus 100 de vuelta y la reserva se quedaba en «pagada a medias» con
   * 100 de saldo. El sistema creía que debía 100 de una excursión cancelada, y
   * el cron de cobranza se los reclamaba.
   *
   * La regla que lo arregla es una frase: una reserva muerta vale lo que el
   * cliente pagó y no se le devolvió. Con ella los cuatro casos cuadran, y
   * ninguno deja saldo. Eso es lo que se afirma aquí.
   */
  const casos = [
    { nombre: "sin pagar", paid: 0, horas: 240, pagos: [] as Record<string, unknown>[], retenido: 0 },
    { nombre: "reembolso total", paid: 200, horas: 240, retenido: 0,
      pagos: [{ amount: 200, payment_type: "payment" }] },
    { nombre: "reembolso parcial", paid: 200, horas: 10, retenido: 100,
      pagos: [{ amount: 200, payment_type: "payment" }] },
    { nombre: "sin derecho a reembolso", paid: 200, horas: 2, retenido: 200,
      pagos: [{ amount: 200, payment_type: "payment" }] },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: la orden queda a cero y vale lo retenido`, async () => {
      const b = vendida({
        paid_amount: caso.paid,
        balance_amount: 200 - caso.paid,
        status: caso.paid >= 200 ? "paid" : caso.paid > 0 ? "partially_paid" : "pending_payment",
        travel_date: new Date(Date.now() + caso.horas * 3_600_000).toISOString(),
      });
      db.seed("payment", caso.pagos.map((p, i) => ({
        _id: `pay-${i}`, order: "ord-1", booking: "res-1", status: "completed", ...p,
      })));

      await cancelBookingFully(ctx, b as never, {});

      const orden = db.row("order", { _id: "ord-1" })!;
      expect(Number(orden.total), "la orden vale lo que se retuvo").toBe(caso.retenido);
      expect(Number(orden.balance), "una orden cancelada no deja saldo").toBe(0);

      const reserva = db.row("booking", { _id: "res-1" })!;
      expect(TERMINAL_STATES, "el estado de la cancelación no se pisa").toContain(String(reserva.status));
      expect(Number(reserva.balance_amount), "a nadie se le reclama una excursión cancelada").toBe(0);
    });
  }

  it("lo retenido por una cancelada no se le regala a la reserva viva de al lado", async () => {
    // Repartir el cobrado entre todas daría por pagada a medias una reserva
    // viva con el dinero de otra que se cayó, y el cliente dejaría de recibir
    // el aviso de que todavía debe.
    const b = vendida();
    db.seed("booking", [{
      _id: "res-2", booking_number: "RSV-0002", order: "ord-1", customer: "cli-1",
      product: { _id: "prod-buggy" }, departure: "sal-saona",
      status: "pending_payment", pax_total: 1,
      total_amount: 200, paid_amount: 0, balance_amount: 200, refund_amount: 0, currency: "usd",
    }]);
    db.seed("payment", [{ _id: "pay-1", order: "ord-1", booking: "res-1",
      amount: 200, payment_type: "payment", status: "completed" }]);

    // La primera se cancela a última hora: la empresa retiene sus 200.
    const tarde = { ...b, travel_date: new Date(Date.now() + 2 * 3_600_000).toISOString() };
    db.tenantUpdate(ORG, "booking", "res-1", { travel_date: tarde.travel_date });
    await cancelBookingFully(ctx, tarde as never, {});

    const viva = db.row("booking", { _id: "res-2" })!;
    expect(Number(viva.paid_amount), "la reserva viva no ha pagado nada").toBe(0);
    expect(Number(viva.balance_amount)).toBe(200);
    expect(Number(db.row("order", { _id: "ord-1" })!.balance)).toBe(200);
  });
});

describe("el beneficio de MembeGo que llevaba esta reserva", () => {
  it("se devuelve nombrando LA RESERVA, no solo la venta", async () => {
    /**
     * Una orden puede llevar tres excursiones y caerse una sola. Sin el
     * identificador de la reserva, `reverseForOrder` barría todos los canjes de
     * la venta: el uso volvía al cliente, la línea que sigue viva recuperaba su
     * importe, y el total SUBÍA después de una cancelación.
     */
    const b = vendida();
    beneficioDevuelto.mockClear();
    await cancelBookingFully(ctx, b as never, { reason: "El cliente no viaja" });
    expect(beneficioDevuelto).toHaveBeenCalledTimes(1);
    const args = beneficioDevuelto.mock.calls[0] as unknown[];
    expect(args[0]).toBe(ORG);
    expect(args[1], "la venta").toBe("ord-1");
    expect(args[4], "la reserva que se cae no viajó").toBe("res-1");
  });
});
