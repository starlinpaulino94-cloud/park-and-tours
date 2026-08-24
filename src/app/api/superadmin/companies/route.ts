import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { supabaseService } from "@/lib/supabase/service";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapCompany(row: any) {
  return {
    ...row,
    _id: row.id,
    plan: row.plan_id,
    base_currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Number(sp.get("limit") || 100), 500);
    const offset = Number(sp.get("offset") || 0);
    const sb = supabaseService();

    let query = sb.from("organizations").select("*", { count: "exact" }).eq("kind", "tenant").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    const q = sp.get("q")?.trim();
    if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "\\$&")}%`);
    if (sp.get("status")) query = query.eq("status", sp.get("status"));
    const { data: companies, error, count } = await query;
    if (error) throw error;

    const ids = (companies || []).map((c) => c.id);
    const [bookings, products, memberships] = await Promise.all([
      ids.length ? sb.from("booking").select("organization_id").in("organization_id", ids).limit(5000) : Promise.resolve({ data: [] as any[] }),
      ids.length ? sb.from("product").select("organization_id").in("organization_id", ids).limit(5000) : Promise.resolve({ data: [] as any[] }),
      ids.length ? sb.from("organization_memberships").select("organization_id").in("organization_id", ids).limit(5000) : Promise.resolve({ data: [] as any[] }),
    ]);
    const countBy = (rows: any[] = []) => rows.reduce((map, row) => map.set(row.organization_id, (map.get(row.organization_id) || 0) + 1), new Map<string, number>());
    const bookingCount = countBy(bookings.data || []);
    const productCount = countBy(products.data || []);
    const userCount = countBy(memberships.data || []);

    const rows = (companies || []).map((c) => ({
      ...mapCompany(c),
      usage: { bookings: bookingCount.get(c.id) || 0, users: userCount.get(c.id) || 0, products: productCount.get(c.id) || 0, storage_mb: c.metadata?.storage_used_mb || 0 },
    }));
    console.log(`[superadmin] ${rows.length} empresas listadas por ${ctx.email}`);
    return ok(rows, { total: count ?? rows.length });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const body = await readJson<Record<string, any>>(req);
    const sb = supabaseService();

    if (body.company_id) {
      const patch: Record<string, unknown> = {};
      for (const key of ["status", "subscription_status", "plan_id", "modules_enabled"]) if (body[key] !== undefined) patch[key] = body[key];
      if (body.plan !== undefined) patch.plan_id = body.plan;
      if (body.base_currency !== undefined) patch.currency = body.base_currency;
      if (Object.keys(patch).length === 0) throw Object.assign(new Error("No se enviaron datos válidos"), { status: 400 });
      const { data, error } = await sb.from("organizations").update(patch).eq("id", body.company_id).select("*").single();
      if (error) throw error;
      await writeAudit({ companyId: body.company_id, userId: ctx.userId, action: "company_updated_by_superadmin", entityType: "company", entityId: body.company_id, severity: "warning", description: `Superadmin ${ctx.email} actualizó la empresa`, metadata: patch });
      return ok(mapCompany(data));
    }

    if (!body.name) throw Object.assign(new Error("El nombre de la empresa es obligatorio"), { status: 400 });
    const { data, error } = await sb.from("organizations").insert({
      kind: "tenant",
      name: body.name,
      slug: slugify(String(body.name)),
      company_type: body.company_type || "excursion_company",
      email: body.email,
      currency: body.base_currency || "usd",
      plan_id: body.plan || null,
      subscription_status: body.subscription_status || "trial",
      status: "active",
      modules_enabled: [],
      metadata: { created_by_superadmin: ctx.userId },
    }).select("*").single();
    if (error) throw error;
    await sb.from("organizations").update({ tenant_org_id: data.id }).eq("id", data.id);
    await writeAudit({ companyId: data.id, userId: ctx.userId, action: "company_created_by_superadmin", entityType: "company", entityId: data.id, severity: "warning", description: `Superadmin ${ctx.email} creó la empresa ${body.name}` });
    return ok(mapCompany(data));
  } catch (err) {
    return fail(err);
  }
}
