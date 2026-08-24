import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import type { Company } from "@/lib/types";

/** Fields the tenant owner/admin may edit about their own company. */
const EDITABLE = [
  "name", "legal_name", "tax_id", "company_type", "group_name", "email", "phone", "whatsapp",
  "address", "city", "country", "timezone", "logo_url", "brand_color", "base_currency", "notes",
];

/** GET /api/company — the signed-in tenant's own company profile. */
export async function GET() {
  try {
    const ctx = await requireTenant();
    return ok(ctx.company);
  } catch (err) {
    return fail(err);
  }
}

/** PUT /api/company — updates the tenant's own company profile. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = await readJson<Record<string, unknown>>(req);
    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in body) patch[key] = body[key] === "" ? null : body[key];
    }
    if (Object.keys(patch).length === 0) throw new TenantError("No se enviaron datos válidos", 400);

    const dbPatch = { ...patch };
    if ("base_currency" in dbPatch) {
      dbPatch.currency = dbPatch.base_currency;
      delete dbPatch.base_currency;
    }
    await tenantUpdate(ctx.companyId, "company", ctx.companyId, dbPatch);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "company_updated", entityType: "company", entityId: ctx.companyId,
      description: `${ctx.email} actualizó los datos de la empresa`,
      metadata: dbPatch,
    });

    console.log(`[company] ${ctx.companyId} actualizada por ${ctx.email}`);
    return ok({ ...(ctx.company as Company), ...patch });
  } catch (err) {
    return fail(err);
  }
}
