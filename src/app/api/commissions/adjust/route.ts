import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { adjustCommission } from "@/lib/commission-adjust-service";
import { isAdjustmentReason } from "@/lib/commission-adjustments";

/**
 * POST /api/commissions/adjust — corregir una comisión sin reescribirla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA RUTA PROPIA Y NO EL CRUD GENÉRICO
 *
 * Un ajuste no es solo una fila: además de escribirla hay que recalcular el
 * neto de la comisión y dejar rastro en la bitácora. Por el CRUD genérico se
 * podría crear la fila y dejar el neto desfasado — y un neto desfasado lo suma
 * la liquidación del mes siguiente sin que nada avise.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RANGO DE GERENCIA
 *
 * Esto mueve dinero que ya se pagó o que se va a pagar. No es una corrección de
 * datos: es una decisión sobre la liquidación de una persona, y quien la tome
 * tiene que poder responder por ella.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      commission_id?: string;
      amount?: number;
      reason?: string;
      reason_code?: string;
    }>(req);

    if (!body.commission_id) {
      return fail(Object.assign(new Error("Falta la comisión que se ajusta"), { status: 400 }));
    }

    const result = await adjustCommission(ctx, {
      commissionId: String(body.commission_id),
      amount: Number(body.amount),
      reason: String(body.reason ?? ""),
      // Un motivo inventado se guarda como «otro» en vez de rechazar la
      // corrección: lo que importa es que el ajuste quede, y el texto libre ya
      // lleva la explicación real.
      reasonCode: isAdjustmentReason(body.reason_code) ? body.reason_code : "other",
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
