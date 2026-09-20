import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * EL CONECTOR DE OTAs, DE PUNTA A PUNTA.
 *
 * Mil líneas por las que entran reservas de terceros y que no tenían ni una
 * prueba. Lo que hay aquí no es aritmética: es lo que le pasa a una guagua
 * cuando el revendedor reintenta, cuando confirma tarde, o cuando una escritura
 * falla y nadie mira el error.
 */

let db: FakeDb;
let sb: FakeSupabase;

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
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn(), notifyRoles: vi.fn() }));
vi.mock("@/lib/messaging/events", () => ({
  notifyBookingCreated: vi.fn(), notifyBookingCancelled: vi.fn(), notifyBalanceDue: vi.fn(),
}));
vi.mock("@/lib/attribution-service", () => ({
  resolveOrderAttribution: vi.fn(async () => null), recordTouch: vi.fn(), recordPurchaseOnce: vi.fn(),
}));
vi.mock("@/lib/ledger-events", () => ({ postPayment: vi.fn(), postSale: vi.fn() }));
vi.mock("@/lib/membego-redemption-service", () => ({ reverseForOrder: vi.fn(async () => []) }));

import {
  reserve, confirmBooking, extendBooking, cancelBooking, getBooking,
  sweepExpiredOctoHolds, markExpiredOctoHolds, type OctoContext,
} from "@/lib/octo-service";

const ORG = "org-1";
const ctx: OctoContext = {
  companyId: ORG,
  company: { _id: ORG, base_currency: "usd", timezone: "America/Santo_Domingo" } as never,
  partnerId: "soc-1",
  keyId: "key-1",
  capabilities: [],
};

const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

/**
 * Una operadora con un producto publicado y una salida con sitio.
 *
 * Cada fila lleva su `organization_id`, y no es decoración: el conector consulta
 * con la llave de SERVICIO, que se salta la RLS, así que el filtro por empresa
 * lo pone el código a mano en cada consulta. El doble lo respeta igual que
 * PostgREST — una prueba que sembrara filas sin empresa estaría comprobando un
 * camino que en producción no existe, y taparía justo la clase de fuga entre
 * inquilinos que hay que vigilar aquí.
 */
function catalogo() {
  return fakeDb({
    organizations: [{ _id: ORG, name: "Operadora", currency: "usd" }],
    partner: [{ _id: "soc-1", organization_id: ORG, name: "Caribe OTA", credit_limit: 0, credit_days: 0 }],
    product: [{
      _id: "prod-saona", organization_id: ORG, name: "Isla Saona", product_type: "tour",
      base_price: 100, base_cost: 40, status: "active", published: true, sort_order: 1,
    }],
    departure: [{
      _id: "sal-1", organization_id: ORG, product: "prod-saona", departure_at: futuro(5),
      capacity: 20, booked_pax: 0, pending_pax: 0, available_pax: 20,
      cutoff_hours: 0, status: "available",
    }],
  });
}

const reserva = (over: Record<string, unknown> = {}) => ({
  uuid: "11111111-1111-4111-8111-111111111111",
  productId: "prod-saona",
  optionId: "default",
  availabilityId: "sal-1",
  expirationMinutes: 30,
  notes: null,
  unitItems: [
    { uuid: "u1", unitId: "adult", resellerReference: null, contact: null },
    { uuid: "u2", unitId: "adult", resellerReference: null, contact: null },
  ],
  resellerReference: "OTA-REF-1",
  contact: { fullName: "Tom Sullivan", emailAddress: "tom@example.test", phoneNumber: "+1 617 555 0133" },
  ...over,
}) as Parameters<typeof reserve>[1];

beforeEach(() => {
  db = catalogo();
  sb = fakeSupabase(db);
});

