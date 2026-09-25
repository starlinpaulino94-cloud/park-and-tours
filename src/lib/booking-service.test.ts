import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL CAMINO DEL DINERO.
 *
 * `createOrderWithBookings` son casi ochocientas líneas que convierten una
 * venta en reservas, participantes, vouchers, recogidas, comisiones y cuentas
 * por cobrar, resolviendo por el camino precio, costo, tasa de cambio,
 * atribución del vendedor, cupo del socio y stock. Hasta ahora, sin una sola
 * prueba.
 *
 * Lo que se comprueba aquí NO es que el servicio llame a lo que hay que llamar
 * —eso se ve leyendo—. Se falsea solo el suelo (`tenantQuery/Create/Update`),
 * así que el precio, el cupo, la capacidad y las comisiones se calculan DE
 * VERDAD, y las pruebas afirman lo único que le importa a la empresa: qué
 * acaba escrito y si cuadra.
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
    tenantDelete: (...a: [string, string, string]) => db.tenantDelete(...a),
  };
});

// Lo que sale del proceso se calla: la auditoría lee cabeceras HTTP y los
// avisos escriben con la llave de servicio. Ninguno de los dos decide nada del
// dinero, y los dos están fuera de la saga a propósito.
const auditoria = vi.fn();
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditoria(...a) }));
vi.mock("@/lib/notify-service", () => ({ notify: vi.fn(), notifyRoles: vi.fn() }));
vi.mock("@/lib/messaging/events", () => ({
  notifyBookingCreated: vi.fn(), notifyBookingCancelled: vi.fn(), notifyBalanceDue: vi.fn(),
}));

// La atribución por histórico lee con la llave de servicio, que aquí no existe.
// Devolver «nadie» es además la respuesta correcta para estas pruebas: quien
// vende va escrito en la venta o no hay vendedor. Sus propias reglas se
// comprueban en attribution.test.ts.
vi.mock("@/lib/attribution-service", () => ({
  resolveOrderAttribution: vi.fn(async () => null),
  recordTouch: vi.fn(),
  recordPurchaseOnce: vi.fn(),
}));

/**
 * El monedero prepago se descuenta por una función de Postgres desde 0091, y
 * aquí no hay Postgres. Se falsea el RPC y nada más: `assertSaldo` y
 * `gastarDelMonedero` corren de verdad, así que lo que se comprueba es lo que
 * esta capa decide —cuándo se llama, con qué importe y qué se hace con la
 * respuesta—, no la aritmética de la función.
 */
const rpc = vi.fn(async () => ({
  data: {
    movement_id: "mov-1", amount: 0, currency: "usd",
    balance_before: 1000, balance_after: 800, overdraft: false, already: false,
  },
  error: null,
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({ rpc }) }));

import { createOrderWithBookings, syncOrderTotals } from "@/lib/booking-service";

const ORG = "org-1";
const ctx = {
  companyId: ORG,
  userId: "user-1",
  role: "admin",
  branchId: null,
  company: { _id: ORG, base_currency: "usd" },
} as unknown as Parameters<typeof createOrderWithBookings>[0];

/** El catálogo mínimo con el que una venta se puede armar. */
/**
 * Las autorizaciones del socio del banco de pruebas.
 *
 * Desde 0077 una venta de tour center exige contrato por producto. El banco lo
 * siembra con el catálogo entero, igual que la migración: si no lo hiciera,
 * cada prueba de venta al socio fallaría por una razón que no es la que está
 * probando — y eso es exactamente lo que le pasaría en producción a toda la red
 * de un operador si la migración no sembrara.
 */
function autorizaciones(partnerId = "soc-1") {
  return [
    { _id: `aut-${partnerId}-saona`, partner: partnerId, product: "prod-saona", status: "active" },
    { _id: `aut-${partnerId}-buggy`, partner: partnerId, product: "prod-buggy", status: "active" },
  ];
}

function catalogo(extra: Record<string, Record<string, unknown>[]> = {}) {
  return {
    partner_product: autorizaciones(),
    customer: [{ _id: "cli-1", first_name: "Laura", last_name: "Gutiérrez" }],
    product: [
      { _id: "prod-saona", name: "Isla Saona", base_price: 100, base_cost: 40, status: "active" },
      { _id: "prod-buggy", name: "Buggy", base_price: 60, base_cost: 25, status: "active" },
    ],
    departure: [
      { _id: "sal-saona", product: "prod-saona", departure_at: futuro(3), capacity: 40,
        booked_pax: 0, pending_pax: 0, cutoff_hours: 0, status: "available" },
      { _id: "sal-buggy", product: "prod-buggy", departure_at: futuro(4), capacity: 20,
        booked_pax: 0, pending_pax: 0, cutoff_hours: 0, status: "available" },
    ],
    ...extra,
  };
}

function futuro(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString();
}

beforeEach(() => {
  auditoria.mockReset();
  db = fakeDb(catalogo());
});

/* ══════════════════════════════════════════════ el total tiene que cuadrar ══ */

