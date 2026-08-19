import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
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

    const res = await totalumSdk.crud.editRecordById("company", ctx.companyId, patch);
    if (res.errors) {
      console.error("[company] error actualizando la empresa:", res.errors);
      throw new Error(res.errors.errorMessage || "No se pudo guardar la empresa");
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "company_updated", entityType: "company", entityId: ctx.companyId,
      description: `${ctx.email} actualizó los datos de la empresa`,
      metadata: patch,
    });

    console.log(`[company] ${ctx.companyId} actualizada por ${ctx.email}`);
    return ok({ ...(ctx.company as Company), ...patch });
  } catch (err) {
    return fail(err);
  }
}
