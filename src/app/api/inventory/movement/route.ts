import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { postMovement, type MovementInput } from "@/lib/inventory";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";

/** POST /api/inventory/movement — the only way stock quantities may change. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    requireAtLeast(ctx, "operations");

    const body = await readJson<MovementInput>(req);
    const result = await postMovement(ctx.companyId, { ...body, user: ctx.userId });

    console.log(`[api] ${ctx.email} registró un movimiento de stock (${body.movement_type})`);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