describe("una venta simple", () => {
  it("escribe la orden, la reserva y su voucher", async () => {
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });

    expect(res.bookings).toHaveLength(1);
    const orden = db.row("order", { _id: res.order._id })!;
    expect(orden.status).toBe("pending_payment");
    expect(db.rows("voucher")).toHaveLength(1);
  });

  it("el total de la orden es la suma de sus reservas", async () => {
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
        { product_id: "prod-buggy", departure_id: "sal-buggy", adults: 1 },
      ],
    });

    const orden = db.row("order", { _id: res.order._id })!;
    const suma = db.rows("booking").reduce((s, b) => s + Number(b.total_amount ?? 0), 0);
    expect(Number(orden.total)).toBe(round2(suma));
  });

  it("subtotal − descuento + impuesto = total, en la orden y en cada reserva", async () => {
    // Es el invariante que cualquiera daría por hecho al leer un listado de
    // ventas, y el que hace que la contabilidad cuadre o no.
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 4, discount_pct: 10, tax_pct: 18 }],
    });

    const orden = db.row("order", { _id: res.order._id })!;
    expect(round2(Number(orden.subtotal) - Number(orden.discount_total) + Number(orden.tax_total)))
      .toBe(Number(orden.total));

    for (const b of db.rows("booking")) {
      expect(round2(Number(b.gross_amount) - Number(b.discount_amount) + Number(b.tax_amount)))
        .toBe(Number(b.total_amount));
    }
  });

  it("una reserva nace debiendo su total entero", async () => {
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const b = db.rows("booking")[0];
    expect(Number(b.paid_amount)).toBe(0);
    expect(Number(b.balance_amount)).toBe(Number(b.total_amount));
  });

  it("el margen excluye el impuesto, que no es ingreso", async () => {
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2, tax_pct: 18 }],
    });
    const b = db.rows("booking")[0];
    const neto = round2(Number(b.gross_amount) - Number(b.discount_amount));
    expect(Number(b.margin_amount)).toBe(round2(neto - Number(b.cost_amount)));
    expect(Number(b.margin_amount)).toBeLessThan(Number(b.total_amount));
  });

  it("sin participantes no hay venta", async () => {
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 0 }],
    })).rejects.toThrow(/al menos un participante/i);
  });

  it("el cupo se respeta: no se vende más de lo que cabe", async () => {
    db = fakeDb(catalogo({
      departure: [{ _id: "sal-saona", product: "prod-saona", departure_at: futuro(3),
        capacity: 3, booked_pax: 0, pending_pax: 0, cutoff_hours: 0, status: "available" }],
    }));
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 5 }],
    })).rejects.toThrow(/cupo/i);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("dos líneas de la misma salida se suman para el cupo, no se miran por separado", async () => {
    // AUD-B01: por separado, dos líneas de 2 pax pasaban con 3 plazas libres.
    db = fakeDb(catalogo({
      departure: [{ _id: "sal-saona", product: "prod-saona", departure_at: futuro(3),
        capacity: 3, booked_pax: 0, pending_pax: 0, cutoff_hours: 0, status: "available" }],
    }));
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
      ],
    })).rejects.toThrow();
    expect(db.rows("booking")).toHaveLength(0);
  });
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ═══════════════════════════════════ el cupo del socio y a quién se le carga ══ */

/**
 * El cupo es un CONTRATO con una agencia: «te garantizo 10 plazas en Saona».
 * Lo que la reserva guarda —de qué cupo salieron sus plazas— es lo que se usa
 * para devolverlas al cancelar. Apuntarlas al contrato equivocado no se nota el
 * día de la venta: se nota semanas después, cuando el contrato tiene plazas que
 * nadie compró.
 */
function conCupo() {
  return fakeDb(catalogo({
    partner: [{ _id: "soc-1", name: "Caribe Tour Center", credit_limit: 0, credit_days: 0 }],
    allotment: [{
      _id: "cupo-saona",
      partner: "soc-1",
      product: "prod-saona",
      allotment_type: "guaranteed",
      seats: 10, seats_used: 0, seats_released: 0,
      status: "active",
    }],
  }));
}

describe("el cupo del socio", () => {
  it("apunta el consumo en el contrato del producto vendido", async () => {
    db = conCupo();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(Number(db.row("allotment", { _id: "cupo-saona" })!.seats_used)).toBe(2);
  });

  it("la reserva guarda de qué cupo salieron sus plazas", async () => {
    db = conCupo();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const b = db.rows("booking")[0];
    expect(b.allotment).toBe("cupo-saona");
    expect(Number(b.allotment_seats)).toBe(2);
  });

  it("un producto SIN cupo no se apunta al contrato de otro producto", async () => {
    /**
     * ──────────────────────────────────────────────────────────────────────
     * El socio tiene un contrato para Saona y ninguno para Buggy. Vende las
     * dos cosas en el mismo carrito.
     *
     * Lo que se consume está bien: solo las 2 plazas de Saona. Pero la reserva
     * de Buggy se quedaba con `allotment: cupo-saona` por un respaldo que, si
     * no encuentra el cupo de SU producto, coge el primero de la lista.
     *
     * El daño llega al cancelar: se devuelven al contrato de Saona 3 plazas que
     * nunca se le quitaron, y el socio acaba con más cupo del que compró. Y no
     * hay negativo que lo delate, porque la devolución se topa en cero.
     */
    db = conCupo();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
        { product_id: "prod-buggy", departure_id: "sal-buggy", adults: 3 },
      ],
    });

    expect(Number(db.row("allotment", { _id: "cupo-saona" })!.seats_used)).toBe(2);

    const buggy = db.rows("booking").find((b) => b.product === "prod-buggy")!;
    expect(buggy.allotment ?? null, "la reserva sin cupo no debe apuntar a ningún contrato").toBeNull();
  });

  it("un cupo del socio sin producto sí aplica a todo lo que venda", async () => {
    // El respaldo existe por esto, y tiene que seguir funcionando: un contrato
    // sin producto es «te garantizo 10 plazas en lo que sea».
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe Tour Center", credit_limit: 0, credit_days: 0 }],
      allotment: [{
        _id: "cupo-todo", partner: "soc-1",
        allotment_type: "guaranteed", seats: 10, seats_used: 0, seats_released: 0, status: "active",
      }],
    }));
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-buggy", departure_id: "sal-buggy", adults: 3 }],
    });
    const b = db.rows("booking")[0];
    expect(b.allotment).toBe("cupo-todo");
    expect(Number(b.allotment_seats)).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════ extras, impuesto y descuento ══ */

