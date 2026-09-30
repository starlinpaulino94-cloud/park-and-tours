import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { reconcileStaleDrafts } from "@/lib/booking-service";
import { expireApprovals } from "@/lib/approvals";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";

/**
 * POST /api/maintenance/reconcile-drafts (AUD-F34 follow-up)
 *
 * Reverts orphaned `draft` orders left by a hard crash mid-saga (releasing
 * their seats and voiding children). Safe to run repeatedly. Intended for a
 * periodic cron or an admin cleanup action.
 *
 * Body: { older_than_minutes?: number } (default 30, mínimo 5)
 */
/** Por debajo de esto se revertirían ventas que todavía se están escribiendo. */
const MINUTOS_MINIMOS = 5;

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");

    /**
     * LA VENTANA TIENE SUELO, Y ANTES ADMITÍA CERO.
     *
     * Con `>= 0` un administrador que quisiera «limpiar todo» podía mandar 0 y
     * revertir **las ventas en curso**: la que se está creando ahora mismo está en
     * `draft` por definición, y revertirla le suelta las plazas, le anula el
     * voucher y le descuadra la comisión a alguien que está cobrando en el
     * mostrador.
     *
     * El principio ya lo dejó escrito la gemela de `cron`, que usa sesenta:
     * «prefiero que una venta huérfana viva una hora de más a revertir una viva».
     * Una saga normal tarda menos de un segundo, así que cinco minutos es de sobra
     * generoso y sigue siendo un suelo.
     */
    const body = await readJson<{ older_than_minutes?: number }>(req);
    const pedidos = Number(body.older_than_minutes);
    const minutes = Number.isFinite(pedidos) ? Math.max(MINUTOS_MINIMOS, pedidos) : 30;

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
