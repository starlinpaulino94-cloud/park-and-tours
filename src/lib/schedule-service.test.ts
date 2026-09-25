import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL CALENDARIO DE COBRO, PERSISTIDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * El reparto de lo cobrado sobre las cuotas —qué se imputa a cuál y en qué
 * orden— vive en `collections.ts` y está probado. Lo que decide ESTE fichero
 * es cuándo se rehace el plan, qué se guarda de él y qué NO se pisa:
 *
 *   · un plan pactado a mano no se rehace solo en el siguiente cobro;
 *   · lo imputado se deriva de `paid_total` y no se acumula, así que
 *     recalcular mil veces tiene que dar lo mismo;
 *   · y lo derivado es lo imputado Y el saldo, no solo lo primero.
 *
 * Lo tercero es lo que estaba roto: una cuota cuyo importe se corrige a mano se
 * quedaba con el saldo del importe viejo, y el saldo es lo que el cliente ve.
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

import {
  ensureSchedule, setSchedule, refreshAllocation, scheduleRefFor, syncBookingDueDates,
} from "@/lib/schedule-service";

const ORG = "org-1";
const futuro = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();
const dia = (iso: string) => iso.slice(0, 10);

const cuotas = () =>
  db.rows("payment_schedule").sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
const vivas = () => cuotas().filter((c) => c.status !== "cancelled" && c.status !== "waived");

function venta(over: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  db = fakeDb({
    order: [{
      _id: "ord-1", total: 1000, paid_total: 0, balance: 1000, currency: "usd",
      status: "pending_payment", ...over,
    }],
    product: [
      { _id: "prod-saona", name: "Isla Saona", deposit_type: "percent", deposit_percent: 30,
        balance_due_days: 5 },
      { _id: "prod-buggy", name: "Buggy" },
    ],
    departure: [
      { _id: "sal-saona", product: "prod-saona", departure_at: futuro(20) },
      { _id: "sal-buggy", product: "prod-buggy", departure_at: futuro(30) },
    ],
    booking: [{
      _id: "res-1", order: "ord-1", product: "prod-saona", departure: "sal-saona",
      status: "confirmed", total_amount: 1000,
    }],
    ...extra,
  });
}

beforeEach(() => { venta(); });

/* ════════════════════════════ armar el plan ═════════════════════════════ */

describe("el plan de cobro nace de la política del producto", () => {
  it("un 30 % de anticipo y el resto de saldo", async () => {
    await ensureSchedule(ORG, "ord-1");
    const plan = cuotas();
    expect(plan).toHaveLength(2);
    expect(plan[0].kind).toBe("deposit");
    expect(Number(plan[0].amount)).toBe(300);
    expect(Number(plan[1].amount)).toBe(700);
  });

  it("el saldo vence antes de la salida: no se sube al autobús debiendo", async () => {
    await ensureSchedule(ORG, "ord-1");
    const saldo = cuotas()[1];
    expect(String(saldo.due_date) <= dia(futuro(20))).toBe(true);
  });

  it("una venta de cero no tiene nada que cobrar", async () => {
    venta({ total: 0 });
    await ensureSchedule(ORG, "ord-1");
    expect(cuotas()).toHaveLength(0);
  });

  it("NO SE PISA un plan pactado a mano", async () => {
    // Un gerente pudo acordar cuotas a medida; rehacerlo en cada cobro las
    // borraría.
    await setSchedule(ORG, "ord-1", [
      { sequence: 1, kind: "installment", due_date: dia(futuro(3)), amount: 400 },
      { sequence: 2, kind: "installment", due_date: dia(futuro(10)), amount: 600 },
    ]);
    await ensureSchedule(ORG, "ord-1");
    expect(vivas()).toHaveLength(2);
    expect(Number(vivas()[0].amount)).toBe(400);
  });

  it("la política manda la del producto que más pesa en la venta", async () => {
    venta({}, {
      booking: [
        { _id: "res-1", order: "ord-1", product: "prod-buggy", departure: "sal-buggy",
          status: "confirmed", total_amount: 200 },
        { _id: "res-2", order: "ord-1", product: "prod-saona", departure: "sal-saona",
          status: "confirmed", total_amount: 800 },
      ],
    });
    await ensureSchedule(ORG, "ord-1");
    expect(Number(cuotas()[0].amount), "no salió el 30 % de la Saona").toBe(300);
  });

  it("las condiciones de la ORDEN mandan sobre las del producto", async () => {
    venta({ deposit_type: "amount", deposit_amount: 150 });
    await ensureSchedule(ORG, "ord-1");
    expect(Number(cuotas()[0].amount)).toBe(150);
  });

  it("una reserva cancelada no pone fecha de vencimiento a nada", async () => {
    venta({}, {
      booking: [{ _id: "res-1", order: "ord-1", product: "prod-saona", departure: "sal-saona",
        status: "cancelled", total_amount: 1000 }],
    });
    const salida = await syncBookingDueDates(ORG, "ord-1");
    expect(salida).toHaveLength(0);
  });

  it("y el vencimiento se guarda EN la reserva, que es por donde sale el aviso", async () => {
    // Una orden con dos excursiones en fechas distintas tiene dos vencimientos
    // y dos recordatorios.
    await syncBookingDueDates(ORG, "ord-1");
    const reserva = db.row("booking", { _id: "res-1" })!;
    expect(reserva.balance_due_date).toBeTruthy();
    expect(String(reserva.balance_due_date) <= dia(futuro(20))).toBe(true);
  });
});

