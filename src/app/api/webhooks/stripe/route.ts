import { isFromStripe, isStripeConfigured } from "@/lib/payments/stripe";
import { followUpByRef } from "@/lib/payouts/card";

type PayoutEvent = { type?: string; data?: { object?: { id?: string; object?: string } } };

/**
 * Receives events from Stripe about payouts to partners' cards, so a payout
 * that bounces is dealt with at once and not at the next timed check.
 *
 * - Every request must be signed by Stripe (STRIPE_WEBHOOK_SECRET).
 * - The event only says which payout to look at. Where the payout stands is
 *   then read from Stripe directly.
 * - If handling fails, this answers with an error so Stripe sends it again.
 *
 * The timed job does the same follow-up every half hour, so the store still
 * works before this is set up.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Webhook is not configured", { status: 503 });
  }
  const body = await request.text();
  if (!isFromStripe(body, request.headers.get("stripe-signature"))) {
    return new Response("Invalid signature", { status: 403 });
  }

  let event: PayoutEvent;
  try {
    event = JSON.parse(body) as PayoutEvent;
  } catch {
    return new Response("Unreadable event", { status: 400 });
  }

  const payoutId = event.data?.object?.id;
  const isPayout = event.type === "payout.paid" || event.type === "payout.failed" || event.type === "payout.canceled";
  if (!isPayout || typeof payoutId !== "string" || !/^po_[A-Za-z0-9_]{6,200}$/.test(payoutId)) {
    return Response.json({ received: true });
  }

  try {
    await followUpByRef(payoutId);
  } catch (error) {
    console.error("[stripe webhook] Could not follow up a payout", error);
    return new Response("Could not process event", { status: 500 });
  }
  return Response.json({ received: true });
}
