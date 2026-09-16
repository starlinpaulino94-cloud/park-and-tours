import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/tenant";
import type { AppRole } from "@/lib/auth";

/**
 * Lo que estas pruebas defienden no es que la fecha cambie —eso es una línea—,
 * es lo que rodea al cambio: que LAS DOS salidas recalculen su ocupación (si la
 * de origen no suelta la plaza, se vende de menos el resto del mes), que la
 * recogida se suelte de la ruta del día anterior (si no, el conductor de mañana
 * sigue pasando por ese hotel) y que forzar un límite de política sea una
 * decisión de gerencia y no del vendedor que tiene al cliente delante.
 */

const requireTenantWrite = vi.fn();
const tenantFindOne = vi.fn();
const tenantQuery = vi.fn();
const tenantUpdate = vi.fn();
const recalculateDeparture = vi.fn();
const writeAudit = vi.fn();
const notify = vi.fn();
const notifyBookingRescheduled = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    requireTenantWrite: (...a: unknown[]) => requireTenantWrite(...a),
    tenantFindOne: (...a: unknown[]) => tenantFindOne(...a),
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});
// `api-response` usa `OversellError` para traducir el 409: hay que conservarlo
// al simular el módulo, o el manejo de errores de la ruta revienta al fallar.
vi.mock("@/lib/availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/availability")>();
  return { ...actual, recalculateDeparture: (...a: unknown[]) => recalculateDeparture(...a) };
});
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
vi.mock("@/lib/notify-service", () => ({ notify: (...a: unknown[]) => notify(...a) }));
vi.mock("@/lib/messaging/events", () => ({
  notifyBookingRescheduled: (...a: unknown[]) => notifyBookingRescheduled(...a),
}));
vi.mock("@/lib/messaging/flush", () => ({ flushOutboxAfterResponse: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertSameOriginMutation: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), rateLimitKey: () => "k" }));

import { POST } from "./[id]/reschedule/route";
import { FORCEABLE_RESCHEDULE_BLOCKS } from "@/lib/reschedule";

const ctxOf = (role: AppRole): TenantContext & { companyId: string } => ({
  userId: "user-1", email: "v@x.com", name: "Vendedora", role,
  companyId: "org-1", partnerId: null, company: null,
});

const MANANA = new Date(Date.now() + 10 * 86_400_000).toISOString();
const PASADO = new Date(Date.now() + 20 * 86_400_000).toISOString();

const reserva = (over: Record<string, unknown> = {}) => ({
  _id: "b1", booking_number: "BK-1", status: "confirmed",
  travel_date: MANANA, pax_total: 2, reschedule_count: 0,
  product: { _id: "prod-1" },
  departure: { _id: "dep-1", cutoff_hours: 24 },
  ...over,
});

const salida = (over: Record<string, unknown> = {}) => ({
  _id: "dep-2", product: { _id: "prod-1" }, departure_at: PASADO, ...over,
});

const call = async (body: Record<string, unknown> = {}) => {
  const req = { json: async () => ({ departure_id: "dep-2", reason: "Lluvia", ...body }), headers: new Headers() } as unknown as NextRequest;
  const res = await POST(req, { params: Promise.resolve({ id: "b1" }) });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  requireTenantWrite.mockResolvedValue(ctxOf("seller"));
  tenantFindOne.mockImplementation(async (_o: string, table: string) =>
    table === "booking" ? reserva() : salida()
  );
  tenantQuery.mockResolvedValue([{ _id: "pick-1" }]);
  tenantUpdate.mockResolvedValue({});
  recalculateDeparture.mockResolvedValue({
    departureId: "dep-2", capacity: 20, bookedPax: 2, pendingPax: 0, availablePax: 18,
    status: "available", departureAt: PASADO, cutoffHours: 24,
  });
});