/* ══════════════════════ el plan pactado a mano ══════════════════════════ */

describe("reemplazar el plan", () => {
  it("las cuotas tienen que sumar la venta", async () => {
    await expect(setSchedule(ORG, "ord-1", [
      { sequence: 1, kind: "installment", due_date: dia(futuro(3)), amount: 400 },
    ])).rejects.toThrow(/Tienen que cuadrar/);
  });

  it("y cada una necesita su fecha", async () => {
    await expect(setSchedule(ORG, "ord-1", [
      { sequence: 1, kind: "installment", due_date: "", amount: 1000 },
    ])).rejects.toThrow(/fecha de vencimiento/);
  });

  it("el plan viejo se ANULA, no se borra: podía llevar un cobro encima", async () => {
    await ensureSchedule(ORG, "ord-1");
    await setSchedule(ORG, "ord-1", [
      { sequence: 1, kind: "installment", due_date: dia(futuro(5)), amount: 1000 },
    ]);
    expect(cuotas().filter((c) => c.status === "cancelled")).toHaveLength(2);
    expect(vivas()).toHaveLength(1);
  });

  it("y el plan nuevo sigue numerando donde acabó el viejo", async () => {
    await ensureSchedule(ORG, "ord-1");
    await setSchedule(ORG, "ord-1", [
      { sequence: 1, kind: "installment", due_date: dia(futuro(5)), amount: 1000 },
    ]);
    expect(Number(vivas()[0].sequence)).toBe(3);
  });

  it("UN PLAN NUEVO NO REUTILIZA LOS NÚMEROS DE UNO MUERTO", async () => {
    /**
     * Se llega aquí cuando todas las cuotas anteriores están perdonadas o
     * anuladas: `ensureSchedule` no encontraba ninguna viva y volvía a numerar
     * desde 1. La venta acababa con dos cuotas «1» y dos «2» —una muerta y otra
     * viva— y el recibo que dice «abono de la cuota 2 de 3» deja de poder
     * señalar una sola.
     */
    await ensureSchedule(ORG, "ord-1");
    for (const c of cuotas()) {
      await db.tenantUpdate(ORG, "payment_schedule", String(c._id), { status: "waived" });
    }
    await ensureSchedule(ORG, "ord-1");

    const numeros = cuotas().map((c) => Number(c.sequence));
    expect(new Set(numeros).size, "hay números de cuota repetidos").toBe(numeros.length);
  });
});

/* ══════════════════════ repartir lo cobrado ═════════════════════════════ */

