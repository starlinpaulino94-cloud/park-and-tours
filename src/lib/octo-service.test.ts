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

import { reserve, type OctoContext } from "@/lib/octo-service";

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

  it("si no se puede marcar como de OTA, tampoco se da por buena", async () => {
    // Una reserva sin `octo_uuid` es invisible para el revendedor: no la puede
    // consultar, ni confirmar, ni cancelar. Y sigue ocupando su plaza.
    sb.breakWrites("booking", "no se pudo marcar la reserva");
    await expect(reserve(ctx, reserva())).rejects.toThrow();
    const vivas = db.rows("booking").filter((b) => b.status !== "cancelled");
    expect(vivas).toEqual([]);
  });
});