describe("los extras entran en el total con su impuesto", () => {
  const conExtra = () => fakeDb(catalogo({
    product_extra: [{
      _id: "ext-almuerzo", product: "prod-saona", name: "Almuerzo",
      price_type: "per_person", price: 35, cost: 20, status: "active", sort_order: 1,
    }],
  }));

  it("el impuesto se aplica TAMBIÉN sobre el extra", async () => {
    // Sumarlos después del impuesto los dejaba exentos: en un grupo de 40 con
    // almuerzo de 35 son 1.400 de base sin ITBIS, que es un error de
    // declaración, no un redondeo.
    db = conExtra();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2, tax_pct: 18,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }],
      }],
    });
    const b = db.rows("booking")[0];
    expect(Number(b.extras_amount)).toBe(70);          // 35 × 2
    expect(Number(b.gross_amount)).toBe(270);          // 100 × 2 + 70
    expect(Number(b.tax_amount)).toBe(round2(270 * 0.18));
  });

  it("el descuento del tour NO rebaja el extra", async () => {
    // Un 10% pactado sobre la excursión no rebaja la langosta que el cliente
    // añadió aparte.
    db = conExtra();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2, discount_pct: 10,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }],
      }],
    });
    const b = db.rows("booking")[0];
    expect(Number(b.discount_amount)).toBe(20);        // 10% de 200, no de 270
    expect(Number(b.total_amount)).toBe(250);          // 270 − 20
  });

  it("el costo del extra se suma al costo de la reserva", async () => {
    db = conExtra();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }],
      }],
    });
    const b = db.rows("booking")[0];
    expect(Number(b.extras_cost)).toBe(40);            // 20 × 2
    expect(Number(b.cost_amount)).toBe(Number(b.extras_cost) + 80);
  });

  it("un extra que el catálogo no reconoce tumba la venta, no se cobra de menos", async () => {
    db = conExtra();
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2,
        extras: [{ extra_id: "ext-inventado", quantity: 1 }],
      }],
    })).rejects.toThrow(/ya no están disponibles/i);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("cada extra deja su línea con el nombre y el precio copiados", async () => {
    // Si el extra se renombra o sube de precio, el voucher de esta reserva
    // tiene que seguir diciendo qué se compró y por cuánto.
    db = conExtra();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }],
      }],
    });
    const linea = db.rows("booking_extra")[0];
    expect(linea.name).toBe("Almuerzo");
    expect(Number(linea.unit_price)).toBe(35);
  });
});

/* ══════════════════════════════════════════════════════════ moneda y cambio ══ */

describe("la moneda", () => {
  it("la tasa sale de la base, nunca del cliente", async () => {
    // AUD-F30: confiar en el `exchange_rate` que llega dejaba
    // `base_currency_total` sin significado en toda venta que no fuera en la
    // moneda base.
    db = fakeDb(catalogo({
      currency_rate: [{ _id: "tasa-1", currency_from: "dop", currency_to: "usd", rate: 0.017, rate_date: "2026-09-01" }],
    }));
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      currency: "dop",
      exchange_rate: 999,   // lo que diga el cliente da igual
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 1, unit_price_override: 6000 }],
    } as Parameters<typeof createOrderWithBookings>[1]);

    const orden = db.row("order", { _id: res.order._id })!;
    expect(Number(orden.exchange_rate)).toBe(0.017);
    expect(Number(orden.base_currency_total)).toBe(round2(Number(orden.total) * 0.017));
  });

  it("una orden no puede mezclar monedas", async () => {
    // AUD-F03: sumar líneas de monedas distintas 1:1 daría un total sin
    // significado. Se rechaza en vez de mentir.
    db = fakeDb(catalogo({
      price_rule: [{
        _id: "regla-dop", product: "prod-saona", price: 6000, currency: "dop", status: "active",
      }],
    }));
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      currency: "usd",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 1 }],
    })).rejects.toThrow(/no puede mezclar monedas/i);
  });
});

/* ═══════════════════════════════════════════ la venta a medias no deja rastro ══ */

describe("cuando algo falla a mitad de la venta", () => {
  /**
   * La venta es una saga: se escriben la orden, sus reservas, sus vouchers y
   * sus comisiones una a una, sin transacción. Si revienta por el camino, lo
   * que quede a medias tiene que deshacerse solo.
   *
   * Lo que no puede pasar es una orden fantasma: plazas ocupadas en una salida
   * por reservas de una venta que nunca existió. Nadie las reclama y nadie las
   * libera; simplemente la excursión sale con sitios vacíos que el sistema daba
   * por vendidos.
   */
  const rompeEnLaSegunda = () => fakeDb(catalogo({
    product_extra: [{
      _id: "ext-almuerzo", product: "prod-saona", name: "Almuerzo",
      price_type: "per_person", price: 35, cost: 20, status: "active", sort_order: 1,
    }],
  }));

  const venta = () => createOrderWithBookings(ctx, {
    customer_id: "cli-1",
    items: [
      { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
      // Revienta: el extra no es de este producto.
      { product_id: "prod-buggy", departure_id: "sal-buggy", adults: 2,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }] },
    ],
  });

  it("la reserva que sí se creó queda cancelada, no viva", async () => {
    db = rompeEnLaSegunda();
    await expect(venta()).rejects.toThrow();
    const vivas = db.rows("booking").filter((b) => b.status !== "cancelled");
    expect(vivas, "no puede quedar ninguna reserva viva de una venta que falló").toEqual([]);
  });

  it("la salida no se queda con plazas ocupadas por una venta que no existió", async () => {
    db = rompeEnLaSegunda();
    await expect(venta()).rejects.toThrow();
    const salida = db.row("departure", { _id: "sal-saona" })!;
    expect(Number(salida.booked_pax)).toBe(0);
    expect(Number(salida.pending_pax)).toBe(0);
  });

  it("la orden no se queda en «pendiente de pago»", async () => {
    // Promover la orden es el último paso crítico a propósito: solo se convierte
    // en venta de verdad cuando ya existe todo lo suyo.
    db = rompeEnLaSegunda();
    await expect(venta()).rejects.toThrow();
    const orden = db.rows("order")[0];
    expect(orden.status).not.toBe("pending_payment");
  });
});

