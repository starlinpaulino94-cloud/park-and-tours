import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";
import type { EvaluateResult, EvaluatedBenefit } from "@/lib/membego-benefits";

/**
 * EL CANJE DE MEMBEGO CONTRA LA BASE, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las reglas de qué se puede canjear viven en `membego-benefits.ts` y están
 * probadas. Lo que decide ESTE fichero es otra cosa, y es la que cuesta dinero:
 *
 *   · de dónde sale el beneficio con el que se canjea —de MembeGo o del cuerpo
 *     de la petición—;
 *   · sobre qué línea se aplica cuando el cajero elige una;
 *   · qué se escribe cuando MembeGo dijo sí y la base dijo no;
 *   · y qué se devuelve cuando se cae UNA reserva de una venta de tres.
 *
 * Ninguna de las cuatro se ve en el módulo puro, porque las cuatro son sobre el
 * orden y las fuentes, no sobre la aritmética.
 */

let db: FakeDb;
let sb: FakeSupabase;

/** Lo que MembeGo contesta a `evaluateBenefits`, controlado desde cada prueba. */
let evaluacion: EvaluateResult;
let evaluacionFalla: Error | null = null;

const membresiaCanjeada = vi.fn(async () => ({
  redemptionId: "mb-red-1", visitId: "v-1", codigo: "COD-1", ticketNumero: "T-1",
  customerId: "cli-mb", companyId: "emp-mb", servicio: "Isla Saona",
  usesLeft: 2, unlimited: false, redeemedAt: "2026-09-25T12:00:00.000Z",
}));
const promocionCanjeada = vi.fn(async () => ({
  redemptionId: "mb-promo-1", promotion: "10%", usesLeft: 1, consumed: true,
  redeemedAt: "2026-09-25T12:00:00.000Z",
}));
const reversaPedida = vi.fn(async () => ({
  visitId: "v-1", membershipId: "m-1", customerId: "cli-mb", companyId: "emp-mb",
  usesLeft: 3, applied: true, reversedAt: "2026-09-25T13:00:00.000Z",
}));

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

const auditado = vi.fn();
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditado(...a) }));

const totalesRecalculados = vi.fn();
vi.mock("@/lib/booking-service", () => ({
  syncOrderTotals: (...a: unknown[]) => totalesRecalculados(...a),
}));

vi.mock("@/lib/membego-platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/membego-platform")>();
  return {
    ...actual,
    platformConfigured: () => true,
    evaluateBenefits: async () => {
      if (evaluacionFalla) throw evaluacionFalla;
      return evaluacion;
    },
    redeemMembership: () => membresiaCanjeada(),
    redeemPromotion: () => promocionCanjeada(),
    reverseRedemption: () => reversaPedida(),
  };
});

import {
  redeemForOrder, reverseForOrder, benefitsForCustomer, membegoContext,
  membegoClienteIdOf, redemptionsOfOrder,
} from "@/lib/membego-redemption-service";

const ORG = "org-1";
const ORDEN = "ord-1";
const ctx = { companyId: ORG, userId: "usr-1" } as never;

/** Una membresía elegible: cubre el servicio, o sea la línea entera. */
const MEMBRESIA: EvaluatedBenefit = {
  type: "MEMBERSHIP", id: "m-1", nombre: "Plan Oro", eligible: true,
  usesLeft: 3, expiresAt: null, reason: null, coverage: null,
};

/** Una promoción elegible del 10 %: es MembeGo quien dice que es del 10 %. */
const PROMOCION: EvaluatedBenefit = {
  type: "PROMOTION", id: "p-1", nombre: "10 % en excursiones", eligible: true,
  usesLeft: 1, expiresAt: null, reason: null, coverage: null,
  effect: { kind: "PERCENT", value: 10, label: "10 %" },
};

