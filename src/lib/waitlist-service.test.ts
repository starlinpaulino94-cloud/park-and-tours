import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb, paxTotalsDeLaBase } from "@/test/fake-tenant";

/**
 * LA LISTA DE ESPERA, DE PUNTA A PUNTA.
 *
 * Lo que se comprueba aquí es el bucle entero contra una base con memoria:
 * alguien se apunta, otro cancela, y la plaza que se libera acaba siendo una
 * reserva de verdad a nombre del que llevaba esperando. Sin eso, la lista sería
 * una libreta bonita.
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
/**
 * El recuento de pasajeros es una función de Postgres desde 0094, y aquí no hay
 * Postgres. Se reimplementa sobre la misma base en memoria: falsearlo con una
 * constante haría pasar en verde la prueba de que la plaza vuelve a la salida,
 * porque ese número ES el cupo.
 */
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    rpc: async (nombre: string, args: Record<string, unknown>) =>
      nombre === "departure_pax_totals" ? paxTotalsDeLaBase(db)(args) : { data: null, error: null },
  }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
const aviso = vi.fn();
vi.mock("@/lib/notify-service", () => ({ notify: (...a: unknown[]) => aviso(...a), notifyRoles: vi.fn() }));
vi.mock("@/lib/messaging/events", () => ({
  notifyBookingCreated: vi.fn(), notifyBookingCancelled: vi.fn(), notifyBalanceDue: vi.fn(),
}));
vi.mock("@/lib/attribution-service", () => ({
  resolveOrderAttribution: vi.fn(async () => null), recordTouch: vi.fn(), recordPurchaseOnce: vi.fn(),
}));
vi.mock("@/lib/ledger-events", () => ({ postPayment: vi.fn(), postSale: vi.fn() }));
vi.mock("@/lib/membego-redemption-service", () => ({ reverseForOrder: vi.fn(async () => []) }));

import {
  joinWaitlist, leaveWaitlist, offerFreedSeats, expireOffers,
  markConvertedByBooking, refreshWaitlistCount, loadWaitlist,
} from "@/lib/waitlist-service";
import { cancelBookingFully } from "@/lib/booking-cancel-service";

const ORG = "org-1";
const ctx = {
  companyId: ORG, userId: "user-1", role: "manager", branchId: null,
  company: { _id: ORG, base_currency: "usd" },
} as unknown as Parameters<typeof joinWaitlist>[0];

const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

/** Saona con 4 plazas, 4 vendidas: llena. */
function saonaLlena() {
  return fakeDb({
    product: [{ _id: "prod-saona", name: "Isla Saona", base_price: 100, base_cost: 40, status: "active" }],
    departure: [{ _id: "sal-saona", product: "prod-saona", departure_at: futuro(5),
      capacity: 4, booked_pax: 4, pending_pax: 0, waitlist_pax: 0, cutoff_hours: 0, status: "full" }],
    customer: [{ _id: "cli-1", first_name: "Laura", last_name: "Gutiérrez", phone: "+1 809 111" }],
    order: [{ _id: "ord-1", total: 400, paid_total: 400, balance: 0, currency: "usd", status: "paid" }],
    booking: [{ _id: "res-1", booking_number: "RSV-0001", order: "ord-1", customer: "cli-1",
      product: { _id: "prod-saona", name: "Isla Saona" }, departure: "sal-saona",
      status: "paid", pax_total: 4, adults: 4,
      total_amount: 400, paid_amount: 400, balance_amount: 0, refund_amount: 0,
      currency: "usd", travel_date: futuro(5) }],
  });
}

beforeEach(() => { aviso.mockReset(); db = saonaLlena(); });

describe("apuntarse", () => {
  it("una espera de mostrador entra con solo un teléfono", async () => {
    const e = await joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 2,
      contact_name: "Michael Brennan", contact_phone: "+1 809 555 0101",
    });
    expect(e.status).toBe("waiting");
    expect(db.rows("waitlist_entry")).toHaveLength(1);
  });

  it("sin forma de avisar no se apunta a nadie", async () => {
    await expect(joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 2, contact_name: "Nadie",
    })).rejects.toThrow(/a quién avisar/i);
    expect(db.rows("waitlist_entry")).toHaveLength(0);
  });

  it("una espera de cero personas no es una espera", async () => {
    await expect(joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 0, contact_phone: "+1 809 555 0101",
    })).rejects.toThrow(/al menos una persona/i);
  });

  it("a una salida que no existe no se apunta nadie", async () => {
    await expect(joinWaitlist(ctx, {
      departure_id: "inventada", pax: 2, contact_phone: "+1 809 555 0101",
    })).rejects.toThrow(/no encontrada/i);
  });

  it("la salida pasa a decir cuánta gente espera", async () => {
    // `waitlist_pax` existía desde 0030 escrito a cero. Esto es lo que lo
    // convierte en un dato.
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 3, contact_phone: "+1 809 1" });
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 2" });
    expect(Number(db.row("departure", { _id: "sal-saona" })!.waitlist_pax)).toBe(5);
  });

  it("darse de baja saca a esa persona de la cuenta", async () => {
    const e = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 3, contact_phone: "+1 809 1" });
    await leaveWaitlist(ctx, String(e._id), "Ya compró en otro sitio");
    expect(Number(db.row("departure", { _id: "sal-saona" })!.waitlist_pax)).toBe(0);
    expect(db.row("waitlist_entry", { _id: e._id })!.status).toBe("cancelled");
  });

  it("también se apunta quien prefiere una salida que hoy tiene sitio", async () => {
    // Negarle la cola a un cliente porque «todavía cabe» le obliga a volver a
    // llamar mañana, que es cuando ya no cabrá.
    db.tenantUpdate(ORG, "departure", "sal-saona", { capacity: 40 });
    const e = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    expect(e.status).toBe("waiting");
  });
});

