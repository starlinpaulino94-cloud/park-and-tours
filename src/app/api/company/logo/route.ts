import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { objectPath, uploadObject, publicUrl } from "@/lib/supabase/storage";
import { PDF_IMAGE_TYPES, LOGO_PROBLEM_MESSAGE } from "@/lib/branding";
import { MAX_LOGO_BYTES, clearLogoCache } from "@/lib/pdf/logo";

/**
 * POST /api/company/logo — subir el logo de la empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA RUTA PROPIA Y NO LA DE SUBIDAS GENÉRICA
 *
 * `/api/storage/upload` exige que el destino sea un recurso del ERP y que la
 * fila exista, porque construye la ruta del objeto desde ahí. La empresa no es
 * un recurso del ERP —es el inquilino— así que no encaja, y forzarla a encajar
 * habría significado abrir el CRUD genérico sobre `organizations`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO PNG Y JPG
 *
 * El formato PDF no sabe incrustar SVG ni WebP. Aceptarlos aquí dejaría a la
 * empresa con un logo que se ve en pantalla y NO sale en su voucher, y se
 * enteraría por un cliente. Se rechaza en la puerta y se explica por qué.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "company:logo", ctx.userId), limit: 10, windowMs: 60_000 });
    // El logo sale en todo lo que la empresa entrega: es decisión de quien
    // administra la cuenta, no de cualquiera que pueda escribir.
    requireAtLeast(ctx, "admin");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new TenantError("Falta el archivo", 400);

    if (!PDF_IMAGE_TYPES.has(file.type)) {
      throw new TenantError(LOGO_PROBLEM_MESSAGE.not_pdf_format, 415);
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new TenantError(
        `El logo supera el máximo de ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB. Un logo no necesita pesar tanto.`,
        413
      );
    }
    if (file.size === 0) throw new TenantError("El archivo está vacío", 400);

    // El nombre lleva la marca de tiempo para que un logo nuevo no se quede
    // detrás del caché del anterior: los navegadores y el generador de PDF
    // guardan la URL, y reusarla enseñaría el logo viejo durante días.
    const name = `logo-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const path = objectPath(ctx.companyId, "company", ctx.companyId, name);
    await uploadObject("public", path, await file.arrayBuffer(), file.type);
    const url = publicUrl("public", path);

    await tenantUpdate(ctx.companyId, "company", ctx.companyId, { logo_url: url });
    // La caché del generador de PDF guarda por URL; la URL es nueva, pero se
    // limpia igual para que un reintento sobre una que falló no arrastre el
    // fallo cacheado.
    clearLogoCache();

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "company_logo_updated", entityType: "company", entityId: ctx.companyId,
      description: `${ctx.email} actualizó el logo de la empresa`,
      severity: "info",
    });

    console.log(`[company] logo actualizado para ${ctx.companyId}`);
    return ok({ logo_url: url });
  } catch (err) {
    return fail(err);
  }
}
