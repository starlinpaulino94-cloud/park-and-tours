import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * LA ANALÍTICA CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las cuentas —cohortes, tasa de repetición, curva de anticipación, previsión—
 * viven en `analytics.ts` y están probadas. Aquí solo se lee, y en analítica
 * leer mal no da un error: da una conclusión de negocio equivocada con toda la
 * pinta de buena.
 *
 * Tres cosas que el módulo puro no puede ver:
 *
 *   · qué reservas entran —las canceladas inflarían la retención con gente que
 *     pidió y no viajó—;
 *   · de qué salidas se aprende la curva —las futuras están a medio vender y
 *     harían creer que la venta se desploma cerca de la fecha—;
 *   · y si el informe está recortado por el tope, que es justo lo que le pasa a
 *     la operadora grande, que es la que más lo necesita.
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import { cohortReport, pickupCurveOf, occupancyReport } from "@/lib/analytics-service";

const ORG = "org-1";
const AHORA = new Date("2026-09-15T12:00:00.000Z");
const dias = (n: number) => new Date(AHORA.getTime() + n * 86_400_000).toISOString();

const reserva = (over: Record<string, unknown>) => ({
  organization_id: ORG, status: "paid", total_amount: 100,
  adults: 2, children: 0, ...over,
});

beforeEach(() => {
  db = fakeDb();
  sb = fakeSupabase(db);
});

/* ═══════════════════════════════ cohortes ══════════════════════════════ */

describe("las cohortes de clientes", () => {
  it("agrupan por mes de primera compra y miden la repetición", async () => {
    db.seed("booking", [
      reserva({ _id: "b1", customer_id: "cli-1", booking_date: "2026-07-05T12:00:00.000Z" }),
      reserva({ _id: "b2", customer_id: "cli-1", booking_date: "2026-08-20T12:00:00.000Z" }),
      reserva({ _id: "b3", customer_id: "cli-2", booking_date: "2026-07-10T12:00:00.000Z" }),
    ]);
    const out = await cohortReport({ companyId: ORG, now: AHORA });
    expect(out.customers).toBe(2);
    expect(out.repeatRatePct, "uno de dos repitió").toBe(50);
    expect(out.averageCustomerValue).toBe(150);
    expect(out.truncated).toBe(false);
  });

  it("una reserva cancelada no cuenta como cliente", async () => {
    // Contarlas inflaría la retención con clientes que pidieron y no llegaron a
    // viajar.
    db.seed("booking", [
      reserva({ _id: "b1", customer_id: "cli-1", booking_date: "2026-08-01T12:00:00.000Z", status: "cancelled" }),
      reserva({ _id: "b2", customer_id: "cli-2", booking_date: "2026-08-02T12:00:00.000Z", status: "pending" }),
    ]);
    const out = await cohortReport({ companyId: ORG, now: AHORA });
    expect(out.customers).toBe(0);
  });

  it("una reserva sin cliente tampoco", async () => {
    db.seed("booking", [
      reserva({ _id: "b1", customer_id: null, booking_date: "2026-08-01T12:00:00.000Z" }),
    ]);
    expect((await cohortReport({ companyId: ORG, now: AHORA })).customers).toBe(0);
  });

  it("lo anterior al rango de meses se queda fuera", async () => {
    db.seed("booking", [
      reserva({ _id: "b-viejo", customer_id: "cli-1", booking_date: "2024-01-01T12:00:00.000Z" }),
      reserva({ _id: "b-nuevo", customer_id: "cli-2", booking_date: "2026-08-01T12:00:00.000Z" }),
    ]);
    const out = await cohortReport({ companyId: ORG, months: 3, now: AHORA });
    expect(out.customers).toBe(1);
  });

  it("UN INFORME RECORTADO LO DICE en vez de parecer completo", async () => {
    /**
     * El tope son cinco mil filas y el informe se presentaba como si fueran
     * todas. Es el peor sesgo posible para lo que mide: al quedarse con el
     * PRINCIPIO del rango, las segundas compras de esos mismos clientes son
     * justo las que se caen, así que la retención sale baja y parece un
     * problema de negocio.
     */
    db.seed("booking", Array.from({ length: 5000 }, (_, i) => reserva({
      _id: `b${i}`, customer_id: `cli-${i}`, booking_date: "2026-08-01T12:00:00.000Z",
    })));
    const out = await cohortReport({ companyId: ORG, now: AHORA });
    expect(out.truncated).toBe(true);
  });

  it("y un informe vacío por una lectura rota NO se da por bueno", async () => {
    // «Esta operadora no tiene clientes que repitan» es una conclusión de
    // negocio sacada de un hipo de la base.
    sb.breakReads("booking");
    await expect(cohortReport({ companyId: ORG, now: AHORA })).rejects.toThrow();
  });
});

/* ═══════════════════════ la curva de anticipación ══════════════════════ */

