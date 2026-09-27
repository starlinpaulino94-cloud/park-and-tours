import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * QUIÉN SE LLEVA LA VENTA, CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las reglas de atribución —la ventana, el primer o el último toque, cómo se
 * cuenta el embudo— viven en `attribution.ts` y están probadas. Lo que decide
 * ESTE fichero es de qué hechos se parte, y eso es dinero: una comisión se paga
 * por el vendedor que sale de aquí.
 *
 * Las tres cosas que no se ven en el módulo puro:
 *
 *   · qué pasa cuando una de las dos lecturas del histórico falla —atribuir a
 *     medias puede pagarle a OTRO, no solo dejar de pagar—;
 *   · si la regla de «una compra por venta» sobrevive a una lectura rota, con
 *     `syncOrderTotals` corriendo en cada pago;
 *   · y qué acepta como slug un enlace que se resuelve desde fuera.
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));

import {
  recordTouch, recordPurchaseOnce, linkVisitorToCustomer,
  resolveLinkBySlug, resolveOrderAttribution, funnelReport,
  VISIT_DEDUPE_HOURS, MAX_FUNNEL_ROWS,
} from "@/lib/attribution-service";

const ORG = "org-1";
const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();

const callado = async (fn: () => Promise<unknown>) => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

beforeEach(() => {
  db = fakeDb();
  sb = fakeSupabase(db);
  db.seed("organizations", [{
    _id: ORG, organization_id: ORG, slug: "tours-del-este", kind: "tenant",
    public_booking_enabled: true, attribution_window_days: 30, attribution_policy: "first",
  }]);
  db.seed("seller", [
    { _id: "ven-1", organization_id: ORG, first_name: "Marisol", last_name: "Peña", status: "active" },
    { _id: "ven-2", organization_id: ORG, first_name: "Aníbal", last_name: "Cruz", status: "active" },
    { _id: "ven-baja", organization_id: ORG, first_name: "Ex", last_name: "Vendedor", status: "inactive" },
  ]);
  db.seed("seller_link", [
    { _id: "lnk-1", organization_id: ORG, slug: "MARISOLA2C4", seller_id: "ven-1",
      channel: "qr", campaign: "verano", product_id: null, status: "active" },
    { _id: "lnk-2", organization_id: ORG, slug: "ANIBALK7D9", seller_id: "ven-2",
      channel: "link", campaign: null, product_id: null, status: "active" },
    { _id: "lnk-baja", organization_id: ORG, slug: "EXVEND9999", seller_id: "ven-baja",
      channel: "qr", campaign: null, product_id: null, status: "active" },
  ]);
});

/* ═══════════════════════════════ el enlace del QR ═══════════════════════ */

describe("resolver el enlace que alguien escaneó", () => {
  it("devuelve el vendedor, su canal y la ventana de la empresa", async () => {
    const link = await resolveLinkBySlug("MARISOLA2C4");
    expect(link?.sellerId).toBe("ven-1");
    expect(link?.sellerName).toBe("Marisol Peña");
    expect(link?.channel).toBe("qr");
    expect(link?.campaign).toBe("verano");
    expect(link?.windowDays).toBe(30);
  });

  it("y acepta que lo tecleen en minúsculas: va impreso bajo un QR", async () => {
    const link = await resolveLinkBySlug("marisola2c4");
    expect(link?.sellerId).toBe("ven-1");
  });

  it("UN COMODÍN NO ES UN SLUG", async () => {
    /**
     * Abajo se compara con `ilike`, que interpreta `%` y `_`. Esto viene de la
     * URL sin tocar: con `/e/%` el patrón casa con todos los enlaces activos, y
     * con `_` se tantean de uno en uno. Cuando casa exactamente uno, quien lo
     * probó se lleva la atribución de ese vendedor sin haber visto nunca su QR.
     */
    expect(await resolveLinkBySlug("%")).toBeNull();
    expect(await resolveLinkBySlug("MARISOL_____")).toBeNull();
    expect(await resolveLinkBySlug("MARISOLA2C%")).toBeNull();
    expect(await resolveLinkBySlug("_ARISOLA2C4")).toBeNull();
  });

  it("un enlace inactivo se contesta igual que uno que no existe", async () => {
    await db.tenantUpdate(ORG, "seller_link", "lnk-2", { status: "revoked" });
    expect(await resolveLinkBySlug("ANIBALK7D9")).toBeNull();
    expect(await resolveLinkBySlug("NOEXISTE00")).toBeNull();
  });

  it("y el de un vendedor que ya no está, también", async () => {
    // La diferencia solo le serviría a quien prueba slugs para averiguar quién
    // usa el sistema.
    expect(await resolveLinkBySlug("EXVEND9999")).toBeNull();
  });

  it("con la página pública apagada, el QR no lleva a ningún sitio", async () => {
    await db.tenantUpdate(ORG, "organizations", ORG, { public_booking_enabled: false });
    expect(await resolveLinkBySlug("MARISOLA2C4")).toBeNull();
  });

  it("un slug vacío o larguísimo ni se consulta", async () => {
    expect(await resolveLinkBySlug("")).toBeNull();
    expect(await resolveLinkBySlug("A".repeat(65))).toBeNull();
  });
});

