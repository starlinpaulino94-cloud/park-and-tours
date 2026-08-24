/**
 * Stripe Webhook Handler (AUD-F22)
 *
 * Hardened webhook endpoint for the SaaS subscription lifecycle:
 * - In production the signature MUST verify (an unsigned event is rejected).
 * - Every event is de-duplicated by its Stripe id (Stripe retries deliveries).
 * - Subscription/invoice events update the tenant `company` (subscription_status,
 *   next_billing_at, stripe ids), resolving the company by its stored
 *   `stripe_customer_id` or by `metadata.company_id`. If no company resolves the
 *   event is logged and skipped, never crashing the endpoint.
 *
 * Subscribe in Stripe to: customer.subscription.{created,updated,deleted},
 * invoice.{paid,payment_failed}.
 */

import { NextResponse } from "next/server";
import { stripe, STRIPE_WEBHOOK_SECRET, cryptoProvider } from "@/lib/stripe";
import Stripe from "stripe";
import { supabaseService } from "@/lib/supabase/service";
import type { Company } from "@/lib/types";

const IS_PROD = process.env.NODE_ENV === "production";

function mapCompany(row: any): Company {
  return {
    ...row,
    _id: row.id,
    base_currency: row.currency || row.base_currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Company;
}

/** Maps a Stripe subscription status to the tenant's `subscription_status`. */
function mapSubscriptionStatus(status: Stripe.Subscription.Status): Company["subscription_status"] {
  switch (status) {
    case "trialing": return "trial";
    case "active": return "active";
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled":
    case "incomplete_expired": return "cancelled";
    case "paused": return "suspended";
    default: return "past_due";
  }
}

/** Resolves the tenant company from a customer id and/or metadata company_id. */
async function resolveCompany(opts: { customerId?: string | null; companyId?: string | null }): Promise<Company | null> {
  const sb = supabaseService();
  if (opts.companyId) {
    const { data } = await sb.from("organizations").select("*").eq("id", opts.companyId).maybeSingle();
    if (data) return mapCompany(data);
  }
  if (opts.customerId) {
    const { data } = await sb.from("organizations").select("*").eq("stripe_customer_id", opts.customerId).maybeSingle();
    if (data) return mapCompany(data);
  }
  return null;
}

/** Reads the subscription's current period end across Stripe API shapes. */
function periodEndISO(sub: Stripe.Subscription): string | undefined {
  const top = (sub as any).current_period_end as number | undefined;
  const item = sub.items?.data?.[0] && ((sub.items.data[0] as any).current_period_end as number | undefined);
  const ts = top || item;
  return ts ? new Date(ts * 1000).toISOString() : undefined;
}

async function syncSubscription(sub: Stripe.Subscription, deleted = false) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const company = await resolveCompany({ customerId, companyId: sub.metadata?.company_id });
  if (!company) {
    console.warn(`[stripe] suscripción ${sub.id}: no se encontró empresa (customer ${customerId})`);
    return { resolved: false, companyId: null as string | null };
  }
  const patch: Record<string, unknown> = {
    subscription_status: deleted ? "cancelled" : mapSubscriptionStatus(sub.status),
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
  };
  if (!deleted) {
    const end = periodEndISO(sub);
    if (end) patch.next_billing_at = end;
  }
  await supabaseService().from("organizations").update(patch).eq("id", company._id);
  console.log(`[stripe] empresa ${company._id} → ${patch.subscription_status} (sub ${sub.id})`);
  return { resolved: true, companyId: company._id };
}

async function syncInvoice(invoice: Stripe.Invoice, paid: boolean) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const company = await resolveCompany({ customerId, companyId: invoice.metadata?.company_id });
  if (!company) {
    console.warn(`[stripe] factura ${invoice.id}: no se encontró empresa (customer ${customerId})`);
    return { resolved: false, companyId: null as string | null };
  }
  const patch: Record<string, unknown> = { subscription_status: paid ? "active" : "past_due" };
  const end = (invoice.lines?.data?.[0]?.period?.end as number | undefined);
  if (paid && end) patch.next_billing_at = new Date(end * 1000).toISOString();
  await supabaseService().from("organizations").update(patch).eq("id", company._id);
  console.log(`[stripe] empresa ${company._id} → ${patch.subscription_status} (invoice ${invoice.id})`);
  return { resolved: true, companyId: company._id };
}

