import { NextRequest } from "next/server";
import { requireTenantWrite, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { assertSettlementBeneficiary } from "@/lib/settlement-access";
import { vetoDeDisputa, destinatarioDeDisputa } from "@/lib/disputa";

/**
 * POST /api/settlements/:id/dispute — el beneficiario no está de acuerdo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA ANTES
 *
 * `disputed` existe como estado desde la primera migración de finanzas y la
 * interfaz lo sabe traducir. No había forma de ponerlo. Un tour center que no
 * está de acuerdo con su corte del mes llama por teléfono, y de esa llamada no
 * queda nada: ni el motivo, ni la fecha, ni quién se comprometió a mirarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN PUEDE, Y POR QUÉ NO ES UNA COMPROBACIÓN NUEVA
 *
 * Disputa el BENEFICIARIO, y eso ya lo decide `assertSettlementBeneficiary`
 * —el mismo que abre el estado de cuenta y el PDF—. Escribir aquí otra
 * comprobación sería la tercera copia de la misma pregunta, y la tercera copia
 * es la que un día dice algo distinto. Su propio comentario ya anticipaba esta
 * ruta.
 *
 * Gerencia pasa esa comprobación por rango, y está bien: la operadora puede
 * abrir la disputa por teléfono en nombre del socio. Queda a su nombre en la
 * bitácora.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({
      key: rateLimitKey(req, "settlements:dispute", ctx.userId), limit: 20, windowMs: 60_000,
    });

    const settlement = await tenantFindOne<Record<string, unknown>>(
      ctx.companyId, "settlement", id,
      { partner: true, seller: true, supplier: true, approved_by: true, confirmed_by: true }
    );
    assertSettlementBeneficiary(ctx, settlement);

    const body = await readJson<{ reason?: string }>(req);
    const motivo = (body.reason || "").trim();
    const veto = vetoDeDisputa(settlement.status as string, motivo);
    if (veto) throw new TenantError(veto.mensaje, veto.status);

    /**
     * El destinatario se resuelve y se GUARDA.
     *
     * Guardarlo, y no solo mandarle el aviso, es lo que permite que la pantalla
     * diga «lo está mirando fulano» y que la operadora pueda reasignarlo. Un
     * aviso enviado y no registrado deja la disputa sin dueño en cuanto alguien
     * lo marca como leído.
     */
    const destinatario = destinatarioDeDisputa(settlement);

    const actualizada = await tenantUpdate<Record<string, unknown>>(ctx.companyId, "settlement", id, {
      status: "disputed",
      dispute_reason: motivo,
      disputed_at: new Date().toISOString(),
      disputed_by: ctx.userId,
      dispute_assignee: destinatario,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "settlement_disputed",
      entityType: "settlement", entityId: id,
      severity: "warning",
      description: `${ctx.email} abrió una disputa sobre la liquidación ${settlement.code ?? id}`,
      metadata: { motivo, asignada_a: destinatario },
    });

    await notify({
      companyId: ctx.companyId,
      // Sin destinatario, `notify` cae en la audiencia de gerencia. No es lo
      // deseable y por eso la respuesta lo dice: un aviso que ven todos es el
      // que no coge ninguno.
      userId: destinatario ?? undefined,
      event: "settlement_disputed",
      entityType: "settlement", entityId: id,
      vars: {
        referencia: String(settlement.code ?? ""),
        monto: Number(settlement.net_amount ?? settlement.total_amount ?? 0),
        moneda: String(settlement.currency ?? "usd"),
        motivo,
      },
    });

    return ok({
      ...actualizada,
      /** Para que la pantalla pueda decir si alguien la está mirando. */
      dispute_assigned: Boolean(destinatario),
    });
  } catch (err) {
    return fail(err);
  }
}
