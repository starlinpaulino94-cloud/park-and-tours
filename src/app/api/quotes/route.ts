import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantCreate, tenantQuery, tenantCount } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { sellerFilterFor } from "@/lib/seller-scope";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { newDocumentNumber } from "@/lib/codes";
import { uniqueCode } from "@/lib/unique";

/**
 * POST /api/quotes — abre una cotización.
 *
 * El alta no podía pasar por el CRUD genérico: `quote.code` es `not null` y
 * único por inquilino, y ninguna pantalla lo pedía ni lo generaba, así que
 * "Nueva cotización" devolvía un error de base de datos. El código de un
 * documento comercial no es un campo de formulario —nadie debería poder
 * teclearlo ni repetirlo—, igual que el número de una orden o de una reserva.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:create", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<Record<string, unknown>>(req);
    const str = (k: string) => {
      const v = body[k];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    const numOrUndefined = (k: string) => {
      const n = Number(body[k]);
      return Number.isFinite(n) ? n : undefined;
    };

    const depositType = ["none", "percent", "amount"].includes(String(body.deposit_type))
      ? String(body.deposit_type)
      : "none";

    const quote = await tenantCreate<{ _id: string; code?: string }>(ctx.companyId, "quote", {
      code: await uniqueCode(ctx.companyId, "quote", "code", () => newDocumentNumber("COT")),
      status: "draft",
      version: 1,
      issued_at: new Date().toISOString(),
      title: str("title"),
      quote_type: str("quote_type") || "group",
      currency: str("currency") || ctx.company?.base_currency || "usd",
      customer: str("customer"),
      partner: str("partner"),
      seller: str("seller"),
      lead: str("lead"),
      contact_name: str("contact_name"),
      contact_email: str("contact_email"),
      contact_phone: str("contact_phone"),
      company_name: str("company_name"),
      pax: numOrUndefined("pax"),
      event_date: str("event_date"),
      valid_until: str("valid_until"),
      follow_up_at: str("follow_up_at"),
      tax_percent: numOrUndefined("tax_percent"),
      deposit_type: depositType,
      deposit_percent: depositType === "percent" ? numOrUndefined("deposit_percent") : undefined,
      deposit_amount: depositType === "amount" ? numOrUndefined("deposit_amount") : undefined,
      deposit_due_date: str("deposit_due_date"),
      balance_due_date: str("balance_due_date"),
      terms: str("terms"),
      inclusions: str("inclusions"),
      exclusions: str("exclusions"),
      cancellation_policy: str("cancellation_policy"),
      payment_terms: str("payment_terms"),
      notes: str("notes"),
      internal_notes: str("internal_notes"),
      user: ctx.userId,
      subtotal: 0, discount: 0, tax: 0, total: 0, cost_total: 0, margin_amount: 0,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_created",
      entityType: "quote", entityId: quote._id,
      description: `Cotización ${quote.code} abierta`,
    });

    return ok(quote);
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/quotes — listado con el detalle comercial que usa el embudo. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:list", ctx.userId), limit: 120, windowMs: 60_000 });
    const sp = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    if (sp.get("status")) filter.status = sp.get("status");
    if (sp.get("quote_type")) filter.quote_type = sp.get("quote_type");
    // El mismo ámbito que en `/api/orders`: esta ruta tampoco pasa por
    // `buildListFilter`, y el embudo de cotizaciones es cartera comercial.
    const sellerScope = sellerFilterFor("quote", ctx.role, ctx.sellerId);
    if (sellerScope) Object.assign(filter, sellerScope);

    const [rows, total] = await Promise.all([
      tenantQuery(ctx.companyId, "quote", {
        _filter: filter,
        _sort: { createdAt: "desc" },
        _limit: Math.min(Number(sp.get("limit") || 50), 500),
        _offset: Number(sp.get("offset") || 0),
        customer: true, seller: true, partner: true,
      }),
      tenantCount(ctx.companyId, "quote", filter),
    ]);
    return ok(rows, { total });
  } catch (err) {
    return fail(err);
  }
}