/** Idempotency: has this Stripe event already been processed? */
async function alreadyProcessed(eventId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseService().from("stripe_event").select("id").eq("event_id", eventId).limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  } catch (err) {
    // If the ledger table is missing we fail open (process the event) rather
    // than dropping it; duplicate processing is idempotent for our updates.
    console.error("[stripe] no se pudo verificar idempotencia:", err);
    return false;
  }
}

async function recordEvent(event: Stripe.Event, companyId: string | null, status: string) {
  try {
    const { error } = await supabaseService().from("stripe_event").insert({
      event_id: event.id,
      event_type: event.type,
      processed_at: new Date().toISOString(),
      status,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[stripe] no se pudo registrar el evento (idempotencia):", err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    let event: Stripe.Event;

    if (STRIPE_WEBHOOK_SECRET) {
      if (!signature) {
        return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
      }
      try {
        event = await stripe.webhooks.constructEventAsync(
          body, signature, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider
        );
      } catch (err: any) {
        console.error("[stripe] verificación de firma fallida:", err.message);
        return NextResponse.json({ error: `Signature verification failed: ${err.message}` }, { status: 400 });
      }
    } else {
      // SECURITY (AUD-F22/S07): never process unsigned events in production.
      // Without the secret we cannot trust the payload, so refuse rather than
      // acting on a potentially forged event.
      if (IS_PROD) {
        console.error("[stripe] STRIPE_WEBHOOK_SECRET no configurado en producción; evento rechazado");
        return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
      }
      console.warn("⚠️  [stripe] firma omitida (sin STRIPE_WEBHOOK_SECRET; solo desarrollo)");
      event = JSON.parse(body) as Stripe.Event;
    }

    // Idempotency: Stripe retries deliveries, so skip events already handled.
    if (await alreadyProcessed(event.id)) {
      console.log(`[stripe] evento ${event.id} ya procesado, se omite`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    let companyId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        // Links the tenant to its Stripe customer/subscription. The checkout
        // must carry `metadata.company_id` for this to resolve.
        const session = event.data.object as Stripe.Checkout.Session;
        const custId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const company = await resolveCompany({ customerId: custId, companyId: session.metadata?.company_id });
        if (company) {
          await supabaseService().from("organizations").update({
            stripe_customer_id: custId,
            stripe_subscription_id: subId,
            subscription_status: session.mode === "subscription" ? "active" : company.subscription_status,
          }).eq("id", company._id);
          companyId = company._id;
          console.log(`[stripe] checkout completado → empresa ${company._id} vinculada (customer ${custId})`);
        } else {
          console.warn(`[stripe] checkout ${session.id}: sin company_id en metadata, no se pudo vincular`);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        ({ companyId } = await syncSubscription(event.data.object as Stripe.Subscription));
        break;
      case "customer.subscription.deleted":
        ({ companyId } = await syncSubscription(event.data.object as Stripe.Subscription, true));
        break;
      case "invoice.paid":
        ({ companyId } = await syncInvoice(event.data.object as Stripe.Invoice, true));
        break;
      case "invoice.payment_failed":
        ({ companyId } = await syncInvoice(event.data.object as Stripe.Invoice, false));
        break;
      default:
        console.log(`[stripe] evento no manejado: ${event.type}`);
    }

    // Record only after successful handling, so a thrown handler lets Stripe
    // retry (the event stays un-recorded and will be reprocessed).
    await recordEvent(event, companyId, "processed");

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("[stripe][WEBHOOK ERROR]", err);
    return NextResponse.json({ error: err.message || "Webhook handler failed" }, { status: 500 });
  }
}