const conBeneficios = (...benefits: EvaluatedBenefit[]): EvaluateResult => ({
  customerId: "cli-mb", companyId: "emp-mb", eligible: true, benefits,
  evaluatedAt: new Date().toISOString(), reserved: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
  sb = fakeSupabase(db);
  evaluacionFalla = null;
  evaluacion = conBeneficios(MEMBRESIA, PROMOCION);

  db.seed("organizations", [{ _id: ORG, name: "Tours del Este", organization_id: ORG }]);
  db.seed("membego_link", [
    { _id: "lnk-1", organization_id: ORG, membego_company_id: "emp-mb", status: "active" },
  ]);
  db.seed("membego_customer", [
    { _id: "mc-1", organization_id: ORG, customer_id: "cli-1", membego_cliente_id: "cli-mb" },
  ]);
  db.seed("sales_order", [
    { _id: ORDEN, organization_id: ORG, status: "pending_payment", currency: "usd", customer_id: "cli-1", total: 180 },
  ]);
  db.seed("product", [
    { _id: "prod-1", organization_id: ORG, name: "Isla Saona" },
    { _id: "prod-2", organization_id: ORG, name: "Hoyo Azul" },
  ]);
  db.seed("booking", [
    {
      _id: "bk-cara", organization_id: ORG, order: ORDEN, product: "prod-1",
      status: "confirmed", total_amount: 120, discount_amount: 0,
    },
    {
      _id: "bk-barata", organization_id: ORG, order: ORDEN, product: "prod-2",
      status: "confirmed", total_amount: 60, discount_amount: 0,
    },
  ]);
});

/* ═══════════════════════ el beneficio lo decide MembeGo ═══════════════════ */

describe("de quién es el beneficio con el que se canjea", () => {
  it("SALE DE MEMBEGO, no del cuerpo de la petición", async () => {
    /**
     * El eje de toda la ola. La pantalla pide la promoción del 10 % por su
     * identificador y ya está: el efecto —cuánto rebaja— lo pone la evaluación
     * que hace el servidor. Sobre 120, un 10 % son 12.
     */
    const out = await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } });
    expect(out.discount).toBe(12);
    expect(out.effectLabel).toBe("10 %");
  });

  it("un efecto inventado por quien llama no cambia el descuento", async () => {
    /**
     * Esto es el fallo, escrito como prueba. Antes `RedeemInput.benefit` era el
     * `EvaluatedBenefit` completo del cuerpo, así que un `POST` con
     * `effect: { kind: "FREE" }` sobre la promoción real del 10 % dejaba la
     * línea en cero. Hoy el tipo solo admite `id` y `type`; se fuerza el objeto
     * entero a propósito para comprobar que lo de más se ignora.
     */
    const mentira = {
      id: "p-1", type: "PROMOTION" as const, nombre: "Gratis total", eligible: true,
      usesLeft: 99, expiresAt: null, reason: null, coverage: null,
      effect: { kind: "FREE" as const, label: "Gratis" },
    };
    const out = await redeemForOrder(ctx, { orderId: ORDEN, benefit: mentira });
    expect(out.discount, "el efecto del cuerpo se aplicó").toBe(12);
    expect(out.benefitName).toBe("10 % en excursiones");
  });

  it("un beneficio que no es de este cliente no se canjea", async () => {
    // La membresía de otro: existe en MembeGo, pero no está entre las de este
    // cliente. `redeemMembership` solo manda el identificador, sin cliente, así
    // que esto era la única barrera y no existía.
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-de-otro", type: "MEMBERSHIP" } })
    ).rejects.toThrow(/Elige el beneficio/);
    expect(membresiaCanjeada).not.toHaveBeenCalled();
  });

  it("pedir una membresía como promoción no cuela", async () => {
    // Se cruza por identificador Y por tipo: el tipo decide a qué endpoint de
    // MembeGo se llama, y `m-1` por el de promociones no es lo mismo.
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "PROMOTION" } })
    ).rejects.toThrow(/Elige el beneficio/);
    expect(promocionCanjeada).not.toHaveBeenCalled();
  });

  it("un beneficio que MembeGo ya no da por elegible se rechaza", async () => {
    evaluacion = conBeneficios({ ...PROMOCION, eligible: false, reason: "NO_USES_LEFT" });
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow(/no se puede usar ahora/);
  });

  it("una membresía cubre la línea entera, sin que nadie mande un porcentaje", async () => {
    const out = await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" } });
    expect(out.discount).toBe(120);
    expect(out.usesLeft).toBe(2);
  });

  it("una membresía ilimitada no deja el contador en cero", async () => {
    membresiaCanjeada.mockResolvedValueOnce({
      redemptionId: "mb-red-2", visitId: "v-2", codigo: "C", ticketNumero: "T",
      customerId: "cli-mb", companyId: "emp-mb", servicio: "Isla Saona",
      usesLeft: 0, unlimited: true, redeemedAt: "2026-09-25T12:00:00.000Z",
    });
    const out = await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" } });
    expect(out.usesLeft, "ilimitada quedó como «no le quedan usos»").toBeNull();
  });
});

