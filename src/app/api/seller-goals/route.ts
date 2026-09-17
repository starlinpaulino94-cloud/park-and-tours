import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { goalsWithProgress, awardGoalBonus } from "@/lib/seller-goals-service";

/**
 * GET  /api/seller-goals — el tablero de metas con su progreso real.
 * POST /api/seller-goals — otorgar el bono de una meta cumplida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROGRESO NO SE GUARDA, SE MIDE
 *
 * Los captados salen del embudo (0058) y las reservas, ventas, pasajeros e
 * ingresos de las reservas. Un contador denormalizado sería un segundo sitio
 * donde se decide si alguien cobra su premio, y el día que se desincronizara
 * nadie lo notaría — porque nadie mira un contador, solo la barra que pinta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL BONO LO OTORGA UNA PERSONA
 *
 * No se otorga solo al llegar a la meta. Un premio automático sobre una meta
 * que alguien bajó el día 30 se pagaría sin que nadie lo mirara, y esa es la
 * clase de bono que acaba en una discusión. Lo que sí es automático es la
 * condición congelada que se guarda con él.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    const sellerId = new URL(req.url).searchParams.get("seller");
    return ok({ goals: await goalsWithProgress(ctx.companyId, { sellerId }) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    // Otorgar un premio es comprometer dinero de la empresa.
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      goal_id?: string; seller_id?: string; amount?: number;
      payout_kind?: string; description?: string;
    }>(req);

    if (!body.goal_id || !body.seller_id) {
      return fail(Object.assign(new Error("Falta la meta o el vendedor"), { status: 400 }));
    }

    return ok(await awardGoalBonus(ctx, {
      goalId: String(body.goal_id),
      sellerId: String(body.seller_id),
      amount: Number(body.amount ?? 0),
      payoutKind: body.payout_kind,
      description: body.description,
    }));
  } catch (err) {
    return fail(err);
  }
}
