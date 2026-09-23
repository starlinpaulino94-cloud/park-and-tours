import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { partnerMatrix } from "@/lib/allotment-service";

/**
 * GET /api/portal/cupos?from=YYYY-MM-DD&days=14&product=<id>
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CONTRATO DE PLAZAS, VISTO POR QUIEN LO FIRMÓ
 *
 * Esta rejilla existía —`/api/allotments/matrix`— y pedía `manager`. Es decir:
 * el cupo que el tour center negoció solo podía verlo la operadora. El socio se
 * enteraba de cuántas plazas le quedaban cuando el sistema le rechazaba una
 * venta, o preguntando por WhatsApp — que es exactamente lo que el motor de
 * cupos vino a sustituir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE ACOTA POR LA FICHA, NO POR EL PARÁMETRO
 *
 * Si quien pregunta es del socio, el socio es el SUYO y el parámetro no se
 * mira. Atender un `?partner=` aquí convertiría esta ruta en la forma de leer
 * el contrato de plazas de la agencia de enfrente: cuántas le apartan y cuántas
 * lleva vendidas.
 */
const MAX_DAYS = 60;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "portal:cupos", ctx.userId), limit: 60, windowMs: 60_000 });

    const sp = req.nextUrl.searchParams;
    let partnerId: string | null;
    if (esDeSocio(ctx)) {
      partnerId = ctx.partnerId;
    } else {
      requireAtLeast(ctx, "manager");
      partnerId = (sp.get("partner") || "").trim() || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const from = String(sp.get("from") || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new TenantError("La fecha inicial debe ser AAAA-MM-DD.", 400);

    const days = Math.min(Math.max(Number(sp.get("days") || 14), 1), MAX_DAYS);
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const cells = await partnerMatrix(ctx.companyId, partnerId, dates, sp.get("product"));
    return ok({ partner_id: partnerId, from, days, cells });
  } catch (err) {
    return fail(err);
  }
}
