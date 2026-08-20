import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { ensureChart } from "@/lib/ledger";

/** Creates the missing accounts of the standard chart. Idempotent. */
export async function POST() {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");
    const created = await ensureChart(ctx.companyId);
    return ok({ created });
  } catch (err) {
    console.error("[api/ledger/chart] error:", err);
    return fail(err);
  }
}