/* ═══════════════════════════════════════════════ la venta a crédito al socio ══ */

describe("la venta al socio", () => {
  const conSocio = (partner: Record<string, unknown>, receivables: Record<string, unknown>[] = []) =>
    fakeDb(catalogo({ partner: [{ _id: "soc-1", name: "Caribe", ...partner }], receivable: receivables }));

  it("deja su cuenta por cobrar con el vencimiento de sus días de crédito", async () => {
    db = conSocio({ credit_limit: 0, credit_days: 15 });
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });

    const cxc = db.rows("receivable")[0];
    expect(cxc, "una venta a crédito sin cuenta por cobrar no la cobra nadie").toBeTruthy();
    const orden = db.row("order", { _id: res.order._id })!;
    expect(Number(cxc.amount)).toBe(Number(orden.total));
    expect(Number(cxc.balance)).toBe(Number(orden.total));

    const dias = Math.round(
      (Date.parse(String(cxc.due_date)) - Date.parse(String(cxc.issue_date))) / 86_400_000
    );
    expect(dias).toBe(15);
  });

  it("una venta directa NO crea cuenta por cobrar", async () => {
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(db.rows("receivable")).toHaveLength(0);
  });

  it("el límite de crédito frena la venta cuando ya debe demasiado", async () => {
    // `credit_limit` llevaba desde 0002 sin que nada lo mirara: se vendía a
    // crédito sin techo y el descubierto aparecía cuando ya no pagaba.
    db = conSocio(
      { credit_limit: 500, credit_days: 15 },
      [{ _id: "cxc-viejo", partner: "soc-1", amount: 480, paid_amount: 0, balance: 480, status: "pending" }]
    );
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 4 }],
    })).rejects.toThrow(/crédito/i);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("se puede pasar del límite a propósito, y queda auditado", async () => {
    db = conSocio(
      { credit_limit: 500, credit_days: 15 },
      [{ _id: "cxc-viejo", partner: "soc-1", amount: 480, paid_amount: 0, balance: 480, status: "pending" }]
    );
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1", allow_over_credit: true,
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 4 }],
    } as Parameters<typeof createOrderWithBookings>[1]);

    expect(db.rows("booking")).toHaveLength(1);
    const acciones = auditoria.mock.calls.map((c) => (c[0] as { action?: string }).action);
    expect(acciones, "saltarse el límite sin dejar rastro no es una excepción, es un agujero")
      .toContain("credit_limit_override");
  });

  it("una cuenta ya pagada no cuenta como deuda viva", async () => {
    db = conSocio(
      { credit_limit: 500, credit_days: 15 },
      [{ _id: "cxc-pagada", partner: "soc-1", amount: 480, paid_amount: 480, balance: 0, status: "paid" }]
    );
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 4 }],
    });
    expect(db.rows("booking")).toHaveLength(1);
  });
});

/* ═════════════════════════════════════════════════════════════ comisiones ══ */