/* ═════════════════════════════ apuntar el paso ══════════════════════════ */

describe("apuntar un paso del embudo", () => {
  it("escribe el hecho con su canal normalizado", async () => {
    const id = await recordTouch({
      companyId: ORG, sellerId: "ven-1", stage: "visit",
      visitorId: "vis-1", linkId: "lnk-1", channel: "QR", campaign: "verano",
    });
    expect(id).toBeTruthy();
    const filas = await db.tenantQuery(ORG, "seller_attribution", {});
    expect(filas).toHaveLength(1);
    expect((filas[0] as { channel: string }).channel).toBe("qr");
  });

  it("la misma visita del mismo navegador no se cuenta dos veces", async () => {
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "visit", visitorId: "vis-1" });
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "visit", visitorId: "vis-1" });
    expect(await db.tenantQuery(ORG, "seller_attribution", {})).toHaveLength(1);
  });

  it("pasadas las horas de la ventana, vuelve a contar", async () => {
    db.seed("seller_attribution", [{
      _id: "att-vieja", organization_id: ORG, seller_id: "ven-1", stage: "visit",
      visitor_id: "vis-1", created_at: hace(VISIT_DEDUPE_HOURS + 1),
    }]);
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "visit", visitorId: "vis-1" });
    expect(await db.tenantQuery(ORG, "seller_attribution", {})).toHaveLength(2);
  });

  it("y la de OTRO vendedor cuenta aparte", async () => {
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "visit", visitorId: "vis-1" });
    await recordTouch({ companyId: ORG, sellerId: "ven-2", stage: "visit", visitorId: "vis-1" });
    expect(await db.tenantQuery(ORG, "seller_attribution", {})).toHaveLength(2);
  });

  it("los pasos que NO son visita no se deduplican", async () => {
    // Dos reservas del mismo cliente son dos reservas.
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "booking", customerId: "cli-1" });
    await recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "booking", customerId: "cli-1" });
    expect(await db.tenantQuery(ORG, "seller_attribution", {})).toHaveLength(2);
  });

  it("si no se puede escribir, NO se tumba la venta que lo provocó", async () => {
    sb.breakWrites("seller_attribution");
    const id = await callado(() =>
      recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "purchase", orderId: "ord-1" })
    );
    expect(id).toBeNull();
  });

  it("y si no se puede comprobar la repetición, se escribe igual", async () => {
    /**
     * Es lo contrario de `recordPurchaseOnce`, y a propósito: la deduplicación
     * existe para que la tabla no crezca sin techo, no para que el recuento
     * salga bien —el embudo cuenta personas, no filas—. Ante la duda, una fila
     * de más antes que perder el paso que dice quién trajo al cliente.
     */
    sb.breakReads("seller_attribution");
    const id = await callado(() =>
      recordTouch({ companyId: ORG, sellerId: "ven-1", stage: "visit", visitorId: "vis-1" })
    );
    expect(id).toBeTruthy();
  });
});

/* ══════════════════════════ una compra por venta ════════════════════════ */

