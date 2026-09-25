import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * LOS AJUSTES DE COMISIÓN CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ DECIDE ESTE SERVICIO, SI TODO LO DEMÁS ES PURO
 *
 * `commission-adjustments.ts` decide cuánto y por qué, y está probado. Lo que
 * decide ESTE fichero es qué se escribe y en qué orden, y ahí hay tres cosas que
 * ninguna prueba cubría:
 *
 *   1. **El neto se recalcula en la aplicación y no con un disparador.** Un
 *      disparador sería un SEGUNDO sitio donde se decide dinero, y el día que las
 *      dos fórmulas se separen la diferencia aparece en una liquidación sin que
 *      nada la explique.
 *   2. **Una comisión PAGADA no cambia de estado al cancelarse la reserva.**
 *      Sigue estando pagada, porque se pagó: se le mete un ajuste en negativo. El
 *      estado `cancelled` sobre dinero que salió es la mentira que el ajuste viene
 *      a evitar.
 *   3. **Y eso tiene que ser visible.** Es dinero fuera que hay que recuperar de
 *      la siguiente liquidación; sin aviso, el ajuste existe y nadie actúa.
 */

let db: FakeDb;
const auditadas: Record<string, unknown>[] = [];

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
vi.mock("@/lib/audit", () => ({
  writeAudit: async (entrada: Record<string, unknown>) => { auditadas.push(entrada); },
}));

import {
  adjustCommission, syncCommissionNet, adjustmentsOf, settleCommissionsOnCancel,
} from "@/lib/commission-adjust-service";
import type { TenantContext } from "@/lib/tenant";

const ctx = { companyId: "c1", userId: "u1" } as TenantContext & { companyId: string };

const comision = (over: Record<string, unknown> = {}) => ({
  _id: "com-1", booking: "bk-1", amount: 100, currency: "usd",
  status: "pending", beneficiary_name: "Ana", ...over,
});

beforeEach(() => {
  db = fakeDb();
  auditadas.length = 0;
});

