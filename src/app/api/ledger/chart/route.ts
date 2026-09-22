import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { ensureChart } from "@/lib/ledger";
import { assertSameOriginMutation } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

/** Creates the missing accounts of the standard chart. Idempotent. */
export async function POST(req: Request) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    requireAtLeast(ctx, "admin");
    const created = await ensureChart(ctx.companyId);
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "ledger_chart_updated", entityType: "ledger_account",
      description: `${ctx.email} creó ${created} cuenta(s) del plan contable`,
      metadata: { creadas: created },
    });
    return ok({ created });
  } catch (err) {
    console.error("[api/ledger/chart] error:", err);
    return fail(err);
  }
}
