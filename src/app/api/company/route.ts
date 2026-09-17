import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, TenantError, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import type { Company } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";
import { normalizeColor } from "@/lib/branding";

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
  // 0055 — la marca. Hasta esta migración `whatsapp`, `address`, `city`,
  // `logo_url`, `brand_color`, `group_name` y `notes` estaban en esta lista sin
  // existir como columnas: PostgREST rechaza el UPDATE ENTERO cuando una sola
  // no existe, así que escribir un WhatsApp hacía perder también el nombre y el
  // RNC del formulario.
  "document_footer", "voucher_terms", "invoice_terms",
  // 0058 — a quién se le paga cuando el cliente vino por el QR de un conserje y
  // la venta la cerró el mostrador. Es una decisión de negocio de la empresa, y
  // se aplica AL VENDER: cambiarla no reescribe las ventas ya atribuidas.
  "attribution_policy", "attribution_window_days",
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

    // El color se normaliza a `#rrggbb` antes de guardarlo: la base tiene un
    // check que rechaza cualquier otra cosa, y dejar que llegue un "azul" del
    // formulario convertiría un error de tecleo en un 500 sin explicación.
    if ("brand_color" in dbPatch && dbPatch.brand_color !== null) {
      const normalized = normalizeColor(dbPatch.brand_color);
      if (!normalized) {
        throw new TenantError("El color de marca tiene que ser un hexadecimal, por ejemplo #0b5fff.", 400);
      }
      dbPatch.brand_color = normalized;
    }

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