describe("un ajuste firmado", () => {
  beforeEach(() => { db.seed("commission", [comision()]); });

  it("se guarda con SU SIGNO y deja el neto al día", async () => {
    /**
     * El signo está en el importe a propósito: un ajuste que solo puede restar no
     * sirve para corregir a favor del vendedor, y dos campos —«tipo» e «importe»—
     * admiten que digan cosas distintas.
     */
    const r = await adjustCommission(ctx, {
      commissionId: "com-1", amount: -30, reason: "cliente pagó menos",
    });

    expect(r.net).toBe(70);
    expect(db.rows("commission_adjustment")[0]).toMatchObject({
      commission: "com-1", amount: -30, currency: "usd", reason: "cliente pagó menos",
      reason_code: "correction",
    });
    expect(db.row("commission", { _id: "com-1" })).toMatchObject({
      adjustment_total: -30, net_amount: 70,
    });
  });

  it("y uno POSITIVO también: se puede corregir a favor", async () => {
    const r = await adjustCommission(ctx, {
      commissionId: "com-1", amount: 25, reason: "se le pagó de menos el mes pasado",
    });
    expect(r.net).toBe(125);
  });

  it("varios ajustes se acumulan, no se pisan", async () => {
    // El neto sale de SUMAR los ajustes. Con el último ganando, corregir dos veces
    // borraría la primera corrección sin dejar rastro del cambio.
    await adjustCommission(ctx, { commissionId: "com-1", amount: -10, reason: "uno" });
    await adjustCommission(ctx, { commissionId: "com-1", amount: -15, reason: "dos" });
    expect(db.row("commission", { _id: "com-1" })).toMatchObject({
      adjustment_total: -25, net_amount: 75,
    });
    expect(await adjustmentsOf("c1", "com-1")).toHaveLength(2);
  });

  it("sin motivo NO se escribe nada", async () => {
    /**
     * Un ajuste sin motivo es dinero movido que nadie puede explicar tres meses
     * después. Y se comprueba que no queda a medias: ni la fila del ajuste ni el
     * neto tocado.
     */
    await expect(adjustCommission(ctx, { commissionId: "com-1", amount: -30, reason: "  " }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.rows("commission_adjustment")).toEqual([]);
    expect(db.row("commission", { _id: "com-1" })!.net_amount).toBeUndefined();
  });

  it("ni sobre una comisión que no existe", async () => {
    await expect(adjustCommission(ctx, { commissionId: "no-existe", amount: -1, reason: "x" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("y queda en la bitácora como AVISO, con el neto que dejó", async () => {
    // Mover una comisión es mover el sueldo de alguien: en un listado donde todo
    // es informativo, esto se lee como un apunte más.
    await adjustCommission(ctx, { commissionId: "com-1", amount: -30, reason: "cliente pagó menos" });
    expect(auditadas[0]).toMatchObject({
      action: "commission_adjusted", entityType: "commission", entityId: "com-1",
      severity: "warning", metadata: { amount: -30, net: 70 },
    });
    expect(String(auditadas[0].description)).toContain("Ana");
    expect(String(auditadas[0].description)).toContain("70");
  });
});

describe("el neto se recalcula en la aplicación", () => {
  it("desde los ajustes, no desde un número guardado", async () => {
    /**
     * Si el neto viviera solo como columna, una escritura a medias lo dejaría
     * discrepando de sus ajustes — y cuando discrepa nadie sabe cuál de los dos es
     * el bueno. Aquí se puede recalcular en cualquier momento y da lo mismo.
     */
    db.seed("commission", [comision({ amount: 200, net_amount: 999 })]);
    db.seed("commission_adjustment", [
      { _id: "a1", commission: "com-1", amount: -50, created_at: "2026-01-01" },
      { _id: "a2", commission: "com-1", amount: -20, created_at: "2026-01-02" },
    ]);
    expect(await syncCommissionNet("c1", "com-1")).toBe(130);
    expect(db.row("commission", { _id: "com-1" })).toMatchObject({
      adjustment_total: -70, net_amount: 130,
    });
  });

  it("y una comisión que ya no está devuelve cero sin reventar", async () => {
    // El recálculo lo llaman dos caminos; que uno llegue tarde a una comisión
    // borrada no puede tumbar una cancelación.
    expect(await syncCommissionNet("c1", "fantasma")).toBe(0);
  });
});

describe("cuando se cancela la reserva", () => {
  it("LAS PENDIENTES SE ANULAN y su neto queda en cero", async () => {
    db.seed("commission", [comision({ status: "pending" })]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");

    expect(r).toMatchObject({ voided: 1, adjusted: 0, clawback: 0 });
    expect(db.row("commission", { _id: "com-1" })).toMatchObject({
      status: "cancelled", net_amount: 0,
    });
  });

  it("LAS PAGADAS NO CAMBIAN DE ESTADO: se ajustan en negativo", async () => {
    /**
     * Antes de 0059 esto anulaba las pendientes y no tocaba las pagadas: el dinero
     * había salido, la venta se caía, y no quedaba ni rastro de que hubiera que
     * recuperarlo.
     *
     * Y sigue estando `paid`, porque se pagó. Poner `cancelled` sobre una comisión
     * cuyo dinero salió haría que el histórico dijera que nunca se pagó.
     */
    db.seed("commission", [comision({ status: "paid" })]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");

    expect(r).toMatchObject({ voided: 0, adjusted: 1, clawback: 100 });
    expect(db.row("commission", { _id: "com-1" })!.status, "se le cambió el estado a una comisión pagada")
      .toBe("paid");
    expect(db.rows("commission_adjustment")[0]).toMatchObject({
      amount: -100, reason_code: "cancellation", booking: "bk-1",
    });
    expect(db.row("commission", { _id: "com-1" })!.net_amount).toBe(0);
  });

  it("y el ajuste es por el NETO, no por el bruto", async () => {
    // Una comisión de 100 a la que ya se le habían quitado 40 solo puede
    // recuperarse por 60: pedir 100 sería cobrarle dos veces la primera corrección.
    db.seed("commission", [comision({ status: "paid", amount: 100 })]);
    db.seed("commission_adjustment", [
      { _id: "a1", commission: "com-1", amount: -40, created_at: "2026-01-01" },
    ]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    expect(r.clawback).toBe(60);
  });

  it("una pagada que ya está a cero NO genera un ajuste vacío", async () => {
    // No hay nada que recuperar: la fila solo ensuciaría el listado y el aviso
    // mandaría a alguien a buscar un dinero que no existe.
    db.seed("commission", [comision({ status: "paid", amount: 100 })]);
    db.seed("commission_adjustment", [
      { _id: "a1", commission: "com-1", amount: -100, created_at: "2026-01-01" },
    ]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    expect(r).toMatchObject({ voided: 0, adjusted: 0, clawback: 0 });
    expect(db.rows("commission_adjustment")).toHaveLength(1);
  });

  it("y una ya cancelada no se vuelve a tocar", async () => {
    // Cancelar dos veces la misma reserva no puede anular dos veces ni sumar al
    // dinero a recuperar.
    db.seed("commission", [comision({ status: "cancelled" })]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    expect(r).toMatchObject({ voided: 0, adjusted: 0, clawback: 0 });
  });

  it("EL DINERO A RECUPERAR SE AVISA, y solo cuando lo hay", async () => {
    /**
     * Es dinero que ya salió y que hay que recuperar de la siguiente liquidación.
     * Sin el aviso, el ajuste existe en la base y nadie actúa — que es el estado
     * del que venimos.
     */
    db.seed("commission", [comision({ status: "paid" })]);
    await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    const aviso = auditadas.find((a) => a.action === "commission_clawback");
    expect(aviso).toBeTruthy();
    expect(aviso!.severity).toBe("warning");
    expect(aviso!.metadata).toMatchObject({ adjusted: 1, clawback: 100 });
    expect(String(aviso!.description)).toContain("R-001");
  });

  it("y con una pendiente no se avisa de nada que recuperar", async () => {
    // Anular una comisión que nunca se pagó no deja dinero fuera: un aviso aquí
    // sería una alarma que a la tercera vez nadie mira.
    db.seed("commission", [comision({ status: "pending" })]);
    await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    expect(auditadas.some((a) => a.action === "commission_clawback")).toBe(false);
  });

  it("varias comisiones de la misma reserva se resuelven cada una por su estado", async () => {
    // Una reserva puede tener la del vendedor y la del socio, en estados
    // distintos: tratarlas igual anularía una pagada o dejaría viva una pendiente.
    db.seed("commission", [
      comision({ _id: "com-pend", status: "pending" }),
      comision({ _id: "com-pag", status: "paid", amount: 40 }),
    ]);
    const r = await settleCommissionsOnCancel(ctx, "bk-1", "R-001");
    expect(r).toMatchObject({ voided: 1, adjusted: 1, clawback: 40 });
  });
});