/* ══════════════════════ el orden: primero MembeGo ════════════════════════ */

describe("el orden de las dos escrituras", () => {
  it("si MembeGo se niega, la venta no se toca", async () => {
    promocionCanjeada.mockRejectedValueOnce(new Error("NO_USES_LEFT"));
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow("NO_USES_LEFT");

    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number }).total_amount).toBe(120);
    expect(totalesRecalculados).not.toHaveBeenCalled();
  });

  it("y el intento fallido queda anotado con el motivo", async () => {
    promocionCanjeada.mockRejectedValueOnce(new Error("NO_USES_LEFT"));
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow();

    const filas = await db.tenantQuery(ORG, "membego_redemption", {});
    expect(filas).toHaveLength(1);
    expect((filas[0] as { status: string }).status).toBe("failed");
  });

  it("MembeGo consumió y el recibo no se pudo guardar: NO se anota como fallido", async () => {
    /**
     * Era el peor de los estados posibles y se escribía al revés. La escritura
     * del recibo estaba dentro del mismo `try` que la llamada, así que un fallo
     * de base caía en el mismo `catch` y dejaba una fila `failed` — o sea, una
     * fila diciendo que el cliente NO perdió el uso, cuando lo había perdido.
     * Con eso delante nadie va a devolvérselo.
     */
    sb.breakWrites("membego_redemption", "la base rechazó la escritura");
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow(/no se pudo guardar el recibo/);

    expect(promocionCanjeada, "el uso sí se consumió").toHaveBeenCalledTimes(1);
    const acciones = auditado.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones).toContain("membego_redemption_orphan");
    expect(acciones).not.toContain("membego_benefit_redeemed");

    // Y la venta no se rebajó: sin recibo no hay descuento.
    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number }).total_amount).toBe(120);
  });

  it("la auditoría del huérfano lleva el número de canje de MembeGo", async () => {
    // Es lo ÚNICO con lo que se puede devolver a mano desde su panel.
    sb.breakWrites("membego_redemption");
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow();
    const huerfano = auditado.mock.calls
      .map((c) => c[0] as { action: string; metadata?: Record<string, unknown> })
      .find((a) => a.action === "membego_redemption_orphan");
    expect(huerfano?.metadata?.redemption_id).toBe("mb-promo-1");
  });

  it("cuando todo va bien, la línea baja y el total se recalcula", async () => {
    await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } });
    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number; discount_amount: number }).total_amount).toBe(108);
    expect((linea as { discount_amount: number }).discount_amount).toBe(12);
    expect(totalesRecalculados).toHaveBeenCalledWith(ORG, ORDEN);
  });
});

/* ═════════════════════════ la línea sobre la que se aplica ═══════════════ */

