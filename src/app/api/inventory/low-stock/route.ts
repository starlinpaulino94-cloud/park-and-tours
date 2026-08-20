import { requireTenant } from "@/lib/tenant";
import { lowStock } from "@/lib/inventory";
import { ok, fail } from "@/lib/api-response";

/** GET /api/inventory/low-stock — items at or below their reorder point. */
export async function GET() {
  try {
    const ctx = await requireTenant();
    const rows = await lowStock(ctx.companyId);
    return ok(rows, { total: rows.length });
  } catch (err) {
    return fail(err);
  }
}
