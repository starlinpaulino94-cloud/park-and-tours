import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { changeAssetStatus, type AssetStatus } from "@/lib/asset-impact";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

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
    const ctx = await requireTenantWrite();
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

    /**
     * UNA PREVISUALIZACIÓN NO SE AUDITA.
     *
     * `writeAudit` estaba FUERA de este `if`, así que cada vez que alguien
     * miraba el impacto sin confirmar quedaba escrito «cambió el estado de un
     * activo a X», con severidad de aviso. El registro de auditoría se llenaba
     * de cambios que no ocurrieron.
     *
     * Es el mismo defecto que esta auditoría lleva persiguiendo todo el día,
     * del revés: en vez de hacer algo sin dejar rastro, dejaba rastro sin hacer
     * nada. Las dos formas arruinan el registro por el mismo motivo — deja de
     * poder usarse para saber qué pasó.
     */
    if (!body.dryRun) {
      console.log(`[api] ${ctx.email} cambió el activo ${id} a ${body.status}`);
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "asset_status_changed", entityType: "asset", entityId: id,
        description: `${ctx.email} cambió el estado de un activo a ${body.status}`,
        severity: "warning",
        metadata: { estado: body.status, motivo: body.reason || null },
      });
    }
    return ok(impact);
  } catch (err) {
    return fail(err);
  }
}