describe("las comisiones que genera la venta", () => {
  const conVendedor = (reglas: Record<string, unknown>[] = [], extra: Record<string, Record<string, unknown>[]> = {}) =>
    fakeDb(catalogo({
      seller: [{ _id: "ven-1", first_name: "Marisol", last_name: "Peña", commission_pct: 5, status: "active" }],
      commission_rule: reglas,
      ...extra,
    }));

  it("la base es la venta neta: sin impuesto y con el descuento ya restado", async () => {
    /**
     * Comisionar sobre el total con impuesto le pagaría al vendedor un
     * porcentaje del ITBIS, que es dinero del Estado que pasa por la caja. Y
     * comisionar sobre el bruto le pagaría sobre un descuento que la empresa
     * regaló.
     */
    db = conVendedor();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 4, discount_pct: 10, tax_pct: 18 }],
    });

    const c = db.rows("commission")[0];
    expect(c, "una venta con vendedor sin comisión es una liquidación que nadie cobra").toBeTruthy();
    expect(Number(c.base_amount)).toBe(360);      // 400 bruto − 40 de descuento; el 18% no entra
    expect(Number(c.amount)).toBe(18);            // 5% de 360
  });

  it("la comisión nace con su neto puesto, no en cero", async () => {
    // Nacer en nulo hacía que la liquidación leyera cero para todo lo recién
    // generado: el vendedor veía sus ventas y ningún importe.
    db = conVendedor();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const c = db.rows("commission")[0];
    expect(Number(c.net_amount)).toBe(Number(c.amount));
    expect(Number(c.adjustment_total)).toBe(0);
    expect(c.status).toBe("pending");
  });

  it("un vendedor no puede descontar más de lo que tiene autorizado", async () => {
    /**
     * El campo existía desde 0005, la pantalla lo pedía y no se aplicaba en
     * ningún cálculo: la operadora creía haber acotado lo que sus vendedores
     * regalan y el sistema aceptaba un 90 % igual que un 5 %.
     *
     * Se comprueba AQUÍ, en el único camino que crea reservas, y no en la
     * pantalla: una validación que solo vive en el navegador no es un techo,
     * es una sugerencia que se salta cualquiera que llame a la API.
     */
    db = conVendedor([], {
      seller: [{ _id: "ven-1", first_name: "Marisol", last_name: "Peña", commission_pct: 5, max_discount_pct: 10, status: "active" }],
    });
    const suyo = { ...ctx, role: "seller", userId: "u-1", sellerId: "ven-1" } as typeof ctx;

    await expect(createOrderWithBookings(suyo, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2, discount_pct: 40 }],
    })).rejects.toThrow(/autorización llega al 10 %/);

    // Y no queda nada a medias: se comprueba ANTES de calcular precios.
    expect(db.rows("sales_order"), "la venta rechazada dejó rastro").toHaveLength(0);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("hasta su techo sí puede, y un gerente no tiene techo", async () => {
    db = conVendedor([], {
      seller: [{ _id: "ven-1", first_name: "Marisol", last_name: "Peña", commission_pct: 5, max_discount_pct: 10, status: "active" }],
    });
    const suyo = { ...ctx, role: "seller", userId: "u-1", sellerId: "ven-1" } as typeof ctx;
    await createOrderWithBookings(suyo, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2, discount_pct: 10 }],
    });
    expect(db.rows("sales_order")).toHaveLength(1);

    /**
     * El techo es una autorización de QUIEN VENDE. Un gerente registrando una
     * venta ejerce la suya, no la de la ficha a la que se atribuye — si no,
     * bastaría con atribuirle la venta a alguien sin techo para saltárselo.
     */
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2, discount_pct: 40 }],
    });
    expect(db.rows("sales_order")).toHaveLength(2);
  });

  it("la comisión nace sabiendo de QUÉ DÍA es, no solo de cuándo se vendió", async () => {
    /**
     * El mercado liquida por la fecha del TOUR y no por la de la venta: una
     * excursión vendida en marzo para agosto no se cobra en marzo.
     *
     * La fecha de salida vive dos tablas más allá (`booking` → `departure`) y
     * la capa de consulta NO filtra por columna de tabla unida, así que sin
     * copiarla aquí no hay forma de cortar períodos por el día del servicio.
     *
     * Y el fallo de no copiarla es silencioso de la peor manera: la columna
     * existe, el relleno de la migración arregla el histórico, y a partir de
     * ahí **cada comisión nueva nace en nulo**. La pantalla del vendedor
     * enseñaría lo viejo y perdería lo de esta semana, sin un solo error.
     */
    db = conVendedor();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });

    const c = db.rows("commission")[0];
    const salida = db.rows("departure").find((d) => d._id === "sal-saona")!;
    expect(c.service_date, "la comisión no sabe de qué día es").toBeTruthy();
    expect(String(c.service_date).slice(0, 10)).toBe(String(salida.departure_at).slice(0, 10));
  });

  it("una regla concreta gana al porcentaje suelto de la ficha del vendedor", async () => {
    db = conVendedor([{
      _id: "regla-saona", name: "Saona 12%", beneficiary_type: "seller",
      calc_type: "percentage", value: 12, product: "prod-saona", status: "active", priority: 10,
    }]);
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const c = db.rows("commission")[0];
    expect(Number(c.amount)).toBe(24);            // 12% de 200, no el 5% de la ficha
    expect(c.rule).toBe("regla-saona");
  });

  it("el socio y el vendedor cobran cada uno la suya", async () => {
    db = conVendedor([], {
      partner: [{ _id: "soc-1", name: "Caribe", default_commission_pct: 18, credit_limit: 0, credit_days: 0 }],
    });
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const tipos = db.rows("commission").map((c) => c.beneficiary_type).sort();
    expect(tipos).toEqual(["partner", "seller"]);
  });

  it("el socio a NETO no cobra comisión: su margen ya va en el precio", async () => {
    /**
     * EL COBRO DOBLE QUE ESTO CIERRA.
     *
     * Hay dos formas de trabajar con un canal externo y son excluyentes: o
     * vende a tarifa y se le liquida un porcentaje, o COMPRA a precio neto y
     * revende al que quiera. Con las dos a la vez, el socio cobra su margen dos
     * veces —una en el precio y otra en la liquidación— y no se ve el día de la
     * venta, porque las dos cifras son correctas por separado. Se ve un mes
     * después, comparando la liquidación con el contrato.
     */
    db = conVendedor([], {
      partner: [{
        _id: "soc-1", name: "Caribe", default_commission_pct: 18,
        credit_limit: 0, credit_days: 0, pricing_model: "net",
      }],
    });
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    const tipos = db.rows("commission").map((c) => c.beneficiary_type).sort();
    // El vendedor de la casa sí cobra la suya: es empleado de la operadora y su
    // comisión no tiene nada que ver con el modelo del tour center.
    expect(tipos).toEqual(["seller"]);
  });

  it("y sin modelo declarado sigue cobrando, como hacía siempre", async () => {
    // Entender el hueco como «neto» le quitaría la comisión a todos los socios
    // existentes de golpe el día del despliegue.
    db = conVendedor([], {
      partner: [{ _id: "soc-1", name: "Caribe", default_commission_pct: 18, credit_limit: 0, credit_days: 0 }],
    });
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(db.rows("commission").map((c) => c.beneficiary_type)).toEqual(["partner"]);
  });

  it("una venta sin vendedor ni socio no genera comisión de nadie", async () => {
    // Es la venta directa de la empresa. Inventarle un beneficiario sería
    // pagarle a alguien por algo que no vendió.
    db = conVendedor();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(db.rows("commission")).toHaveLength(0);
  });

  it("la comisión guarda su foto: la frase que se imprime y los pax congelados", async () => {
    // Una comisión discutida seis semanas después no se puede defender
    // recalculándola con las reglas de hoy, que son las que pueden haber
    // cambiado.
    db = conVendedor();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 3, children: 1 }],
    });
    const c = db.rows("commission")[0];
    expect(c.snapshot).toBeTruthy();
    expect(c.breakdown).toBeTruthy();
    expect(Number(c.pax_adults)).toBe(3);
    expect(Number(c.pax_children)).toBe(1);
  });

  it("la comisión SÍ se paga sobre los extras vendidos", async () => {
    /**
     * Es una decisión, no un descuido, y conviene que esté escrita porque el
     * COSTO hace lo contrario: `resolveCost` deja los extras fuera de su base
     * a propósito, porque el almuerzo tiene su propio proveedor y meterlo le
     * pagaría dos veces al del tour.
     *
     * Con la comisión no hay doble pago: el vendedor vendió el almuerzo, y lo
     * que cobra sale de un ingreso que existe.
     */
    db = conVendedor([], {
      product_extra: [{
        _id: "ext-almuerzo", product: "prod-saona", name: "Almuerzo",
        price_type: "per_person", price: 35, cost: 20, status: "active", sort_order: 1,
      }],
    });
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1", seller_id: "ven-1",
      items: [{
        product_id: "prod-saona", departure_id: "sal-saona", adults: 2,
        extras: [{ extra_id: "ext-almuerzo", quantity: 2 }],
      }],
    });
    const c = db.rows("commission")[0];
    expect(Number(c.base_amount)).toBe(270);      // 200 del tour + 70 de almuerzo
  });
});

