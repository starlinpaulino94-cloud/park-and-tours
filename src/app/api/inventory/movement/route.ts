import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { postMovement, type MovementInput } from "@/lib/inventory";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

/** POST /api/inventory/movement — the only way stock quantities may change. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "operations");

    const body = await readJson<MovementInput>(req);
    const result = await postMovement(ctx.companyId, { ...body, user: ctx.userId });

    console.log(`[api] ${ctx.email} registró un movimiento de stock (${body.movement_type})`);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "stock_movement_posted", entityType: "stock_movement",
      description: `${ctx.email} movió inventario`,
      metadata: { tipo: body?.movement_type, articulo: body?.inventory_item },
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