describe("mover la reserva", () => {
  it("cambia la fecha, cuenta el cambio y guarda de dónde viene", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);

    const patch = tenantUpdate.mock.calls.find((c) => c[1] === "booking")![3];
    expect(patch.departure).toBe("dep-2");
    expect(patch.travel_date).toBe(PASADO);
    expect(patch.previous_departure).toBe("dep-1");
    expect(patch.reschedule_count).toBe(1);
    expect(patch.reschedule_reason).toBe("Lluvia");
    // Y NO toca lo que el cliente tiene en la mano.
    expect(patch.booking_number).toBeUndefined();
    expect(patch.voucher_code).toBeUndefined();
    expect(body.data.rescheduled).toBe(true);
  });

  it("recalcula LAS DOS salidas", async () => {
    // Si la de origen no suelta la plaza, esa salida se vende de menos para
    // siempre y nadie lo nota hasta que el bus va medio vacío.
    await call();
    const recalculadas = recalculateDeparture.mock.calls.map((c) => c[1]);
    expect(recalculadas).toContain("dep-1");
    expect(recalculadas).toContain("dep-2");
  });

  it("suelta la recogida de la ruta del día anterior", async () => {
    // Si no, el conductor de mañana sigue pasando por ese hotel a buscar a
    // alguien que ya no va ese día.
    const { body } = await call();
    const pickupPatch = tenantUpdate.mock.calls.find((c) => c[1] === "pickup")!;
    expect(pickupPatch[3]).toEqual({ route: null, status: "pending" });
    expect(body.data.pickups_released).toBe(1);
  });

  it("avisa al cliente y a operaciones", async () => {
    await call();
    expect(notifyBookingRescheduled).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: "booking_rescheduled" }));
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "booking_rescheduled" }));
  });

  it("se puede pedir que NO se avise al cliente", async () => {
    // El caso real: la operadora ya habló con él por teléfono y un correo
    // automático después solo confunde.
    await call({ notify: false });
    expect(notifyBookingRescheduled).not.toHaveBeenCalled();
    // El aviso interno sí sale: operaciones tiene que verlo igual.
    expect(notify).toHaveBeenCalled();
  });

  it("sin motivo no se mueve", async () => {
    const { status } = await call({ reason: "  " });
    expect(status).toBe(400);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });
});

describe("lo que no deja hacer", () => {
  it("sin cupo no se mueve, y no lo levanta nadie", async () => {
    recalculateDeparture.mockResolvedValue({
      departureId: "dep-2", capacity: 20, bookedPax: 19, pendingPax: 0, availablePax: 1,
      status: "available", departureAt: PASADO, cutoffHours: 24,
    });
    const { status, body } = await call({ force: true });
    expect(status).toBe(409);
    expect(body.error.message).toMatch(/cupo/);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("a otro producto no: eso es una venta nueva", async () => {
    tenantFindOne.mockImplementation(async (_o: string, table: string) =>
      table === "booking" ? reserva() : salida({ product: { _id: "prod-9" } })
    );
    const { status, body } = await call({ force: true });
    expect(status).toBe(409);
    expect(body.error.message).toMatch(/otro producto/);
  });

  it("dentro del plazo avisa, y dice que se puede forzar", async () => {
    tenantFindOne.mockImplementation(async (_o: string, table: string) =>
      table === "booking"
        ? reserva({ travel_date: new Date(Date.now() + 3 * 3_600_000).toISOString() })
        : salida()
    );
    const { status, body } = await call();
    expect(status).toBe(409);
    // El motivo viaja en `code`: es lo único que el sobre de error conserva, y
    // con él la pantalla decide si ofrecer «forzar» usando la lista pura.
    expect(body.error.code).toBe("cutoff");
    expect(FORCEABLE_RESCHEDULE_BLOCKS).toContain(body.error.code);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("forzar el plazo es cosa de gerencia, no del vendedor", async () => {
    /**
     * Es la distinción que sostiene la función: un límite de política lo levanta
     * quien responde por él. Si lo levantara el vendedor, el plazo de cambios no
     * existiría en la práctica.
     */
    tenantFindOne.mockImplementation(async (_o: string, table: string) =>
      table === "booking"
        ? reserva({ travel_date: new Date(Date.now() + 3 * 3_600_000).toISOString() })
        : salida()
    );

    const rechazado = await call({ force: true });
    expect(rechazado.status).toBe(403);
    expect(tenantUpdate).not.toHaveBeenCalled();

    requireTenantWrite.mockResolvedValue(ctxOf("manager"));
    const aceptado = await call({ force: true });
    expect(aceptado.status).toBe(200);
    // Y queda marcado como forzado, no como un cambio normal.
    expect(writeAudit).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "warning" }));
  });

  it("una reserva cancelada no se mueve", async () => {
    tenantFindOne.mockImplementation(async (_o: string, table: string) =>
      table === "booking" ? reserva({ status: "cancelled" }) : salida()
    );
    expect((await call()).status).toBe(409);
  });
});
