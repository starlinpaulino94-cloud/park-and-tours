/**
 * Create Stripe Checkout Session API Route
 *
 * This endpoint creates a Stripe Checkout Session for both:
 * - One-time payments (with optional payment method saving)
 * - Subscription payments
 *
 * Usage:
 * POST /api/stripe/create-checkout-session
 * Body: {
 *   priceId: string,
 *   mode: "payment" | "subscription",
 *   savePaymentMethod?: boolean,
 *   customerEmail?: string
 * }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe, APP_URL } from "@/lib/stripe";
import { assertSameOriginMutation } from "@/lib/csrf";
import { requireAtLeast, requireTenant, TenantError } from "@/lib/tenant";

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
  priceId: z.string().min(1, "Price ID is required"),
  mode: z.enum(["payment", "subscription"]).default("subscription"),
});

function allowedPriceIds(): Set<string> {
  return new Set(
    (process.env.STRIPE_ALLOWED_PRICE_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export async function POST(req: Request) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { priceId, mode } = parsed.data;
    const prices = allowedPriceIds();
    if (prices.size === 0) {
      throw new TenantError("Checkout de Stripe no configurado", 503);
    }
    if (!prices.has(priceId)) {
      throw new TenantError("Plan de Stripe no permitido", 400);
    }

    // Build checkout session parameters
    const sessionParams: any = {
      mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/stripe/cancel`,
      client_reference_id: ctx.companyId,
      customer_email: ctx.email || undefined,
      metadata: {
        company_id: ctx.companyId,
        requested_by: ctx.userId,
      },
    };

    // For subscription mode, always save payment method
    if (mode === "subscription") {
      sessionParams.payment_method_collection = "always";
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({
      ok: true,
      data: { sessionId: session.id, url: session.url },
    });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ ok: false, error: { message: err.message } }, { status: err.status });
    }
    console.error("[API ERROR] /api/stripe/create-checkout-session", err);
    return NextResponse.json(
      { ok: false, error: serializeError(err) },
      { status: 500 }
    );
  }
}