describe("cuando se libera una plaza", () => {
  it("la salida llena no ofrece nada", async () => {
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    const r = await offerFreedSeats(ctx, "sal-saona");
    expect(r.offered).toEqual([]);
    expect(r.freeSeats).toBe(0);
  });

  it("la plaza liberada se convierte en una reserva de verdad, no en un aviso", async () => {
    /**
     * Es LA decisión del módulo. Entre un aviso y la llamada del cliente,
     * cualquiera compra ese asiento en el mostrador y el cliente llega habiendo
     * sido avisado de algo que ya no existe.
     */
    const espera = await joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 2,
      contact_name: "Michael Brennan", contact_phone: "+1 809 555 0101",
    });

    // Alguien cancela: se sueltan 4 plazas.
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});

    const actualizada = db.row("waitlist_entry", { _id: espera._id })!;
    expect(actualizada.status, "la espera tiene que quedar ofrecida").toBe("offered");
    expect(actualizada.booking, "y con una reserva de verdad detrás").toBeTruthy();
    expect(actualizada.offer_expires_at, "y con un plazo").toBeTruthy();

    const reserva = db.row("booking", { _id: actualizada.booking })!;
    expect(Number(reserva.pax_total)).toBe(2);
    expect(reserva.status).toBe("pending_payment");
  });

  it("la plaza ofrecida deja de estar disponible para el mostrador", async () => {
    // Si no, se le promete a dos personas el mismo asiento.
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});
    const salida = db.row("departure", { _id: "sal-saona" })!;
    expect(Number(salida.pending_pax)).toBe(2);
    expect(Number(salida.available_pax)).toBe(2);
  });

  it("la oferta caduca, y nunca después de la salida", async () => {
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});
    const e = db.rows("waitlist_entry")[0];
    const vence = Date.parse(String(e.offer_expires_at));
    expect(vence).toBeGreaterThan(Date.now());
    expect(vence).toBeLessThanOrEqual(Date.parse(futuro(5)));
    // Y la orden lleva esa misma retención, que es lo que la caduca sola.
    const orden = db.rows("order").find((o) => o.hold_until);
    expect(orden, "sin retención la plaza quedaría guardada para siempre").toBeTruthy();
    expect(orden!.hold_until).toBe(e.offer_expires_at);
  });

  it("una espera de mostrador estrena ficha de cliente al aceptar", async () => {
    // Exigir la ficha al apuntarse habría convertido un gesto de diez segundos
    // en un alta; aquí ya tiene una reserva a su nombre.
    await joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 2,
      contact_name: "Michael Brennan", contact_phone: "+1 809 555 0101",
    });
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});
    const nuevo = db.rows("customer").find((c) => c.first_name === "Michael");
    expect(nuevo, "quien acepta una plaza deja de ser un teléfono en una libreta").toBeTruthy();
    expect(nuevo!.last_name).toBe("Brennan");
    expect(nuevo!.phone).toBe("+1 809 555 0101");
  });

  it("respeta el orden y se salta a quien no cabe", async () => {
    const familia = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 6, contact_phone: "+1 809 1" });
    const pareja = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 2" });
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});

    expect(db.row("waitlist_entry", { _id: familia._id })!.status,
      "una familia de seis no cabe en cuatro plazas y se queda en la cola").toBe("waiting");
    expect(db.row("waitlist_entry", { _id: pareja._id })!.status).toBe("offered");
  });

  it("avisa al mostrador de que hay alguien a quien llamar", async () => {
    await joinWaitlist(ctx, {
      departure_id: "sal-saona", pax: 2, contact_name: "Michael", contact_phone: "+1 809 555 0101",
    });
    await cancelBookingFully(ctx, db.row("booking", { _id: "res-1" })! as never, {});
    const eventos = aviso.mock.calls.map((c) => (c[0] as { event?: string }).event);
    expect(eventos).toContain("waitlist_offer");
  });

  it("una salida sin límite de plazas no ofrece nada", async () => {
    // Capacidad 0 es «sin límite»: nunca faltaron plazas, así que no hay
    // ninguna que liberar. Lo garantiza la propia fórmula de disponibilidad
    // —`max(0, capacity − booked − pending)` vale 0 con capacidad 0— y esta
    // prueba es la que lo deja escrito.
    db.tenantUpdate(ORG, "departure", "sal-saona", { capacity: 0 });
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    const r = await offerFreedSeats(ctx, "sal-saona");
    expect(r.offered).toEqual([]);
    expect(r.freeSeats).toBe(0);
  });

  it("que la lista falle no deshace la cancelación", async () => {
    /**
     * El cliente ya tiene su cancelación confirmada y su dinero devuelto.
     *
     * Se hace fallar a la lista de verdad —lanzando— y solo a la lista. Dos
     * intentos anteriores no servían: con la salida sin producto,
     * `offerFreedSeats` devuelve un problema por escrito en vez de lanzar, así
     * que el `catch` no se ejercitaba; y borrando la salida entera reventaba
     * ANTES, en el `recalculateDeparture` que la propia cancelación hace para
     * soltar la plaza, que no está dentro de ningún intento.
     */
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    const reserva = db.row("booking", { _id: "res-1" })!;
    const original = db.tenantQuery;
    db.tenantQuery = ((org: string, tabla: string, opts?: Record<string, unknown>) => {
      if (tabla === "waitlist_entry") return Promise.reject(new Error("la base de la lista se cayó"));
      return original(org, tabla, opts);
    }) as typeof db.tenantQuery;
    await expect(cancelBookingFully(ctx, reserva as never, {})).resolves.toBeTruthy();
    db.tenantQuery = original;
    // Queda `cancelled` y no `refunded` porque esta reserva no tiene política:
    // lo que importa aquí es que la cancelación LLEGÓ A SU FINAL pese al fallo
    // de la lista, no cuánto se devolvió.
    expect(["cancelled", "refunded", "partially_refunded"])
      .toContain(String(db.row("booking", { _id: "res-1" })!.status));
    expect(Number(db.row("booking", { _id: "res-1" })!.balance_amount)).toBe(0);
  });
});

