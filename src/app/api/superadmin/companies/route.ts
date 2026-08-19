import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { Company } from "@/lib/types";

/** GET /api/superadmin/companies — listado global de tenants con su consumo. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q");
    const status = sp.get("status");

    const filter: Record<string, unknown> = {};
    if (q) filter.name = { regex: q, options: "i" };
    if (status) filter.status = status;

    const res = await totalumSdk.crud.query("company", {
      _filter: filter,
      _sort: { createdAt: "desc" },
      _limit: Number(sp.get("limit") || 100),
      _offset: Number(sp.get("offset") || 0),
      plan: true,
    });
    if (res.errors) {
      console.error("[superadmin] error listando empresas:", res.errors);
      throw new Error(res.errors.errorMessage || "Error listando empresas");
    }
    const companies = (res.data || []) as Company[];

    // One counting query per metric instead of N per company.
    const countBy = async (table: string) => {
      const r = await totalumSdk.crud.query(table, { _limit: 1000, _select: ["company"], _include: false } as any);
      const map = new Map<string, number>();
      for (const row of ((r.data || []) as any[])) {
        const id = typeof row.company === "object" ? row.company?._id : row.company;
        if (id) map.set(id, (map.get(id) || 0) + 1);
      }
      return map;
    };
    const [bookingCount, userCount, productCount] = await Promise.all([
      countBy("booking"),
      (async () => {
        const r = await totalumSdk.crud.query("user", { _limit: 1000, _select: ["company_id"], _include: false } as any);
        const map = new Map<string, number>();
        for (const row of ((r.data || []) as any[])) {
          const id = typeof row.company_id === "object" ? row.company_id?._id : row.company_id;
          if (id) map.set(id, (map.get(id) || 0) + 1);
        }
        return map;
      })(),
      countBy("product"),
    ]);

    const rows = companies.map((c) => ({
      ...c,
      usage: {
        bookings: bookingCount.get(c._id) || 0,
        users: userCount.get(c._id) || 0,
        products: productCount.get(c._id) || 0,
        storage_mb: c.storage_used_mb || 0,
      },
    }));

    const totalRes = await totalumSdk.crud.query("company", { _filter: filter, _count: true, _limit: 1 } as any);
    const total = (totalRes as any)?.metadata?._count?._total ?? rows.length;

    console.log(`[superadmin] ${rows.length} empresas listadas por ${ctx.email}`);
    return ok(rows, { total });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/superadmin/companies — alta manual de un tenant o cambio de estado/plan. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const body = await readJson<Record<string, any>>(req);

    if (body.company_id) {
      const patch: Record<string, unknown> = {};
      for (const key of ["status", "subscription_status", "plan", "trial_ends_at", "next_billing_at", "modules_enabled", "notes"]) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      const res = await totalumSdk.crud.editRecordById("company", body.company_id, patch);
      if (res.errors) {
        console.error("[superadmin] error actualizando empresa:", res.errors);
        throw new Error(res.errors.errorMessage || "Error actualizando la empresa");
      }
      await writeAudit({
        companyId: body.company_id, userId: ctx.userId, action: "company_updated_by_superadmin",
        entityType: "company", entityId: body.company_id, severity: "warning",
        description: `Superadmin ${ctx.email} actualizó la empresa`, metadata: patch,
      });
      return ok({ company_id: body.company_id, ...patch });
    }

    if (!body.name) throw Object.assign(new Error("El nombre de la empresa es obligatorio"), { status: 400 });
    const res = await totalumSdk.crud.createRecord("company", {
      name: body.name,
      slug: String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      company_type: body.company_type || "excursion_company",
      email: body.email,
      base_currency: body.base_currency || "usd",
      plan: body.plan || undefined,
      subscription_status: body.subscription_status || "trial",
      trial_ends_at: new Date(Date.now() + (body.trial_days ?? 14) * 86_400_000).toISOString(),
      status: "active",
      brand_color: "#0E7C86",
    });
    if (res.errors) {
      console.error("[superadmin] error creando empresa:", res.errors);
      throw new Error(res.errors.errorMessage || "Error creando la empresa");
    }
    const created = res.data as any;
    const companyId = created?.insertedId || created?._id;

    await writeAudit({
      companyId, userId: ctx.userId, action: "company_created_by_superadmin",
      entityType: "company", entityId: companyId, severity: "warning",
      description: `Superadmin ${ctx.email} creó la empresa ${body.name}`,
    });
    console.log(`[superadmin] empresa creada ${companyId}`);
    return ok({ _id: companyId, name: body.name });
  } catch (err) {
    return fail(err);
  }
}
