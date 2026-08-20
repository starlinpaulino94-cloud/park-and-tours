/**
 * Create Stripe Customer Portal Session API Route
 *
 * This endpoint creates a Stripe Customer Portal session which allows customers to:
 * - View and download invoices
 * - Update payment methods
 * - Manage subscriptions (cancel, upgrade, etc.)
 *
 * Usage:
 * POST /api/stripe/customer-portal
 * Body: {
 *   customerId: string,
 *   returnUrl?: string
 * }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe, APP_URL } from "@/lib/stripe";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";

function serializeError(err: unknown) {
  const e = err as any;
  return {
    message: e?.message ?? "Unknown error",
    code: e?.code ?? null,
    name: e?.name ?? null,
    status: e?.response?.status ?? null,
    responseData: e?.response?.data ?? null,
  };
}

const schema = z.object({
  returnUrl: z.string().url().optional(),
});

export async function POST(req: Request) {
  try {
    // SECURITY (AUD-005): this endpoint previously accepted an arbitrary
    // `customerId` from the body with NO authentication, letting anyone open
    // the Stripe billing portal (invoices, payment methods, cancel) for any
    // customer whose id they could guess. The customer id is now derived from
    // the authenticated tenant only; the body value is ignored.
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const customerId = (ctx.company as { stripe_customer_id?: string } | null)?.stripe_customer_id;
    if (!customerId) {
      throw new TenantError("La empresa no tiene una cuenta de facturación de Stripe asociada", 400);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: parsed.data.returnUrl || `${APP_URL}/dashboard/administracion`,
    });

    return NextResponse.json({ ok: true, data: { url: session.url } });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ ok: false, error: { message: err.message } }, { status: err.status });
    }
    console.error("[API ERROR] /api/stripe/customer-portal", err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
