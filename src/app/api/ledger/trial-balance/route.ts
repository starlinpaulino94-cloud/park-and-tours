import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { trialBalance } from "@/lib/ledger";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    const period = req.nextUrl.searchParams.get("period") || undefined;
    const result = await trialBalance(ctx.companyId, period);
    return ok(result.rows, { totals: result.totals, balanced: result.balanced });
  } catch (err) {
    console.error("[api/ledger/trial-balance] error:", err);
    return fail(err);
  }
}
