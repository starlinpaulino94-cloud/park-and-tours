import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { supabaseService } from "@/lib/supabase/service";

/** GET /api/superadmin/audit — auditoría global de toda la plataforma. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const sp = req.nextUrl.searchParams;

    const limit = Math.min(Number(sp.get("limit") || 100), 500);
    const offset = Number(sp.get("offset") || 0);
    let query = supabaseService()
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (sp.get("severity")) query = query.eq("severity", sp.get("severity"));
    if (sp.get("company_id")) query = query.eq("organization_id", sp.get("company_id"));
    const q = sp.get("q")?.trim();
    if (q) {
      const safe = q.replace(/[%_,()]/g, "\\$&");
      query = query.or(`action.ilike.%${safe}%,description.ilike.%${safe}%,entity_type.ilike.%${safe}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    console.log(`[superadmin/audit] ${(data || []).length} eventos consultados por ${ctx.email}`);
    return ok((data || []).map((row: any) => ({ ...row, _id: row.id, company: row.organization_id, user: row.user_id, createdAt: row.created_at })));
  } catch (err) {
    return fail(err);
  }
}