describe("la compra se apunta UNA vez por venta", () => {
  it("el segundo cobro de la misma venta no deja una segunda compra", async () => {
    await recordPurchaseOnce(ORG, "ord-1", "ven-1");
    await recordPurchaseOnce(ORG, "ord-1", "ven-1");
    const filas = await db.tenantQuery(ORG, "seller_attribution", {});
    expect(filas).toHaveLength(1);
  });

  it("NO PODER COMPROBARLO no es «todavía no hay ninguna»", async () => {
    /**
     * `syncOrderTotals` corre con cada pago, cada abono y cada cancelación de
     * línea. Con la lectura rota y el error descartado, la venta cobrada en tres
     * plazos dejaba tres compras y el vendedor que cobra a plazos parecía el
     * triple de bueno. Aquí se falla cerrado: un paso que falta es un hueco en
     * un informe; una compra de más es un número equivocado con cara de bueno.
     */
    sb.breakReads("seller_attribution");
    await callado(() => recordPurchaseOnce(ORG, "ord-1", "ven-1"));
    const filas = await db.tenantQuery(ORG, "seller_attribution", {});
    expect(filas, "se apuntó una compra sin poder comprobar si ya había otra").toHaveLength(0);
  });

  it("dos ventas distintas son dos compras", async () => {
    await recordPurchaseOnce(ORG, "ord-1", "ven-1");
    await recordPurchaseOnce(ORG, "ord-2", "ven-1");
    expect(await db.tenantQuery(ORG, "seller_attribution", {})).toHaveLength(2);
  });
});

/* ═════════════════════════ el visitante se hace cliente ═════════════════ */

describe("enlazar el visitante con su ficha", () => {
  it("completa los hechos anónimos de ese navegador", async () => {
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "visit", visitor_id: "vis-1", customer_id: null },
      { _id: "a2", organization_id: ORG, seller_id: "ven-1", stage: "visit", visitor_id: "vis-1", customer_id: null },
    ]);
    expect(await linkVisitorToCustomer(ORG, "vis-1", "cli-1")).toBe(2);
    const filas = await db.tenantQuery(ORG, "seller_attribution", {});
    expect(filas.every((f) => (f as { customer_id: string }).customer_id === "cli-1")).toBe(true);
  });

  it("no reescribe un hecho que ya tenía ficha", async () => {
    // Completa el hecho, no lo reescribe: es la única edición que la base
    // permite sobre un hecho y el disparador rechaza cualquier otra cosa.
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "visit", visitor_id: "vis-1", customer_id: "cli-viejo" },
    ]);
    expect(await linkVisitorToCustomer(ORG, "vis-1", "cli-1")).toBe(0);
  });

  it("sin visitante no hay nada que enlazar", async () => {
    expect(await linkVisitorToCustomer(ORG, null, "cli-1")).toBe(0);
    expect(await linkVisitorToCustomer(ORG, "vis-1", "")).toBe(0);
  });
});

/* ═══════════════════ a quién le toca esta venta ═════════════════════════ */

describe("a quién le toca la venta", () => {
  const historico = () => {
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "visit",
        customer_id: "cli-1", visitor_id: null, created_at: hace(72) },
      { _id: "a2", organization_id: ORG, seller_id: "ven-2", stage: "booking",
        customer_id: null, visitor_id: "vis-1", created_at: hace(2) },
    ]);
  };

  it("sin cliente ni cookie no hay a quién preguntar", async () => {
    expect(await resolveOrderAttribution(ORG, {})).toBeNull();
  });

  it("con primer toque gana el más antiguo de los dos caminos", async () => {
    historico();
    const out = await resolveOrderAttribution(
      ORG, { customerId: "cli-1", visitorId: "vis-1" },
      { attribution_policy: "first", attribution_window_days: 30 }
    );
    expect(out?.sellerId).toBe("ven-1");
    expect(out?.policy).toBe("first");
  });

  it("con último toque gana el más reciente", async () => {
    historico();
    const out = await resolveOrderAttribution(
      ORG, { customerId: "cli-1", visitorId: "vis-1" },
      { attribution_policy: "last", attribution_window_days: 30 }
    );
    expect(out?.sellerId).toBe("ven-2");
  });

  it("lo que queda fuera de la ventana no gana, aunque fuera lo primero", async () => {
    // Con primer toque y ventana de un día, la visita de hace tres días no
    // cuenta: el vendedor que la trajo ya no cobra por ella.
    historico();
    const out = await resolveOrderAttribution(
      ORG, { customerId: "cli-1", visitorId: "vis-1" },
      { attribution_policy: "first", attribution_window_days: 1 }
    );
    expect(out?.sellerId).toBe("ven-2");
  });

  it("y si todo el histórico está fuera, no hay nadie: la venta es directa", async () => {
    db.seed("seller_attribution", [
      { _id: "a9", organization_id: ORG, seller_id: "ven-1", stage: "visit",
        customer_id: "cli-9", created_at: hace(24 * 40) },
    ]);
    const out = await resolveOrderAttribution(
      ORG, { customerId: "cli-9" }, { attribution_policy: "first", attribution_window_days: 30 }
    );
    expect(out).toBeNull();
  });

  it("UNA LECTURA ROTA NO ATRIBUYE A MEDIAS", async () => {
    /**
     * Las dos consultas se descartaban con `for (const { data } of results)`.
     * Un error en cualquiera de las dos salía de aquí como «no hay histórico»,
     * y eso tiene dos caras: o la venta queda como directa —el conserje pierde
     * su comisión, en silencio— o, con último toque, gana OTRO vendedor y se le
     * paga a quien no la hizo. Sin los hechos completos no se decide.
     */
    historico();
    sb.breakReads("seller_attribution");
    const out = await callado(() => resolveOrderAttribution(
      ORG, { customerId: "cli-1", visitorId: "vis-1" },
      { attribution_policy: "last", attribution_window_days: 30 }
    ));
    expect(out).toBeNull();
  });

  it("y se dice en la consola, porque una comisión perdida no se ve", async () => {
    historico();
    sb.breakReads("seller_attribution");
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    try {
      await resolveOrderAttribution(ORG, { customerId: "cli-1" }, { attribution_policy: "first" });
    } finally {
      console.error = real;
    }
    expect(gritos.join(" ")).toMatch(/SIN atribuir/);
  });

  it("un hecho sin vendedor no gana nada", async () => {
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: null, stage: "visit",
        customer_id: "cli-1", created_at: hace(1) },
    ]);
    expect(await resolveOrderAttribution(ORG, { customerId: "cli-1" })).toBeNull();
  });

  it("el mismo hecho por los dos caminos no se cuenta dos veces", async () => {
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "visit",
        customer_id: "cli-1", visitor_id: "vis-1", created_at: hace(1) },
    ]);
    const out = await resolveOrderAttribution(ORG, { customerId: "cli-1", visitorId: "vis-1" });
    expect(out?.sellerId).toBe("ven-1");
    expect(out?.attributionId).toBe("a1");
  });
});

