import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { statusFor, dayOf, daysBetween } from "@/lib/collections";
import { sellerCanReadRow, sellerScopeApplies } from "@/lib/seller-scope";
import { refId } from "@/lib/types";
import type { PaymentScheduleRow } from "@/lib/types";

const MAX_ROWS = 500;

/**
 * GET /api/reports/collections — lo que está por cobrar, con fecha.
 *
 * El informe de antigüedad (`/api/reports/aging`) solo ve las cuentas por cobrar
 * B2B, que se crean únicamente cuando la venta lleva socio. El saldo de un
 * cliente directo no aparecía en ninguna parte de finanzas: vivía en
 * `order.balance`, sin fecha y sin lista. Esto lo saca por vencimiento, que es
 * como se cobra.
 *
 * `window`: `overdue` lo ya vencido, `week` los próximos 7 días, `month` los 30,
 * `all` todo lo pendiente.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "reports:collections", ctx.userId), limit: 60, windowMs: 60_000 });
    // Un vendedor cobra: tiene que poder ver a quién le toca pagar.
    requireAtLeast(ctx, "seller");

    const window = req.nextUrl.searchParams.get("window") || "all";
    const now = new Date();
    const today = dayOf(now)!;

    const filter: Record<string, unknown> = { status: { in: ["pending", "partially_paid", "overdue"] } };
    if (window === "overdue") filter.due_date = { lt: today };
    else if (window === "week") filter.due_date = { lte: dayOf(new Date(now.getTime() + 7 * 86_400_000)) };
    else if (window === "month") filter.due_date = { lte: dayOf(new Date(now.getTime() + 30 * 86_400_000)) };

    const rows = await tenantQuery<PaymentScheduleRow & { order?: any; booking?: any }>(
      ctx.companyId, "payment_schedule", {
        _filter: filter,
        _limit: MAX_ROWS,
        _sort: { due_date: "asc" },
        order: true,
        booking: true,
      }
    );

    // Una venta cancelada no se cobra: dejarla en la lista hace perseguir dinero
    // que ya no existe.
    const DEAD_ORDER = new Set(["cancelled", "refunded"]);

    /**
     * Un vendedor cobra LO SUYO, no lo de todos.
     *
     * `payment_schedule` no tiene columna de vendedor —el vendedor es el de la
     * orden—, así que la capa de consulta no puede acotarlo y se acota aquí,
     * sobre la orden ya expandida, con la misma regla de `seller-scope.ts`:
     * lo suyo, o lo que no es de ningún vendedor.
     *
     * El recorte es POSTERIOR al tope de filas, así que un vendedor puede ver
     * menos de las suyas de las que hay cuando la empresa supera las 500
     * pendientes. Se prefiere enseñar de menos a enseñar la cartera ajena.
     */
    const sellerScoped = sellerScopeApplies(ctx.role);

    const installments = rows
      .filter((row) => {
        const status = typeof row.order === "object" ? row.order?.status : null;
        if (status && DEAD_ORDER.has(status)) return false;
        if (sellerScoped) {
          const owner = typeof row.order === "object" ? refId(row.order?.seller) : null;
          if (!sellerCanReadRow("order", ctx.role, ctx.sellerId, owner)) return false;
        }
        const balance = row.balance ?? Math.max((row.amount ?? 0) - (row.paid_amount ?? 0), 0);
        return balance > 0.009;
      })
      .map((row) => {
        const balance = row.balance ?? Math.max((row.amount ?? 0) - (row.paid_amount ?? 0), 0);
        const due = dayOf(row.due_date);
        return {
          ...row,
          balance,
          // El estado se recalcula al leer: la cobranza corre una vez al día y
          // entre una pasada y la siguiente una cuota vence de verdad.
          status: statusFor(row, now),
          days_overdue: due && due < today ? daysBetween(due, today) : 0,
          days_to_due: due && due >= today ? daysBetween(today, due) : 0,
        };
      });

    const byCurrency = new Map<string, { currency: string; overdue: number; due_soon: number; later: number; total: number }>();
    for (const installment of installments) {
      const currency = String(installment.currency || "usd").toLowerCase();
      const bucket = byCurrency.get(currency) || { currency, overdue: 0, due_soon: 0, later: 0, total: 0 };
      if (installment.days_overdue > 0) bucket.overdue += installment.balance;
      else if (installment.days_to_due <= 7) bucket.due_soon += installment.balance;
      else bucket.later += installment.balance;
      bucket.total += installment.balance;
      byCurrency.set(currency, bucket);
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totals = [...byCurrency.values()]
      .map((bucket) => ({
        currency: bucket.currency,
        overdue: round2(bucket.overdue),
        due_soon: round2(bucket.due_soon),
        later: round2(bucket.later),
        total: round2(bucket.total),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    return ok({
      window,
      installments,
      // Por moneda, nunca sumadas: el saldo en pesos y el saldo en dólares no se
      // suman en un número, ni convirtiéndolos con la tasa de hoy.
      totals,
      truncated: rows.length >= MAX_ROWS,
    });
  } catch (err) {
    return fail(err);
  }
}
