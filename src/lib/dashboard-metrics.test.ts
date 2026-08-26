import { describe, expect, it } from "vitest";
import {
  netBookingAmount,
  netPaymentAmount,
  resolveDashboardPeriod,
  resolveDashboardPermissions,
  summarizeDashboard,
  trendPct,
} from "@/lib/dashboard-metrics";

describe("dashboard metrics", () => {
  it("excluye borradores y ventas inválidas", () => {
    const summary = summarizeDashboard([
      { status: "draft", total_amount: 100, currency: "usd" },
      { status: "pending_payment", total_amount: 200, currency: "usd" },
      { status: "cancelled", total_amount: 300, currency: "usd" },
      { status: "paid", total_amount: 400, currency: "usd", pax_total: 2 },
    ], [], [], "usd");
    expect(summary.netSales).toBe(400);
    expect(summary.validBookings).toBe(1);
    expect(summary.pax).toBe(2);
  });

  it("descuenta reembolsos y calcula ticket medio con denominador válido", () => {
    const summary = summarizeDashboard([
      { status: "partially_refunded", total_amount: 100, refund_amount: 25, currency: "usd", pax_total: 1 },
      { status: "paid", total_amount: 50, currency: "usd", pax_total: 1 },
      { status: "refunded", total_amount: 999, currency: "usd", pax_total: 1 },
    ], [], [], "usd");
    expect(summary.netSales).toBe(125);
    expect(summary.avgTicket).toBe(62.5);
    expect(summary.refunds).toBe(1);
    expect(summary.partialRefunds).toBe(1);
  });

  it("calcula cobros reales usando pagos completados y reembolsos como salida", () => {
    const paid = netPaymentAmount({ status: "completed", payment_type: "payment", amount: 100, currency: "usd" }, "usd");
    const refund = netPaymentAmount({ status: "completed", payment_type: "refund", amount: 35, currency: "usd" }, "usd");
    const pending = netPaymentAmount({ status: "pending", payment_type: "payment", amount: 100, currency: "usd" }, "usd");
    expect(paid.amount + refund.amount + pending.amount).toBe(65);
  });

  it("calcula margen con costos directos y comisiones no liquidadas", () => {
    const summary = summarizeDashboard([
      { status: "paid", total_amount: 200, cost_amount: 50, currency: "usd", pax_total: 2 },
    ], [], [
      { status: "pending", amount: 20, currency: "usd" },
      { status: "paid", amount: 99, currency: "usd" },
      { status: "cancelled", amount: 99, currency: "usd" },
    ], "usd");
    expect(summary.contributionMargin).toBe(130);
    expect(summary.marginPct).toBe(65);
  });

  it("no usa commission.base_amount como monto de comisión por pagar", () => {
    const summary = summarizeDashboard([
      { status: "paid", total_amount: 100, currency: "usd" },
    ], [], [
      { status: "pending", amount: 10, currency: "usd", base_amount: 1000 } as never,
    ], "usd");
    expect(summary.contributionMargin).toBe(90);
  });

  it("convierte USD y DOP con tipo de cambio congelado y detecta faltantes", () => {
    expect(netBookingAmount({ status: "paid", total_amount: 1000, currency: "dop", exchange_rate: 0.017 }, "usd")).toEqual({ amount: 17, incomplete: false });
    expect(netBookingAmount({ status: "paid", total_amount: 1000, currency: "dop", exchange_rate: 1 }, "usd")).toEqual({ amount: 0, incomplete: true });
    expect(netBookingAmount({ status: "paid", total_amount: 20, base_amount: 20, currency: "usd" }, "usd")).toEqual({ amount: 20, incomplete: false });
  });

  it("respeta America/Santo_Domingo cerca de medianoche y cambio de mes", () => {
    const period = resolveDashboardPeriod("today", null, null, { timezone: "America/Santo_Domingo" }, new Date("2026-09-01T03:30:00.000Z"));
    expect(period.label).toBe("Hoy");
    expect(period.from).toBe("2026-08-31T04:00:00.000Z");
    expect(period.to).toBe("2026-09-01T03:59:59.999Z");
  });

  it("calcula período personalizado y comparación anterior equivalente", () => {
    const period = resolveDashboardPeriod("custom", "2026-08-10", "2026-08-12", { timezone: "America/Santo_Domingo" }, new Date("2026-08-26T12:00:00.000Z"));
    expect(period.from).toBe("2026-08-10T04:00:00.000Z");
    expect(period.to).toBe("2026-08-13T03:59:59.999Z");
    expect(period.previousFrom < period.from).toBe(true);
  });

  it("aplica permisos para vendedor, cajero y operaciones", () => {
    expect(resolveDashboardPermissions("seller", { userId: "u1", sellerId: "s1" }).forcedSellerId).toBe("s1");
    expect(resolveDashboardPermissions("cashier", { userId: "u1" }).canViewMargin).toBe(false);
    expect(resolveDashboardPermissions("operations", { userId: "u1" }).canViewPayables).toBe(false);
  });

  it("calcula variación porcentual contra período anterior", () => {
    expect(trendPct(120, 100)).toBe(20);
    expect(trendPct(80, 100)).toBe(-20);
    expect(trendPct(80, 0)).toBeNull();
  });
});