/* ═══════════════════════════════ el embudo ══════════════════════════════ */

describe("el embudo de la red comercial", () => {
  beforeEach(() => {
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "visit",
        visitor_id: "vis-1", created_at: hace(50) },
      { _id: "a2", organization_id: ORG, seller_id: "ven-1", stage: "signup",
        customer_id: "cli-1", created_at: hace(48) },
      { _id: "a3", organization_id: ORG, seller_id: "ven-1", stage: "purchase",
        customer_id: "cli-1", order_id: "ord-1", created_at: hace(47) },
      { _id: "a4", organization_id: ORG, seller_id: "ven-2", stage: "visit",
        visitor_id: "vis-2", created_at: hace(10) },
    ]);
  });

  it("cuenta los pasos y pone nombre a cada vendedor", async () => {
    const informe = await funnelReport(ORG);
    expect(informe.rows).toBe(4);
    expect(informe.truncated).toBe(false);
    const nombres = informe.leaderboard.map((f) => f.seller_name);
    expect(nombres).toContain("Marisol Peña");
    expect(nombres).toContain("Aníbal Cruz");
  });

  it("se puede acotar a un vendedor", async () => {
    const informe = await funnelReport(ORG, { sellerId: "ven-2" });
    expect(informe.rows).toBe(1);
    expect(informe.leaderboard).toHaveLength(1);
  });

  it("y a un rango de fechas", async () => {
    const informe = await funnelReport(ORG, { from: hace(24) });
    expect(informe.rows).toBe(1);
  });

  it("si la consulta falla, el informe NO sale vacío con cara de bueno", async () => {
    sb.breakReads("seller_attribution");
    await expect(funnelReport(ORG)).rejects.toThrow();
  });

  it("y si fallan los nombres, los números siguen siendo buenos", async () => {
    // Que el ranking salga con todo el mundo llamándose «Vendedor» es feo; que
    // los números mientan sería otra cosa.
    sb.breakReads("seller");
    const informe = await callado(() => funnelReport(ORG)) as Awaited<ReturnType<typeof funnelReport>>;
    expect(informe.rows).toBe(4);
  });

  it("el tope está declarado y el informe dice si lo tocó", async () => {
    // Un informe recortado que no lo diga es un informe que miente.
    expect(MAX_FUNNEL_ROWS).toBeGreaterThan(0);
    const informe = await funnelReport(ORG);
    expect(informe.truncated).toBe(informe.rows >= MAX_FUNNEL_ROWS);
  });
});
