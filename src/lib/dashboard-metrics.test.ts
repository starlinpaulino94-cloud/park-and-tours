import { describe, expect, it } from "vitest";
import {
  netBookingAmount,
  netPaymentAmount,
  resolveDashboardPeriod,
  MAX_PERIOD_DAYS,
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

  /**
   * EL RANGO A MEDIDA NO PUEDE SER INFINITO (9.17, P-001).
   *
   * `period=custom` aceptaba cualquier par de fechas. Medido: con 120.000
   * reservas, un año son ~450 ms y la función barre DOS ventanas —la pedida y
   * su comparativa—, así que `from=1900-01-01` pide dos barridos de un siglo
   * con un limitador que deja pasar 90 peticiones por minuto.
   */
  describe("tope del rango a medida", () => {
    const TZ = { timezone: "America/Santo_Domingo" };
    const AHORA = new Date("2026-08-26T12:00:00.000Z");
    const dias = (p: { from: string; to: string }) =>
      Math.round((new Date(p.to).getTime() - new Date(p.from).getTime()) / 86_400_000);

    it("un siglo se recorta a MAX_PERIOD_DAYS y se dice", () => {
      const period = resolveDashboardPeriod("custom", "1900-01-01", "2026-08-26", TZ, AHORA);
      expect(period.truncated).toBe(true);
      expect(dias(period)).toBeLessThanOrEqual(MAX_PERIOD_DAYS);
      // Se conserva el FINAL, que es lo que el usuario está mirando; lo que se
      // mueve hacia adelante es el principio.
      expect(period.to).toBe("2026-08-27T03:59:59.999Z");
      expect(new Date(period.from).getTime())
        .toBe(new Date(period.to).getTime() - MAX_PERIOD_DAYS * 86_400_000);
    });

    it("la comparativa se acorta con él y no se queda en un siglo", () => {
      const period = resolveDashboardPeriod("custom", "1900-01-01", "2026-08-26", TZ, AHORA);
      // Sin esto el recorte sería inútil: la ventana anterior es otro barrido.
      // El +1 no es holgura inventada: `shiftRange` encaja la comparativa en
      // días naturales enteros de la zona de la empresa, así que puede salir
      // hasta un día más larga que la ventana al milisegundo que refleja.
      expect(dias({ from: period.previousFrom, to: period.previousTo }))
        .toBeLessThanOrEqual(MAX_PERIOD_DAYS + 1);
      expect(period.previousTo <= period.from).toBe(true);
    });

    it("un rango que cabe pasa intacto y no se marca", () => {
      const period = resolveDashboardPeriod("custom", "2026-08-10", "2026-08-12", TZ, AHORA);
      expect(period.truncated).toBe(false);
      expect(period.from).toBe("2026-08-10T04:00:00.000Z");
      expect(period.to).toBe("2026-08-13T03:59:59.999Z");
    });

    it("ninguno de los presets que ofrece la interfaz se ve recortado", () => {
      // 366 es el mayor de ellos (`year` en bisiesto): si el tope los tocara,
      // el panel estaría mintiendo en su uso normal.
      for (const key of ["today", "yesterday", "week", "month", "quarter", "year"]) {
        const period = resolveDashboardPeriod(key, null, null, TZ, new Date("2028-12-31T12:00:00.000Z"));
        expect(period.truncated, `el preset ${key} salió recortado`).toBe(false);
      }
    });

    it("el tope se aplica justo en el borde, no un día después", () => {
      const justo = resolveDashboardPeriod("custom", "2025-08-27", "2026-08-26", TZ, AHORA);
      expect(dias(justo)).toBeLessThanOrEqual(MAX_PERIOD_DAYS);
      expect(justo.truncated).toBe(false);
      const uno_mas = resolveDashboardPeriod("custom", "2025-08-20", "2026-08-26", TZ, AHORA);
      expect(uno_mas.truncated).toBe(true);
    });
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
