import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { reconcileStaleDrafts } from "@/lib/booking-service";
import { expireApprovals } from "@/lib/approvals";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/maintenance/reconcile-drafts (AUD-F34 follow-up)
 *
 * Reverts orphaned `draft` orders left by a hard crash mid-saga (releasing
 * their seats and voiding children). Safe to run repeatedly. Intended for a
 * periodic cron or an admin cleanup action.
 *
 * Body: { older_than_minutes?: number } (default 30)
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<{ older_than_minutes?: number }>(req);
    const minutes = Number.isFinite(body.older_than_minutes) && (body.older_than_minutes as number) >= 0
      ? (body.older_than_minutes as number)
      : 30;

    const result = await reconcileStaleDrafts(ctx.companyId, minutes);

    // Las solicitudes de aprobación caducadas ya se descartan al consultarlas;
    // esto solo hace que el estado guardado se ponga al día para el historial.
    // Es una escritura, así que vive aquí y nunca en el render de una pantalla.
    let expiredApprovals = 0;
    try {
      expiredApprovals = await expireApprovals(ctx.companyId);
    } catch (err) {
      console.error("[maintenance] no se pudieron expirar aprobaciones:", err);
    }

    if (result.reverted > 0) {
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "drafts_reconciled", entityType: "order", entityId: ctx.companyId,
        description: `Reconciliación de drafts: ${result.reverted} de ${result.scanned} revertidas`,
        severity: "warning",
        metadata: result,
      });
    }

    return ok({ ...result, expiredApprovals });
  } catch (err) {
    return fail(err);
  }
}