describe("reservar una plaza desde una OTA", () => {
  it("crea la reserva, la marca como retenida y le pone su plazo", async () => {
    const res = await reserve(ctx, reserva());
    expect(res.repeated).toBe(false);

    const booking = db.rows("booking")[0];
    expect(booking.octo_status).toBe("ON_HOLD");
    expect(booking.octo_uuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(booking.channel).toBe("ota");

    const orden = db.rows("order")[0];
    expect(orden.hold_until, "sin plazo la plaza no la libera nadie").toBeTruthy();
    expect(Date.parse(String(orden.hold_until))).toBeGreaterThan(Date.now());
  });

  it("la plaza se aparta de verdad en la salida", async () => {
    await reserve(ctx, reserva());
    const salida = db.row("departure", { _id: "sal-1" })!;
    expect(Number(salida.pending_pax)).toBe(2);
    expect(Number(salida.available_pax)).toBe(18);
  });

  it("el mismo uuid dos veces devuelve la MISMA reserva, no otra", async () => {
    // Un revendedor reintenta cuando se le cae la conexión. Sin esto, cada
    // reintento apartaría otras plazas para el mismo pasajero.
    const primera = await reserve(ctx, reserva());
    const segunda = await reserve(ctx, reserva());
    expect(segunda.repeated).toBe(true);
    expect(segunda.booking.uuid).toBe(primera.booking.uuid);
    expect(db.rows("booking")).toHaveLength(1);
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax)).toBe(2);
  });

  it("un producto que no está publicado no se puede reservar", async () => {
    db.tenantUpdate(ORG, "product", "prod-saona", { published: false });
    await expect(reserve(ctx, reserva())).rejects.toThrow(/no está a la venta/i);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("una fecha que no existe se rechaza por su nombre", async () => {
    await expect(reserve(ctx, reserva({ availabilityId: "sal-inventada" })))
      .rejects.toThrow(/no existe para este producto/i);
  });

  it("un producto que se vende por fecha exige la fecha", async () => {
    // Reservar «para cualquier día» dejaría una reserva sin cupo comprobado y
    // sin manifiesto.
    await expect(reserve(ctx, reserva({ availabilityId: null })))
      .rejects.toThrow(/manda el availabilityId/i);
  });

  it("una salida cerrada ya no admite reservas", async () => {
    db.tenantUpdate(ORG, "departure", "sal-1", { status: "cancelled" });
    await expect(reserve(ctx, reserva())).rejects.toThrow(/ya no admite reservas/i);
  });

  it("registra al cliente del revendedor con los datos del contacto", async () => {
    await reserve(ctx, reserva());
    const cliente = db.rows("customer")[0];
    expect(cliente, "sin cliente no hay a quién emitir el voucher").toBeTruthy();
    expect(String(cliente.email)).toBe("tom@example.test");
  });
});

describe("cuando la base rechaza una escritura", () => {
  it("una retención SIN PLAZO no puede darse por buena", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * EL PLAZO SE ESCRIBÍA EN SEGUNDO LUGAR Y SIN MIRAR SI HABÍA FALLADO
     *
     * De nueve escrituras del conector, solo una comprobaba su error. La peor
     * era esta: `update({ hold_until })` sobre la venta.
     *
     * Si falla, `hold_until` se queda nulo. Y el barrido que libera plazas
     * filtra por `hold_until < ahora`: un nulo NUNCA cumple esa condición, en
     * PostgREST igual que en Postgres. Así que la plaza queda retenida para
     * siempre, el revendedor recibe una reserva que parece correcta, y la
     * excursión sale con asientos vacíos que el sistema daba por vendidos.
     *
     * Devolver éxito con una reserva que no puede caducar es peor que fallar.
     */
    sb.breakWrites("sales_order", "no se pudo escribir la retención");

    await expect(
      reserve(ctx, reserva()),
      "una reserva sin plazo tiene que fallar, no colarse"
    ).rejects.toThrow();

    // Y la plaza no se queda apartada por una reserva que nadie va a liberar.
    const vivas = db.rows("booking").filter((b) => b.status !== "cancelled");
    expect(vivas, "no puede quedar una reserva viva sin plazo").toEqual([]);
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax)).toBe(0);
  });

  it("confirmar a medias no deja una venta cerrada que el barrido cancele", async () => {
    /**
     * El orden de las dos escrituras de `confirmBooking` es el que decide qué
     * queda si la segunda falla.
     *
     * Confirmando la reserva primero, quedaría una reserva CONFIRMADA cuya
     * venta sigue en `pending_payment` con el plazo corriendo — y el barrido de
     * retenciones vencidas la cancela sola: una venta cerrada que se cae sin
     * que nadie lo pida. Por eso primero se para el plazo: si lo segundo falla,
     * la reserva sigue retenida y el reintento la termina.
     */
    const { booking } = await reserve(ctx, reserva());
    sb.breakWrites("sales_order", "la base rechazó la escritura");

    await expect(confirmBooking(ctx, booking.uuid, {})).rejects.toThrow();
    const fila = db.rows("booking")[0];
    expect(fila.status, "sin poder parar el plazo, la reserva NO se confirma").not.toBe("confirmed");
    expect(fila.octo_status).toBe("ON_HOLD");
  });

  it("si no se pueden leer las salidas, NO se reserva «para cualquier día»", async () => {
    /**
     * `hasDepartures` decide si el producto se vende por fecha. Con el error
     * tragado devuelve un conjunto vacío, que significa «no se vende por
     * fecha», y la reserva entra sin salida: sin cupo comprobado, sin
     * manifiesto y sin nadie esperándola en el punto de encuentro.
     *
     * Una lectura rota tiene que contestar 500, no inventarse un producto sin
     * fechas.
     */
    sb.breakReads("departure", "la base rechazó la lectura");
    await expect(reserve(ctx, reserva({ availabilityId: null }))).rejects.toThrow();
    expect(db.rows("booking"), "no puede quedar una reserva sin salida").toHaveLength(0);
  });

  it("si no se puede marcar EXPIRED, el barrido NO suelta la plaza", async () => {
    // Soltarla sin marcar le contaría al revendedor una CANCELACIÓN —incidencia
    // con reembolso que decidir— en vez de un vencimiento, que es suyo por no
    // pagar a tiempo. La plaza se suelta en el barrido siguiente.
    await reserve(ctx, reserva());
    db.tenantUpdate(ORG, "order", String(db.rows("order")[0]._id), { hold_until: "2020-01-01T00:00:00.000Z" });
    sb.breakWrites("booking", "la base rechazó la escritura");

    expect(await sweepExpiredOctoHolds(ORG)).toBe(0);
    const fila = db.rows("booking")[0];
    expect(fila.status, "sin marca de vencida, no se cancela nada").not.toBe("cancelled");
    expect(fila.octo_status).toBe("ON_HOLD");
  });

  it("si no se puede marcar como de OTA, tampoco se da por buena", async () => {
    // Una reserva sin `octo_uuid` es invisible para el revendedor: no la puede
    // consultar, ni confirmar, ni cancelar. Y sigue ocupando su plaza.
    sb.breakWrites("booking", "no se pudo marcar la reserva");
    await expect(reserve(ctx, reserva())).rejects.toThrow();
    const vivas = db.rows("booking").filter((b) => b.status !== "cancelled");
    expect(vivas).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════ confirmar ══ */

describe("confirmar la retención", () => {
  it("cierra la venta y PARA el plazo", async () => {
    const { booking } = await reserve(ctx, reserva());
    const vista = await confirmBooking(ctx, booking.uuid, { resellerReference: "OTA-REF-1", contact: null });

    expect(vista.status).toBe("CONFIRMED");
    const fila = db.rows("booking")[0];
    expect(fila.status).toBe("confirmed");
    expect(fila.octo_status).toBe("CONFIRMED");
    expect(fila.octo_confirmed_at, "sin la hora no hay con qué reclamar").toBeTruthy();

    // Y sobre todo: la plaza ya no se libera sola.
    const orden = db.rows("order")[0];
    expect(orden.hold_until, "una venta cerrada con el plazo corriendo se cancela sola").toBeFalsy();
    // La venta sigue pendiente de cobro, que es la verdad: el revendedor
    // liquida a fin de mes. Ese estado lo fija el dinero (`syncOrderTotals`),
    // no el conector.
    expect(orden.status).toBe("pending_payment");
  });

  it("confirmar dos veces contesta lo mismo y no cobra dos veces", async () => {
    const { booking } = await reserve(ctx, reserva());
    const primera = await confirmBooking(ctx, booking.uuid, {});
    const segunda = await confirmBooking(ctx, booking.uuid, {});
    expect(segunda.status).toBe("CONFIRMED");
    expect(segunda.supplierReference).toBe(primera.supplierReference);
    expect(db.rows("booking")).toHaveLength(1);
  });

  it("confirmar repara una confirmación que se quedó a medias", async () => {
    /**
     * El caso: la reserva quedó confirmada y la venta se quedó con su plazo
     * corriendo. El barrido de vencidas cancelaría una venta YA cerrada, que es
     * el peor final posible. El reintento del revendedor tiene que arreglarlo.
     */
    const { booking } = await reserve(ctx, reserva());
    await confirmBooking(ctx, booking.uuid, {});
    const orden = db.rows("order")[0];
    db.tenantUpdate(ORG, "order", String(orden._id), { hold_until: futuro(1), status: "pending_payment" });

    await confirmBooking(ctx, booking.uuid, {});
    expect(db.rows("order")[0].hold_until).toBeFalsy();
  });

  it("una retención VENCIDA ya no se puede confirmar", async () => {
    // La plaza volvió a la venta y puede haberla comprado otro: decir que sí y
    // no tener asiento en el punto de encuentro es peor que negarse ahora.
    const { booking } = await reserve(ctx, reserva());
    const orden = db.rows("order")[0];
    db.tenantUpdate(ORG, "order", String(orden._id), { hold_until: "2020-01-01T00:00:00.000Z" });

    await expect(confirmBooking(ctx, booking.uuid, {})).rejects.toThrow();
    expect(db.rows("booking")[0].status).not.toBe("confirmed");
  });
});

/* ═════════════════════════════════════════════════════════ prorrogar ══ */

describe("prorrogar la retención", () => {
  it("mueve el plazo hacia adelante", async () => {
    const { booking } = await reserve(ctx, reserva());
    const antes = String(db.rows("order")[0].hold_until);
    await extendBooking(ctx, booking.uuid, 60);
    const despues = String(db.rows("order")[0].hold_until);
    expect(Date.parse(despues)).toBeGreaterThan(Date.parse(antes));
  });

  it("no pasa del máximo que fija la operadora", async () => {
    // El revendedor pide lo que le conviene; el techo lo pone quien tiene las
    // plazas. Sin tope, una OTA retiene una guagua entera una semana.
    const conTope: OctoContext = { ...ctx, company: { ...ctx.company, octo_max_hold_minutes: 45 } as never };
    const { booking } = await reserve(conTope, reserva());
    await extendBooking(conTope, booking.uuid, 10_000);
    const plazo = Date.parse(String(db.rows("order")[0].hold_until));
    expect(plazo).toBeLessThanOrEqual(Date.now() + 46 * 60_000);
  });

  it("una retención vencida no se prorroga", async () => {
    const { booking } = await reserve(ctx, reserva());
    db.tenantUpdate(ORG, "order", String(db.rows("order")[0]._id), { hold_until: "2020-01-01T00:00:00.000Z" });
    await expect(extendBooking(ctx, booking.uuid, 60)).rejects.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════ cancelar ══ */

describe("cancelar", () => {
  it("devuelve la plaza a la salida", async () => {
    const { booking } = await reserve(ctx, reserva());
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax)).toBe(2);

    const vista = await cancelBooking(ctx, booking.uuid, { reason: "El cliente no viaja" });
    expect(vista.status).toBe("CANCELLED");

    const fila = db.rows("booking")[0];
    expect(fila.status).toBe("cancelled");
    expect(fila.octo_status).toBe("CANCELLED");
    const salida = db.row("departure", { _id: "sal-1" })!;
    expect(Number(salida.pending_pax), "la plaza tiene que volver a la venta").toBe(0);
    expect(Number(salida.available_pax)).toBe(20);
  });

  it("cancelar dos veces contesta lo mismo y no devuelve el dinero dos veces", async () => {
    const { booking } = await reserve(ctx, reserva());
    await cancelBooking(ctx, booking.uuid, { reason: null });
    const segunda = await cancelBooking(ctx, booking.uuid, { reason: null });
    expect(segunda.status).toBe("CANCELLED");
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════ barrido ══ */

describe("el barrido de retenciones vencidas", () => {
  const vencer = () =>
    db.tenantUpdate(ORG, "order", String(db.rows("order")[0]._id), { hold_until: "2020-01-01T00:00:00.000Z" });

  it("marca EXPIRED y SUELTA la plaza", async () => {
    await reserve(ctx, reserva());
    await vencer();

    const marcadas = await sweepExpiredOctoHolds(ORG);
    expect(marcadas).toBe(1);
    expect(db.rows("booking")[0].octo_status).toBe("EXPIRED");
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax), "la plaza no puede quedarse apartada").toBe(0);
  });

  it("el revendedor lee EXPIRED, no CANCELLED", async () => {
    /**
     * No es cosmético. CANCELLED es una incidencia que la OTA atiende, con un
     * reembolso que decidir; EXPIRED es suyo por no haber pagado a tiempo. Por
     * eso se marca ANTES de soltar la plaza: al revés, la cancelación pisaría
     * la marca y la reserva llegaría al revendedor como una cancelación
     * nuestra.
     */
    const { booking } = await reserve(ctx, reserva());
    await vencer();
    await sweepExpiredOctoHolds(ORG);

    const vista = await getBooking(ctx, booking.uuid);
    expect(vista.status).toBe("EXPIRED");
  });

  it("una retención con plazo POR VENIR no se toca", async () => {
    await reserve(ctx, reserva());
    expect(await markExpiredOctoHolds(ORG)).toBe(0);
    expect(db.rows("booking")[0].octo_status).toBe("ON_HOLD");
    expect(Number(db.row("departure", { _id: "sal-1" })!.pending_pax)).toBe(2);
  });

  it("no toca las reservas de OTRA empresa", async () => {
    // El conector usa la llave de servicio, que se salta la RLS: el filtro por
    // empresa lo pone el código a mano, y si se cae no lo dice nadie.
    await reserve(ctx, reserva());
    await vencer();
    expect(await markExpiredOctoHolds("org-vecina")).toBe(0);
    expect(db.rows("booking")[0].octo_status).toBe("ON_HOLD");
  });
});

/* ════════════════════════════════════════════════ entre revendedores ══ */

describe("un revendedor no ve lo del otro", () => {
  it("el uuid de una OTA no le sirve a la de al lado", async () => {
    // Sin el filtro por socio bastaría con adivinar un uuid para leer el nombre
    // y el teléfono del cliente de la competencia.
    const { booking } = await reserve(ctx, reserva());
    const otra: OctoContext = { ...ctx, partnerId: "soc-2", keyId: "key-2" };
    await expect(getBooking(otra, booking.uuid)).rejects.toThrow(/ninguna reserva con ese uuid/i);
  });

  it("tampoco la puede cancelar", async () => {
    const { booking } = await reserve(ctx, reserva());
    const otra: OctoContext = { ...ctx, partnerId: "soc-2", keyId: "key-2" };
    await expect(cancelBooking(otra, booking.uuid, { reason: null })).rejects.toThrow();
    expect(db.rows("booking")[0].status).not.toBe("cancelled");
  });
});
