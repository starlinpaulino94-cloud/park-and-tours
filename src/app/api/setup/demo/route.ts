import { requireTenant, requireAtLeast, tenantCount } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { seedDemoData } from "@/lib/demo-seed";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";

/**
 * POST /api/setup/demo — carga el juego de datos de demostración en el tenant
 * actual. Es idempotente: no hace nada si ya existen productos.
 */
export async function POST(req: Request) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const existing = await tenantCount(ctx.companyId, "product");
    if (existing > 0) {
      console.log(`[setup/demo] omitido: la empresa ya tiene ${existing} productos`);
      return ok({ skipped: true, products: existing });
    }

    const result = await seedDemoData(ctx);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "demo_data_seeded", entityType: "company", entityId: ctx.companyId,
      description: "Datos de demostración cargados", metadata: result.created,
    });
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
