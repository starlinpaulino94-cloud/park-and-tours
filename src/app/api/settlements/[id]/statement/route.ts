import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadSupplierStatement } from "@/lib/supplier-settlement-service";
import { loadSellerStatement } from "@/lib/seller-settlement-service";
import { assertSettlementBeneficiary, beneficiaryOf, type SettlementLike } from "@/lib/settlement-access";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/settlements/:id/statement — el estado de cuenta de la liquidación.
 *
 * Misma carga que el PDF que se le manda al proveedor, para que el papel con el
 * que discute y lo que el sistema va a pagar no puedan decir cosas distintas.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "settlements:statement", ctx.userId), limit: 120, windowMs: 60_000 });
    /**
     * Quién puede abrirla ya no lo decide el RANGO sino la FILA.
     *
     * Mientras solo entrara gerencia bastaba con el rango; abierto a su
     * beneficiario, el rango deja de decidir nada y bastaría con cambiar el
     * identificador de la dirección para bajarse la liquidación de un
     * proveedor, con sus costes y sus retenciones dentro.
     */
    const cabecera = await tenantFindOne<SettlementLike & Record<string, unknown>>(
      ctx.companyId, "settlement", id, { seller: true, partner: true, supplier: true }
    );
    assertSettlementBeneficiary(ctx, cabecera);

    /**
     * Y cada beneficiario tiene su estado de cuenta, que no es el mismo
     * documento con otro nombre: el del proveedor lee lo que cuesta cada
     * servicio operado y lleva el COSTE dentro; el del vendedor lee sus
     * comisiones. Servir el del proveedor a un vendedor le habría entregado el
     * margen de la empresa en un PDF.
     */
    const quien = beneficiaryOf(cabecera);
    if (quien?.kind === "seller") return ok(await loadSellerStatement(ctx.companyId, id));
    return ok(await loadSupplierStatement(ctx.companyId, id));
  } catch (err) {
    return fail(err);
  }
}