describe("sobre qué línea se aplica", () => {
  it("sin elegir, la más cara", async () => {
    const out = await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" } });
    expect(out.bookingId).toBe("bk-cara");
  });

  it("la que el cajero elige, si tiene importe", async () => {
    const out = await redeemForOrder(ctx, {
      orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" }, bookingId: "bk-barata",
    });
    expect(out.bookingId).toBe("bk-barata");
    expect(out.discount).toBe(60);
  });

  it("UNA LÍNEA DE CERO NO SE ACEPTA aunque la pidan: se cae a la más cara", async () => {
    /**
     * El `find` a secas se saltaba el invariante de `defaultLine`. Con una línea
     * de cortesía elegida, `discountFor` devolvía cero, el canje seguía, y
     * MembeGo gastaba el uso del cliente sin que la venta bajara un peso.
     */
    db.seed("booking", [
      {
        _id: "bk-cortesia", organization_id: ORG, order: ORDEN, product: "prod-2",
        status: "confirmed", total_amount: 0, discount_amount: 0,
      },
    ]);
    const out = await redeemForOrder(ctx, {
      orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" }, bookingId: "bk-cortesia",
    });
    expect(out.bookingId, "se canjeó sobre la línea de cero").toBe("bk-cara");
    expect(out.discount).toBe(120);
  });

  it("una línea de otra venta tampoco vale: se cae a la más cara de esta", async () => {
    db.seed("booking", [
      { _id: "bk-ajena", organization_id: ORG, order: "ord-9", status: "confirmed", total_amount: 900 },
    ]);
    const out = await redeemForOrder(ctx, {
      orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" }, bookingId: "bk-ajena",
    });
    expect(out.bookingId).toBe("bk-cara");
  });

  it("si todas las líneas están canceladas, no se canjea nada", async () => {
    db = fakeDb();
    sb = fakeSupabase(db);
    db.seed("membego_link", [{ _id: "lnk-1", organization_id: ORG, membego_company_id: "emp-mb", status: "active" }]);
    db.seed("membego_customer", [{ _id: "mc-1", organization_id: ORG, customer_id: "cli-1", membego_cliente_id: "cli-mb" }]);
    db.seed("sales_order", [{ _id: ORDEN, organization_id: ORG, status: "pending_payment", currency: "usd", customer_id: "cli-1" }]);
    db.seed("booking", [
      { _id: "bk-x", organization_id: ORG, order: ORDEN, status: "cancelled", total_amount: 120 },
    ]);
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" } })
    ).rejects.toThrow(/ninguna línea/);
    expect(membresiaCanjeada).not.toHaveBeenCalled();
  });
});

/* ════════════════════════ uno por venta, de verdad ══════════════════════ */

