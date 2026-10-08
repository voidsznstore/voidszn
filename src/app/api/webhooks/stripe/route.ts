import type Stripe from "stripe";
import { getDb } from "@/db";
import { recordEvent, recordPaidOrder } from "@/db/queries/orders";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";
import { orderFromSession } from "@/lib/payments/stripe-orders";

/**
 * Receives payment events from Stripe. This is the only place an order is
 * created: never the page the customer lands on after paying, which they might
 * not reach.
 *
 * - Every request must carry a valid signature. With no signing secret set,
 *   everything is refused.
 * - Each event is stored once, so Stripe's retries and replays change nothing.
 * - If saving fails, this answers with an error so Stripe sends the event again.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !isStripeConfigured()) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        // Some payment methods confirm later. Until they do, there is nothing to fulfil.
        if (session.payment_status === "unpaid") {
          await recordEvent(getDb(), { provider: "stripe", id: event.id, type: event.type });
          break;
        }
        const order = orderFromSession(event, session);
        if (!order) {
          console.error(`[webhook] ${event.id}: paid session ${session.id} could not be read`);
          await recordEvent(getDb(), { provider: "stripe", id: event.id, type: event.type });
          break;
        }
        const result = await recordPaidOrder(getDb(), order);
        console.log(`[webhook] ${event.id}: ${result.status}`);
        break;
      }
      case "checkout.session.async_payment_failed":
        await recordEvent(getDb(), { provider: "stripe", id: event.id, type: event.type });
        break;
      default:
        // Events this store doesn't act on are acknowledged and ignored.
        break;
    }
  } catch (error) {
    console.error(`[webhook] ${event.id}: failed`, error);
    return new Response("Could not process event", { status: 500 });
  }

  return Response.json({ received: true });
}
