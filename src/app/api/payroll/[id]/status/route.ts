import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { payrollTransition } from "@/lib/hr";
import { releasePayrollRun } from "@/lib/hr-service";

/**
 * POST /api/payroll/:id/status — aprobar, pagar o anular una corrida.
 *
 * El estado no es un campo de formulario: es lo único que separa un cálculo de
 * un pago. `payrollTransition` decide, y decide dos cosas que importan: no se
 * paga lo que no se aprobó, y una corrida PAGADA no se anula —el dinero ya
 * salió; lo que corresponde es el ajuste en la siguiente—.
 *
 * Anular un borrador SUELTA sus marcajes. Sin eso, el trabajo de esa quincena
 * quedaría reclamado para siempre y esas horas no se pagarían nunca.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "payroll:status", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "admin");
    assertModule(ctx, "accounting");

    const body = await readJson<{ action?: string }>(req);
    const action = body.action;
    if (action !== "approve" && action !== "pay" && action !== "cancel") {
      throw new TenantError("Acción no reconocida: aprobar, pagar o anular.", 400);
    }

    const run = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "payroll_run", id);
    const decision = payrollTransition(String(run.status || "draft"), action);
    if (decision.ok === false) throw new TenantError(decision.reason, 409);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: decision.next };
    if (action === "approve") {
      patch.approved_at = now;
      patch.approved_by = ctx.userId;
    }
    if (action === "pay") patch.paid_at = now;

    let released = 0;
    if (action === "cancel") released = await releasePayrollRun(ctx.companyId, id);

    await tenantUpdate(ctx.companyId, "payroll_run", id, patch);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: `payroll_${decision.next}`, entityType: "payroll_run", entityId: id,
      description:
        `Nómina ${run.code ?? id}: ${decision.next}` +
        (released > 0 ? ` · ${released} marcajes liberados` : ""),
      severity: action === "cancel" ? "warning" : "info",
    });

    return ok({ status: decision.next, released });
  } catch (err) {
    return fail(err);
  }
}