/* ═══════════════════════════════ el prorrateo no degrada un compromiso ══ */

describe("sincronizar el cobro de una orden", () => {
  /**
   * ──────────────────────────────────────────────────────────────────────────
   * `confirmed` NO LO PONE EL DINERO
   *
   * El prorrateo recalculaba el estado de cada reserva viva a partir de lo
   * cobrado, y con saldo a cero escribía `pending_payment` pasara lo que
   * pasara. Eso borraba `confirmed`, que es el estado de quien se compromete a
   * viajar SIN haber pagado todavía: hoy, el revendedor de una OTA, que liquida
   * a fin de mes.
   *
   * Y no es un matiz de vocabulario. Las vistas del cuadro de mando cuentan
   * como venta las reservas en ('confirmed','partially_paid','paid',
   * 'checked_in','completed','no_show','partially_refunded'): `pending_payment`
   * queda fuera. Cada reserva de OTA confirmada desaparecía de las cifras de la
   * operadora, y en el manifiesto salía como pendiente de pago.
   */
  const orden = (bookings: Record<string, unknown>[], pagos: Record<string, unknown>[] = []) => {
    db.seed("order", [{ _id: "ord-1", organization_id: ORG, order_number: "ORD-1", status: "pending_payment" }]);
    db.seed("booking", bookings.map((b) => ({ organization_id: ORG, order: "ord-1", total_amount: 200, ...b })));
    db.seed("payment", pagos.map((p, i) => ({
      _id: `pay-${i}`, organization_id: ORG, order: "ord-1", status: "completed", payment_type: "payment", ...p,
    })));
  };

  it("una reserva confirmada sin pagar SIGUE confirmada", async () => {
    orden([{ _id: "res-1", status: "confirmed" }]);
    await syncOrderTotals(ORG, "ord-1");
    expect(db.row("booking", { _id: "res-1" })!.status,
      "el compromiso del revendedor no lo borra el saldo a cero").toBe("confirmed");
  });

  it("una reserva sin confirmar ni pagar queda pendiente de pago", async () => {
    orden([{ _id: "res-1", status: "pending_payment" }]);
    await syncOrderTotals(ORG, "ord-1");
    expect(db.row("booking", { _id: "res-1" })!.status).toBe("pending_payment");
  });

  it("cuando entra el dinero, manda el dinero", async () => {
    // `paid` pisa a `confirmed` y eso es lo correcto: son estados de cobro, y
    // la reserva sigue contando como venta en los mismos cuadros.
    orden([{ _id: "res-1", status: "confirmed" }], [{ amount: 200 }]);
    await syncOrderTotals(ORG, "ord-1");
    expect(db.row("booking", { _id: "res-1" })!.status).toBe("paid");
  });

  it("un cobro a medias deja la reserva pagada a medias", async () => {
    orden([{ _id: "res-1", status: "confirmed" }], [{ amount: 80 }]);
    await syncOrderTotals(ORG, "ord-1");
    const r = db.row("booking", { _id: "res-1" })!;
    expect(r.status).toBe("partially_paid");
    expect(Number(r.balance_amount)).toBe(120);
  });
});

/* ═══════════════════════════════════ el contrato socio–producto (0077) ══ */

describe("lo que un tour center tiene autorizado vender", () => {
  it("un producto fuera de su contrato NO se reserva", async () => {
    /**
     * LA MITAD QUE FALTABA.
     *
     * Acotar el catálogo esconde el producto de UNA pantalla. La reserva llega
     * por el cuerpo de una petición con un `product_id` dentro, y la de un
     * socio que integra por API ni siquiera pasa por esa pantalla. Un filtro de
     * listado es una sugerencia.
     */
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe", credit_limit: 0, credit_days: 0 }],
      partner_product: [
        { _id: "aut-1", partner: "soc-1", product: "prod-saona", status: "active" },
      ],
    }));

    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-buggy", departure_id: "sal-buggy", adults: 2 }],
    })).rejects.toThrow(/no tienes autorizada la venta/i);
  });

  it("y el mensaje dice QUÉ producto, por su nombre", async () => {
    // Un 403 con uuids dentro obliga a quien integra a cruzarlos a mano contra
    // su catálogo para entender qué le están negando.
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe", credit_limit: 0, credit_days: 0 }],
      partner_product: [{ _id: "aut-1", partner: "soc-1", product: "prod-saona", status: "active" }],
    }));

    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-buggy", departure_id: "sal-buggy", adults: 2 }],
    })).rejects.toThrow(/Buggy/);
  });

  it("una autorización RETIRADA deja de valer", async () => {
    // Se desautoriza poniendo la fila inactiva, no borrándola: queda el rastro.
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe", credit_limit: 0, credit_days: 0 }],
      partner_product: [
        { _id: "aut-1", partner: "soc-1", product: "prod-saona", status: "inactive" },
      ],
    }));

    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow(/no tienes autorizada la venta/i);
  });

  it("sin NINGUNA autorización no se vende nada, que es lo contrario de antes", async () => {
    /**
     * El catálogo del portal hacía `autorizados.length ? filtrar : no filtrar`,
     * así que la lista vacía significaba «todo». Desde 0077 la tabla se siembra
     * con el catálogo entero por socio: vacía significa lo que dice.
     */
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe", credit_limit: 0, credit_days: 0 }],
      partner_product: [],
    }));

    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow(/no tienes autorizada la venta/i);
  });

  it("la venta PROPIA de la operadora no pasa por ningún contrato", async () => {
    // El contrato es de la relación con un tour center. Aplicarlo a la venta
    // del mostrador apagaría el punto de venta entero.
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(res.order._id).toBeTruthy();
  });

  it("y se comprueba ANTES de tomar plazas", async () => {
    /**
     * Rechazar después obliga a compensar escrituras que no había que haber
     * hecho. Se mira la salida: si las plazas siguen libres, no se llegó a
     * tocar nada.
     */
    db = fakeDb(catalogo({
      partner: [{ _id: "soc-1", name: "Caribe", credit_limit: 0, credit_days: 0 }],
      partner_product: [],
    }));

    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1", partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow();

    const salida = db.rows("departure").find((d) => d._id === "sal-saona");
    expect(salida?.booked_pax ?? 0, "se tomaron plazas de una venta rechazada").toBe(0);
    expect(salida?.pending_pax ?? 0).toBe(0);
    expect(db.rows("sales_order")).toHaveLength(0);
  });
});

