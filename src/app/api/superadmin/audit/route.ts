import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";

/** GET /api/superadmin/audit — auditoría global de toda la plataforma. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const sp = req.nextUrl.searchParams;

    const filter: Record<string, unknown> = {};
    if (sp.get("severity")) filter.severity = sp.get("severity");
    if (sp.get("company_id")) filter.company = sp.get("company_id");
    const q = sp.get("q")?.trim();
    if (q) {
      filter._or = [
        { action: { regex: q, options: "i" } },
        { description: { regex: q, options: "i" } },
        { entity_type: { regex: q, options: "i" } },
      ];
    }

    const res = await totalumSdk.crud.query("audit_log", {
      _filter: filter,
      _sort: { createdAt: "desc" },
      _limit: Math.min(Number(sp.get("limit") || 100), 500),
      _offset: Number(sp.get("offset") || 0),
      company: true, user: true, impersonated_by: true,
    });
    if (res.errors) {
      console.error("[superadmin/audit] error listando la auditoría:", res.errors);
      throw new Error(res.errors.errorMessage || "Error cargando la auditoría");
    }

    console.log(`[superadmin/audit] ${(res.data || []).length} eventos consultados por ${ctx.email}`);
    return ok(res.data || []);
  } catch (err) {
    return fail(err);
  }
}
