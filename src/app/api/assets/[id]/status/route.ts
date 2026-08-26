import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { changeAssetStatus, type AssetStatus } from "@/lib/asset-impact";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";

/**
 * POST /api/assets/:id/status — changes an asset's operational status and
 * propagates the consequence to sellable capacity.
 *
 * Body: { status, reason?, dryRun? }. With `dryRun: true` nothing is written and
 * the caller gets the impact preview to show the operator before confirming.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    requireAtLeast(ctx, "operations");

    const body = await readJson<{ status: AssetStatus; reason?: string; dryRun?: boolean }>(req);
    if (!body.status) {
      return fail(Object.assign(new Error("Falta el estado destino"), { status: 400 }));
    }

    const impact = await changeAssetStatus(ctx.companyId, id, body.status, {
      reason: body.reason,
      userId: ctx.userId,
      dryRun: body.dryRun === true,
    });

    if (!body.dryRun) {
      console.log(`[api] ${ctx.email} cambió el activo ${id} a ${body.status}`);
    }
    return ok(impact);
  } catch (err) {
    return fail(err);
  }
}
