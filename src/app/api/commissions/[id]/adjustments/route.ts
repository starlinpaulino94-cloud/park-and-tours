import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertGerenciaOVendedorDe } from "@/lib/seller-identity";
import { adjustmentsOf } from "@/lib/commission-adjust-service";
import { refId } from "@/lib/types";
import type { Commission } from "@/lib/types";

/**
 * GET /api/commissions/:id/adjustments — por qué esta comisión vale menos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO VALE `/api/erp/commission_adjustment`
 *
 * Porque esa tabla no tiene columna de vendedor —cuelga de la comisión—, así
 * que el ámbito por fila no sabe acotarla. Abrirla le enseñaría a cada persona
 * los ajustes de sus compañeros CON EL MOTIVO ESCRITO, que es el dato más
 * delicado que guarda este módulo. Por eso está reservada a gerencia.
 *
 * Aquí se pregunta por UNA comisión y se comprueba que sea suya, que es la
 * misma pareja que ya usa el estado de cuenta: la tabla cerrada, y una puerta
 * estrecha que valida la fila.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y HACE FALTA, NO ES UN ADORNO
 *
 * La liquidación transfiere el neto. Sin el motivo, a la persona le aparece un
 * «−100» en su pantalla y menos dinero en el banco, y lo único que puede hacer
 * es preguntar. Un descuento sin explicación es una reclamación garantizada.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "commissions:adjustments", ctx.userId), limit: 120, windowMs: 60_000 });

    // La comisión primero: comprueba de paso que es de esta empresa.
    const commission = await tenantFindOne<Commission>(ctx.companyId, "commission", id);
    assertGerenciaOVendedorDe(ctx, refId(commission.seller as never), "Esta comisión");

    const ajustes = await adjustmentsOf(ctx.companyId, id);
    return ok(ajustes.map((a) => ({
      _id: a._id,
      amount: Number(a.amount ?? 0),
      reason: a.reason ?? null,
      reason_code: a.reason_code ?? null,
      created_at: a.created_at ?? null,
    })));
  } catch (err) {
    return fail(err);
  }
}