describe("lo imputado se deriva, no se acumula", () => {
  it("un anticipo pagado deja su cuota en «paid» y la otra pendiente", async () => {
    await ensureSchedule(ORG, "ord-1");
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 300 });
    await refreshAllocation(ORG, "ord-1");

    const plan = cuotas();
    expect(plan[0].status).toBe("paid");
    expect(Number(plan[0].paid_amount)).toBe(300);
    expect(Number(plan[0].balance)).toBe(0);
    expect(plan[1].status).not.toBe("paid");
  });

  it("recalcular mil veces da lo mismo", async () => {
    await ensureSchedule(ORG, "ord-1");
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 500 });
    await refreshAllocation(ORG, "ord-1");
    const primera = cuotas().map((c) => [c.sequence, c.paid_amount, c.balance, c.status]);
    await refreshAllocation(ORG, "ord-1");
    await refreshAllocation(ORG, "ord-1");
    expect(cuotas().map((c) => [c.sequence, c.paid_amount, c.balance, c.status])).toEqual(primera);
  });

  it("un reembolso baja lo imputado en vez de sumarse", async () => {
    // Es lo que se rompe si se acumula pago a pago: el dinero devuelto se
    // quedaría imputado para siempre.
    await ensureSchedule(ORG, "ord-1");
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 1000 });
    await refreshAllocation(ORG, "ord-1");
    expect(cuotas().every((c) => c.status === "paid")).toBe(true);

    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 300 });
    await refreshAllocation(ORG, "ord-1");
    const plan = cuotas();
    expect(plan[0].status).toBe("paid");
    expect(Number(plan[1].paid_amount)).toBe(0);
    expect(Number(plan[1].balance)).toBe(700);
  });

  it("un `paid_total` negativo no imputa en negativo", async () => {
    await ensureSchedule(ORG, "ord-1");
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: -50 });
    await refreshAllocation(ORG, "ord-1");
    expect(cuotas().every((c) => Number(c.paid_amount) === 0)).toBe(true);
  });

  it("EL SALDO TAMBIÉN SE DERIVA", async () => {
    /**
     * La comparación de «no ha cambiado» miraba lo imputado y el estado, y no
     * el saldo. Una cuota cuyo importe se corrige a mano —el gerente baja la
     * última de 700 a 500— sale con el mismo `paid_amount` y el mismo estado,
     * así que se quedaba con el `balance` del importe viejo: el plan seguía
     * pidiendo doscientos que ya nadie debe, y el saldo es lo que el cliente ve
     * en su cuota.
     */
    await ensureSchedule(ORG, "ord-1");
    const saldo = cuotas()[1];
    await db.tenantUpdate(ORG, "payment_schedule", String(saldo._id), { amount: 500 });
    await refreshAllocation(ORG, "ord-1");
    expect(Number(cuotas()[1].balance), "el saldo se quedó con el importe viejo").toBe(500);
  });

  it("las cuotas muertas no entran en el reparto", async () => {
    await ensureSchedule(ORG, "ord-1");
    const anticipo = cuotas()[0];
    await db.tenantUpdate(ORG, "payment_schedule", String(anticipo._id), { status: "waived" });
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 700 });
    await refreshAllocation(ORG, "ord-1");

    expect(cuotas()[0].status, "una cuota perdonada volvió a la vida").toBe("waived");
    expect(cuotas()[1].status).toBe("paid");
  });

  it("sin plan no hay nada que repartir, y no se inventa uno", async () => {
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 500 });
    await refreshAllocation(ORG, "ord-1");
    expect(cuotas()).toHaveLength(0);
  });

  it("el estado de cobro de la venta se guarda en la orden", async () => {
    await ensureSchedule(ORG, "ord-1");
    await db.tenantUpdate(ORG, "order", "ord-1", { paid_total: 1000 });
    await refreshAllocation(ORG, "ord-1");
    expect(db.row("order", { _id: "ord-1" })!.collection_status).toBe("settled");
  });
});

/* ═════════════════════ la cuota que señala un recibo ════════════════════ */

describe("a qué cuota apunta un cobro", () => {
  it("cuando cubre una sola, la señala", async () => {
    await ensureSchedule(ORG, "ord-1");
    const ref = await scheduleRefFor(ORG, "ord-1", 300);
    expect(ref).toBe(String(cuotas()[0]._id));
  });

  it("cuando se reparte entre varias, no señala ninguna", async () => {
    // Es una etiqueta para el recibo, no un saldo: «abono de la cuota 2 de 3»
    // sobre un pago que cubre dos cuotas sería mentira.
    await ensureSchedule(ORG, "ord-1");
    expect(await scheduleRefFor(ORG, "ord-1", 900)).toBeNull();
  });

  it("sin plan no señala nada", async () => {
    expect(await scheduleRefFor(ORG, "ord-1", 300)).toBeNull();
  });
});