describe("la curva de anticipación", () => {
  const conHistoria = () => {
    db.seed("departure", [
      { _id: "sal-vieja", organization_id: ORG, product_id: "prod-1", departure_at: dias(-30) },
      { _id: "sal-futura", organization_id: ORG, product_id: "prod-1", departure_at: dias(10) },
    ]);
    db.seed("booking", [
      reserva({ _id: "b1", departure_id: "sal-vieja", booking_date: dias(-45), travel_date: dias(-30) }),
      reserva({ _id: "b2", departure_id: "sal-vieja", booking_date: dias(-32), travel_date: dias(-30) }),
      reserva({ _id: "b3", departure_id: "sal-futura", booking_date: dias(-5), travel_date: dias(10) }),
    ]);
  };

  it("se aprende SOLO de salidas ya ocurridas", async () => {
    // Las futuras están a medio vender: meterlas haría creer que la venta se
    // desploma cerca de la fecha.
    conHistoria();
    const { curve } = await pickupCurveOf(ORG, { now: AHORA });
    expect(curve.sample, "entró una salida que todavía no ha salido").toBe(1);
  });

  it("sin historia no se inventa una curva", async () => {
    const { curve, leads } = await pickupCurveOf(ORG, { now: AHORA });
    expect(curve.sample).toBe(0);
    expect(curve.share).toEqual([]);
    expect(leads).toBeTruthy();
  });

  it("se puede acotar a un producto", async () => {
    conHistoria();
    db.seed("departure", [
      { _id: "sal-otra", organization_id: ORG, product_id: "prod-2", departure_at: dias(-20) },
    ]);
    db.seed("booking", [
      reserva({ _id: "b4", departure_id: "sal-otra", booking_date: dias(-40), travel_date: dias(-20) }),
    ]);
    const { curve } = await pickupCurveOf(ORG, { productId: "prod-2", now: AHORA });
    expect(curve.sample).toBe(1);
  });

  it("y la distribución de anticipación sale de las reservas con fecha de viaje", async () => {
    conHistoria();
    const { leads } = await pickupCurveOf(ORG, { now: AHORA });
    expect(leads.some((b) => b.bookings > 0)).toBe(true);
    // Y solo con las de salidas pasadas: la reserva de la salida futura no
    // entra en la lista de identificadores que se consultan.
    expect(leads.reduce((n, b) => n + b.bookings, 0)).toBe(2);
  });
});

/* ════════════════════════════ la previsión ═════════════════════════════ */

describe("la previsión de ocupación", () => {
  const conSalidas = () => {
    db.seed("departure", [
      { _id: "sal-1", organization_id: ORG, product_id: "prod-1", departure_at: dias(20),
        capacity: 40, booked_pax: 10, pending_pax: 5, status: "available" },
      { _id: "sal-lejana", organization_id: ORG, product_id: "prod-1", departure_at: dias(200),
        capacity: 40, booked_pax: 0, pending_pax: 0, status: "available" },
      { _id: "sal-pasada", organization_id: ORG, product_id: "prod-1", departure_at: dias(-5),
        capacity: 40, booked_pax: 30, pending_pax: 0, status: "available" },
      { _id: "sal-cancelada", organization_id: ORG, product_id: "prod-1", departure_at: dias(15),
        capacity: 40, booked_pax: 0, pending_pax: 0, status: "cancelled" },
    ]);
    db.seed("product", [{ _id: "prod-1", organization_id: ORG, name: "Isla Saona" }]);
  };

  it("mira solo las futuras, dentro del horizonte y vivas", async () => {
    conSalidas();
    const out = await occupancyReport({ companyId: ORG, now: AHORA, horizonDays: 60 });
    expect(out.rows.map((r) => r.departureId)).toEqual(["sal-1"]);
  });

  it("LO VENDIDO ES LO CONFIRMADO MÁS LO PENDIENTE", async () => {
    // Una plaza retenida sigue ocupando el asiento: prever sin ella diría que
    // hay sitio de sobra.
    conSalidas();
    const out = await occupancyReport({ companyId: ORG, now: AHORA, horizonDays: 60 });
    expect(out.rows[0].soldSeats).toBe(15);
  });

  it("y cada fila lleva el nombre de su excursión", async () => {
    conSalidas();
    const out = await occupancyReport({ companyId: ORG, now: AHORA, horizonDays: 60 });
    expect(out.rows[0].product).toBe("Isla Saona");
  });

  it("una salida sin producto no rompe el informe", async () => {
    db.seed("departure", [
      { _id: "sal-x", organization_id: ORG, product_id: null, departure_at: dias(10),
        capacity: 20, booked_pax: 1, pending_pax: 0, status: "available" },
    ]);
    const out = await occupancyReport({ companyId: ORG, now: AHORA, horizonDays: 60 });
    expect(out.rows[0].product).toBe("");
  });

  it("sin salidas futuras, el informe está vacío y no es un error", async () => {
    const out = await occupancyReport({ companyId: ORG, now: AHORA });
    expect(out.rows).toEqual([]);
    expect(out.alerts).toEqual([]);
  });
});