/* ═══════════════════════════ la salida es del producto que se vende ══ */

describe("la salida tiene que ser de su producto", () => {
  it("VENDER SAONA EN LA GUAGUA DEL BUGGY SE RECHAZA", async () => {
    /**
     * Nadie lo comprobaba, y es alcanzable desde fuera con datos publicados: el
     * catálogo público da los identificadores de producto y `/availability` los
     * de salida. Con el producto A y la salida de B, el pasajero ocupaba plaza
     * en la guagua de B mientras el manifiesto de B lo listaba como cliente de
     * A, y el precio salía de A con la fecha de B.
     */
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-buggy", adults: 2 }],
    })).rejects.toThrow(/no es de esa excursión/);
  });

  it("y se rechaza ANTES de tocar los contadores de la salida", async () => {
    // `assertCapacity` recalcula y PERSISTE los contadores de la salida que se
    // le diga: comprobar después habría dejado tocada la guagua equivocada.
    const antes = db.row("departure", { _id: "sal-buggy" })!;
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-buggy", adults: 2 }],
    })).rejects.toThrow();

    const despues = db.row("departure", { _id: "sal-buggy" })!;
    expect(despues.pending_pax ?? 0).toBe(antes.pending_pax ?? 0);
    expect(despues.available_pax ?? null).toBe(antes.available_pax ?? null);
    expect(db.rows("booking")).toHaveLength(0);
  });

  it("una línea buena y otra cruzada tumban la venta entera", async () => {
    // No se escribe media venta: la que iba bien tampoco nace.
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
        { product_id: "prod-buggy", departure_id: "sal-saona", adults: 1 },
      ],
    })).rejects.toThrow(/no es de esa excursión/);
    expect(db.rows("booking")).toHaveLength(0);
    expect(db.rows("order")).toHaveLength(0);
  });

  it("cada producto con su salida pasa sin ruido", async () => {
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [
        { product_id: "prod-saona", departure_id: "sal-saona", adults: 2 },
        { product_id: "prod-buggy", departure_id: "sal-buggy", adults: 1 },
      ],
    });
    expect(res.bookings).toHaveLength(2);
  });

  it("una salida SIN producto declarado se deja pasar", async () => {
    // Las hay de antes de que la columna fuera obligatoria, y lo desconocido se
    // queda como está: rechazarlas rompería ventas que hoy funcionan.
    db = fakeDb({
      ...catalogo(),
      departure: [
        { _id: "sal-vieja", departure_at: futuro(3), capacity: 30,
          booked_pax: 0, pending_pax: 0, cutoff_hours: 0, status: "available" },
      ],
    });
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-vieja", adults: 1 }],
    });
    expect(res.bookings).toHaveLength(1);
  });

  it("una venta sin salida sigue siendo una venta", async () => {
    // La reserva a fecha abierta no tiene salida que cuadrar.
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", adults: 2 }],
    });
    expect(res.bookings).toHaveLength(1);
  });

  it("una salida que no existe la sigue rechazando el cupo, con su mensaje", async () => {
    // Dos comprobaciones diciendo lo mismo de dos maneras es peor que una:
    // `assertCapacity` ya lo hacía y sigue siendo la que contesta.
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-inventada", adults: 1 }],
    })).rejects.toThrow(/Salida no encontrada/);
  });
});


/* ═══════════════════════ la venta al socio prepago ══════════════════════ */

