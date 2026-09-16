import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, TenantError, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import type { Company } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";

/** Fields the tenant owner/admin may edit about their own company. */
const EDITABLE = [
  "name", "legal_name", "tax_id", "company_type", "group_name", "email", "phone", "whatsapp",
  "address", "city", "country", "timezone", "logo_url", "brand_color", "base_currency", "notes",
  // 0039 — cuántas horas se guarda la plaza de una reserva sin cobrar. Nulo o
  // cero: nada expira.
  "hold_hours",
  // 0047 — el motor de reservas público. Es un interruptor de la EMPRESA y por
  // eso se edita aquí: activarlo pone su catálogo publicado a la vista de
  // cualquiera, así que la decisión es de quien administra la cuenta y queda en
  // la bitácora como el resto de este formulario.
  "public_booking_enabled", "public_intro", "public_terms",
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
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
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
