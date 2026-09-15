import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { generateSupplierSettlement, pendingBySupplier } from "@/lib/supplier-settlement-service";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/settlements/supplier — qué se le debe a cada proveedor y no está liquidado.
 *
 * Es la pantalla de los viernes: quién tiene servicios operados pendientes de
 * pagar, cuánto, y desde cuándo.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "settlements:supplier:list", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");
    return ok({ pending: await pendingBySupplier(ctx.companyId) });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/settlements/supplier — genera la liquidación de un proveedor.
 *
 * Agrupa lo devengado en el período —medido por la fecha de la SALIDA, porque al
 * proveedor se le paga por lo que operó, no por lo que se vendió—, calcula sus
 * retenciones y abre la cuenta por pagar.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "settlements:supplier:create", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      supplier_id?: string; period_from?: string; period_to?: string; notes?: string;
    }>(req);
    if (!body.supplier_id) {
      throw Object.assign(new Error("Selecciona el proveedor a liquidar"), { status: 400 });
    }

    const now = new Date();
    const from = body.period_from
      ? new Date(body.period_from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = body.period_to ? new Date(body.period_to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw Object.assign(new Error("El período no es válido"), { status: 400 });
    }
    if (from > to) {
      throw Object.assign(new Error("El período empieza después de terminar"), { status: 400 });
    }
    // El período incluye el último día entero: cortarlo a medianoche dejaría
    // fuera todo lo que salió ese día.
    to.setHours(23, 59, 59, 999);

    const result = await generateSupplierSettlement(ctx.companyId, {
      supplierId: body.supplier_id,
      from, to,
      notes: body.notes || null,
      userId: ctx.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "supplier_settlement_generated",
      entityType: "settlement", entityId: result.settlement._id,
      description: `Liquidación ${result.settlement.code} de servicios por ${result.services} ` +
        `${result.currency.toUpperCase()} (${result.claimed} servicios)`,
      metadata: {
        services: result.claimed, from: from.toISOString(), to: to.toISOString(),
        supplier: body.supplier_id,
      },
    });

    console.log(`[proveedores] ${result.settlement.code}: ${result.claimed} servicios · ${result.services} ${result.currency}`);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