describe("la oferta que nadie contesta", () => {
  it("se marca vencida y devuelve su salida para volver a ofrecer", async () => {
    const e = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    db.tenantUpdate(ORG, "waitlist_entry", String(e._id), {
      status: "offered", offer_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await expireOffers(ORG);
    expect(r.expired).toBe(1);
    expect(r.departures).toEqual(["sal-saona"]);
    expect(db.row("waitlist_entry", { _id: e._id })!.status).toBe("expired");
  });

  it("una oferta en plazo no se toca", async () => {
    const e = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    db.tenantUpdate(ORG, "waitlist_entry", String(e._id), {
      status: "offered", offer_expires_at: futuro(1),
    });
    expect((await expireOffers(ORG)).expired).toBe(0);
  });
});

describe("cuánta venta recuperó la lista", () => {
  it("una espera se da por convertida cuando su reserva cobra", async () => {
    const e = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 1" });
    db.tenantUpdate(ORG, "waitlist_entry", String(e._id), { status: "offered", booking: "res-9" });
    expect(await markConvertedByBooking(ORG, "res-9")).toBe(true);
    expect(db.row("waitlist_entry", { _id: e._id })!.status).toBe("converted");
  });

  it("una reserva que no salió de la lista no convierte nada", async () => {
    expect(await markConvertedByBooking(ORG, "res-1")).toBe(false);
  });

  it("el resumen dice qué espera y qué se recuperó", async () => {
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 3, contact_phone: "+1 809 1" });
    const b = await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 2, contact_phone: "+1 809 2" });
    db.tenantUpdate(ORG, "waitlist_entry", String(b._id), { status: "converted" });

    const payload = await loadWaitlist(ORG, "sal-saona");
    expect(payload.summary.waiting).toBe(1);
    expect(payload.summary.waitingPax).toBe(3);
    expect(payload.summary.converted).toBe(1);
    expect(payload.summary.convertedPax).toBe(2);
    expect(payload.queue).toHaveLength(1);
  });

  it("el contador de la salida se puede recalcular solo", async () => {
    await joinWaitlist(ctx, { departure_id: "sal-saona", pax: 3, contact_phone: "+1 809 1" });
    db.tenantUpdate(ORG, "departure", "sal-saona", { waitlist_pax: 99 });
    expect(await refreshWaitlistCount(ORG, "sal-saona")).toBe(3);
    expect(Number(db.row("departure", { _id: "sal-saona" })!.waitlist_pax)).toBe(3);
  });
});