describe("un beneficio por venta", () => {
  it("la segunda vez se rechaza con 409", async () => {
    await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } });
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "m-1", type: "MEMBERSHIP" } })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("SI NO SE PUEDE LEER si ya hay uno, no se canjea a ciegas", async () => {
    /**
     * PostgREST no lanza: devolvía `{data: null, error}` y el error se
     * descartaba, así que `alreadyRedeemed` salía `false` y la regla se apagaba
     * sola justo cuando la base va mal. Dos usos del cliente por un servicio.
     */
    sb.breakReads("membego_redemption", "conexión perdida");
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow(/no se canjea a ciegas/);
    expect(promocionCanjeada).not.toHaveBeenCalled();
  });

  it("y sobre una venta cerrada tampoco, sin gastar una llamada a MembeGo", async () => {
    await db.tenantUpdate(ORG, "sales_order", ORDEN, { status: "cancelled" });
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow(/ya está cerrada/);
  });

  it("una venta cerrada se dice tal cual aunque MembeGo esté caído", async () => {
    // El cajero necesita leer «ya está cerrada» para cobrar completo y seguir,
    // no «no hay conexión» sobre algo que no depende de la conexión.
    await db.tenantUpdate(ORG, "sales_order", ORDEN, { status: "cancelled" });
    evaluacionFalla = new Error("ECONNRESET");
    await expect(
      redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toThrow(/ya está cerrada/);
  });

  it("una venta que no existe es 404", async () => {
    await expect(
      redeemForOrder(ctx, { orderId: "ord-inventada", benefit: { id: "p-1", type: "PROMOTION" } })
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* ════════════════════════════════ la reversa ════════════════════════════ */

describe("devolver el beneficio", () => {
  const conCanje = (over: Record<string, unknown> = {}) => {
    db.seed("membego_redemption", [{
      _id: "red-1", organization_id: ORG, order_id: ORDEN, booking_id: "bk-cara",
      status: "applied", benefit_type: "MEMBERSHIP", benefit_name: "Plan Oro",
      membego_company_id: "emp-mb", redemption_id: "mb-red-1", amount_discounted: 120,
      ...over,
    }]);
  };

  it("se devuelve y la línea recupera su importe", async () => {
    await db.tenantUpdate(ORG, "booking", "bk-cara", { total_amount: 0, discount_amount: 120 });
    conCanje();
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-cara");
    expect(out).toHaveLength(1);
    expect(out[0].reversed).toBe(true);
    expect(out[0].restored).toBe(120);

    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number }).total_amount).toBe(120);
    expect((linea as { discount_amount: number }).discount_amount).toBe(0);
  });

  it("CANCELAR UNA RESERVA NO DEVUELVE EL BENEFICIO DE OTRA", async () => {
    /**
     * Barría todos los canjes de la orden. En una venta de tres excursiones,
     * bajarse de una devolvía el beneficio aplicado a otra que sigue en pie:
     * MembeGo le devolvía el uso al cliente, la línea viva subía de precio, y el
     * total de la venta subía DESPUÉS de una cancelación.
     */
    conCanje({ booking_id: "bk-cara" });
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-barata");
    expect(out, "se devolvió el beneficio de la línea que sigue viva").toHaveLength(0);
    expect(reversaPedida).not.toHaveBeenCalled();

    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number }).total_amount).toBe(120);
  });

  it("un canje sin reserva anotada se devuelve igual", async () => {
    // De antes de que la columna se llenara: no se puede saber de quién es, y
    // dejarlo sin devolver es peor que devolverlo de más.
    conCanje({ booking_id: null });
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-barata");
    expect(out).toHaveLength(1);
    expect(out[0].reversed).toBe(true);
  });

  it("sin reserva que filtrar, se devuelve todo lo de la venta", async () => {
    conCanje();
    const out = await reverseForOrder(ORG, ORDEN, "Venta anulada", "usr-1");
    expect(out).toHaveLength(1);
    expect(out[0].reversed).toBe(true);
  });

  it("una promoción no tiene reversa por API: se dice y queda anotado", async () => {
    conCanje({ benefit_type: "PROMOTION", benefit_name: "10 %" });
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-cara");
    expect(out[0].manual).toBe(true);
    expect(out[0].reversed).toBe(false);
    expect(reversaPedida).not.toHaveBeenCalled();
    const acciones = auditado.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones).toContain("membego_reversal_manual");
  });

  it("si MembeGo no acepta la reversa, la cancelación sigue y queda el aviso", async () => {
    conCanje();
    reversaPedida.mockRejectedValueOnce(new Error("no se puede revertir"));
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-cara");
    expect(out[0].reversed).toBe(false);
    expect(out[0].manual).toBe(true);
    const acciones = auditado.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones).toContain("membego_reversal_failed");
  });

  it("NO PODER LEER no es «no había nada que devolver»", async () => {
    /**
     * Devolvía `[]`, y quien llama recorre la lista buscando avisos: no
     * encontraba ninguno, la cancelación seguía tan contenta y el cliente se
     * quedaba sin su uso sin una línea en ningún sitio.
     */
    sb.breakReads("membego_redemption", "conexión perdida");
    const out = await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-cara");
    expect(out).toHaveLength(1);
    expect(out[0].manual).toBe(true);
    expect(out[0].message).toMatch(/su panel/);
    const acciones = auditado.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones).toContain("membego_reversal_failed");
  });

  it("sobre una venta ya cancelada no se sube el importe de la línea", async () => {
    // Subirla antes de un reembolso inflaría lo que se devuelve.
    await db.tenantUpdate(ORG, "sales_order", ORDEN, { status: "cancelled" });
    await db.tenantUpdate(ORG, "booking", "bk-cara", { total_amount: 0, discount_amount: 120 });
    conCanje();
    const out = await reverseForOrder(ORG, ORDEN, "Venta anulada", "usr-1", "bk-cara");
    expect(out[0].reversed).toBe(true);
    expect(out[0].restored).toBe(0);
    const [linea] = await db.tenantQuery(ORG, "booking", { _filter: { _id: "bk-cara" } });
    expect((linea as { total_amount: number }).total_amount).toBe(0);
  });

  it("revertido en MembeGo y sin poder marcarlo aquí: se grita, no se calla", async () => {
    conCanje();
    const gritos: unknown[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    sb.breakWrites("membego_redemption");
    try {
      await reverseForOrder(ORG, ORDEN, "Reserva cancelada", "usr-1", "bk-cara");
    } finally {
      console.error = real;
    }
    expect(gritos.join(" ")).toMatch(/cuadrarlo a mano/);
  });
});