describe("la venta de un socio prepago", () => {
  const conSaldo = (saldo: number) => {
    db = fakeDb({
      ...catalogo(),
      partner: [{
        _id: "soc-1", name: "Caribe Tours", payment_mode: "prepaid",
        currency: "usd", pricing_model: "commission",
      }],
      partner_wallet_movement: [{
        _id: "mov-0", partner: "soc-1", movement_type: "topup",
        amount: saldo, currency: "usd",
      }],
    });
  };

  it("SE DESCUENTA, y por el total de verdad", async () => {
    /**
     * Con la estimación se comprueba el saldo —para no armar la venta entera y
     * descubrir al final que no cabía— pero cobrar por ella dejaría el saldo
     * distinto de lo que el socio ve en su factura.
     */
    conSaldo(1000);
    rpc.mockClear();
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    } as never);

    expect(rpc, "la venta al socio prepago no descontó nada").toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, { p_movement: { amount: number } }];
    expect(fn).toBe("spend_partner_wallet");
    expect(args.p_movement.amount).toBe(Number(res.order.total));
  });

  it("y un saldo corto rechaza la venta ANTES de escribir nada", async () => {
    // 402 y no 403: no le faltan permisos, le falta dinero.
    conSaldo(10);
    rpc.mockClear();
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    } as never)).rejects.toMatchObject({ status: 402 });

    expect(db.rows("order"), "se escribió la venta que no cabía").toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("UN DESCUBIERTO QUEDA EN LA BITÁCORA, con el número", async () => {
    /**
     * Pasa cuando dos ventas se AUTORIZARON a la vez: la función de 0091 pone
     * los consumos en fila pero no puede deshacer una venta que ya existe, así
     * que apunta el consumo y avisa. Sin esta línea, el descubierto solo se ve
     * sumando el libro a mano.
     */
    conSaldo(1000);
    rpc.mockClear();
    rpc.mockResolvedValueOnce({
      data: {
        movement_id: "mov-2", amount: 200, currency: "usd",
        balance_before: 100, balance_after: -100, overdraft: true, already: false,
      },
      error: null,
    });
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    try {
      await createOrderWithBookings(ctx, {
        customer_id: "cli-1",
        partner_id: "soc-1",
        items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
      } as never);
    } finally {
      console.error = real;
    }

    const acciones = auditoria.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones, "el descubierto no llegó a la bitácora").toContain("partner_wallet_overdraft");
    const linea = auditoria.mock.calls
      .map((c) => c[0] as { action: string; metadata?: Record<string, unknown> })
      .find((a) => a.action === "partner_wallet_overdraft");
    expect(linea?.metadata?.balance_after).toBe(-100);
    expect(gritos.join(" ")).toMatch(/DESCUBIERTO/);
  });

  it("y un saldo que aguanta no ensucia la bitácora", async () => {
    conSaldo(1000);
    auditoria.mockReset();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    } as never);
    const acciones = auditoria.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acciones).not.toContain("partner_wallet_overdraft");
  });

  it("un socio a crédito no toca el monedero", async () => {
    db = fakeDb({
      ...catalogo(),
      partner: [{ _id: "soc-1", name: "Caribe Tours", payment_mode: "credit", currency: "usd" }],
    });
    rpc.mockClear();
    await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      partner_id: "soc-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    } as never);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ═════════════════════════════ la lista negra ═══════════════════════════ */

describe("no se le vende a quien está en la lista negra", () => {
  const vetado = (motivo: string | null = "Tres no-shows sin avisar en agosto") => {
    db = fakeDb({
      ...catalogo(),
      customer: [
        { _id: "cli-1", first_name: "Laura", last_name: "Gutiérrez", status: "active" },
        { _id: "cli-veto", first_name: "Pedro", last_name: "Mora", status: "blacklist", blocked_reason: motivo },
      ],
    });
  };

  it("LA VENTA SE RECHAZA, y con el motivo delante", async () => {
    /**
     * `customer.status` admitía `blacklist` desde la primera migración y el
     * formulario lo ofrecía en un desplegable con su etiqueta. Nadie lo leía:
     * se marcaba a una persona y seguía comprando por las cuatro puertas.
     *
     * El motivo va en el mensaje porque quien vende tiene al cliente delante y
     * decide en treinta segundos.
     */
    vetado();
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-veto",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow(/lista negra: Tres no-shows sin avisar/);
  });

  it("y se rechaza ANTES de escribir o de tocar la salida", async () => {
    // Rechazar tarde obliga a compensar escrituras que no había que haber
    // hecho, y deja tocados los contadores de una guagua que no vendió nada.
    vetado();
    const antes = db.row("departure", { _id: "sal-saona" })!;
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-veto",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow();

    expect(db.rows("order")).toHaveLength(0);
    expect(db.rows("booking")).toHaveLength(0);
    const despues = db.row("departure", { _id: "sal-saona" })!;
    expect(despues.pending_pax ?? 0).toBe(antes.pending_pax ?? 0);
  });

  it("el rechazo lleva su código, que es lo que traducen las puertas de fuera", async () => {
    // Hacia fuera no viaja ni el motivo ni la palabra: la web y la API leen el
    // código y contestan otra cosa.
    vetado();
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-veto",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toMatchObject({ status: 409, code: "CUSTOMER_BLOCKED" });
  });

  it("sin motivo anotado se rechaza igual, y se dice lo que hay", async () => {
    // Hay fichas de antes de que el motivo fuera obligatorio. El bloqueo vale;
    // lo que no se hace es inventarse una explicación.
    vetado(null);
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-veto",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).rejects.toThrow(/Este cliente está en la lista negra\.$/);
  });

  it("UNA FICHA INACTIVA SÍ COMPRA", async () => {
    /**
     * `inactive` es otra cosa: una ficha archivada, un duplicado que se retiró
     * del listado. Bloquear ventas por eso convertiría una tarea de limpieza en
     * un veto comercial sin que nadie lo decidiera.
     */
    db = fakeDb({
      ...catalogo(),
      customer: [{ _id: "cli-1", first_name: "Laura", status: "inactive" }],
    });
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(res.bookings).toHaveLength(1);
  });

  it("y un cliente normal, también", async () => {
    vetado();
    const res = await createOrderWithBookings(ctx, {
      customer_id: "cli-1",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    });
    expect(res.bookings).toHaveLength(1);
  });

  it("una ficha que no aparece no la rechaza ESTA comprobación", async () => {
    // Lo dirá la clave ajena al escribir, con su mensaje: dos comprobaciones
    // diciendo lo mismo de dos maneras es peor que una.
    vetado();
    await expect(createOrderWithBookings(ctx, {
      customer_id: "cli-inventado",
      items: [{ product_id: "prod-saona", departure_id: "sal-saona", adults: 2 }],
    })).resolves.toBeTruthy();
  });
});
