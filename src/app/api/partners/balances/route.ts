import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { refId } from "@/lib/types";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Receivable } from "@/lib/types";

const MAX_ROWS = 1000;

/**
 * GET /api/partners/balances — deuda viva de cada partner.
 *
 * El saldo no se guarda en el partner a propósito: la verdad son sus cuentas por
 * cobrar abiertas, y una copia en la ficha se desincronizaría sola. Se agrega
 * aquí, con la misma definición que usa el portal B2B y el informe de
 * antigüedad, para que la lista de partners pueda enseñar el saldo junto al
 * límite de crédito — que es lo único que hace útil al límite.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "partners:balances", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const rows = await tenantQuery<Receivable>(ctx.companyId, "receivable", {
      _filter: { status: { nin: ["paid", "written_off"] } },
      _limit: MAX_ROWS,
    });

    const balances: Record<string, { balance: number; documents: number; overdue: number; currency?: string }> = {};
    const today = new Date().toISOString().slice(0, 10);

    for (const r of rows) {
      const partnerId = refId(r.partner);
      if (!partnerId) continue;
      const balance = r.balance ?? Math.max((r.amount ?? 0) - (r.paid_amount ?? 0), 0);
      if (balance <= 0) continue;

      const entry = (balances[partnerId] ||= { balance: 0, documents: 0, overdue: 0, currency: r.currency });
      entry.balance += balance;
      entry.documents += 1;
      if (r.due_date && r.due_date.slice(0, 10) < today) entry.overdue += balance;
    }

    for (const entry of Object.values(balances)) {
      entry.balance = Math.round((entry.balance + Number.EPSILON) * 100) / 100;
      entry.overdue = Math.round((entry.overdue + Number.EPSILON) * 100) / 100;
    }

    return ok(balances);
  } catch (err) {
    return fail(err);
  }
}