/* ══════════════════════════ consultar y contexto ════════════════════════ */

describe("contexto y consultas", () => {
  it("sin enlace activo, no se puede canjear", async () => {
    await db.tenantUpdate(ORG, "membego_link", "lnk-1", { status: "revoked" });
    const mb = await membegoContext(ORG);
    expect(mb.linked).toBe(false);
    expect(mb.membegoCompanyId).toBeNull();
  });

  it("el cliente que no está en el espejo no tiene beneficios que preguntar", async () => {
    const out = await benefitsForCustomer(ORG, "cli-desconocido");
    expect(out.available).toBe(false);
    expect(out.reason).toMatch(/no está identificado/);
  });

  it("si MembeGo no contesta, el mostrador sigue vendiendo", async () => {
    evaluacionFalla = new Error("ECONNRESET");
    const real = console.error;
    console.error = () => {};
    try {
      const out = await benefitsForCustomer(ORG, "cli-1");
      expect(out.available).toBe(false);
      expect(out.membegoClienteId).toBe("cli-mb");
      expect(out.evaluation).toBeNull();
    } finally {
      console.error = real;
    }
  });

  it("y si contesta, se devuelven sus beneficios sin guardarlos", async () => {
    const out = await benefitsForCustomer(ORG, "cli-1");
    expect(out.available).toBe(true);
    expect(out.evaluation?.benefits).toHaveLength(2);
    const guardados = await db.tenantQuery(ORG, "membego_customer", {});
    expect(guardados).toHaveLength(1);
  });

  it("el identificador de MembeGo sale del espejo", async () => {
    expect(await membegoClienteIdOf(ORG, "cli-1")).toBe("cli-mb");
    expect(await membegoClienteIdOf(ORG, "cli-otro")).toBeNull();
  });

  it("los canjes de una venta se leen para el recibo", async () => {
    await redeemForOrder(ctx, { orderId: ORDEN, benefit: { id: "p-1", type: "PROMOTION" } });
    const filas = await redemptionsOfOrder(ORG, ORDEN);
    expect(filas).toHaveLength(1);
    expect(filas[0].discount).toBe(12);
    expect(filas[0].status).toBe("applied");
    expect(filas[0].benefitName).toBe("10 % en excursiones");
  });
});
