import { isFromSquare, isSquareConfigured, isSquareId } from "@/lib/payments/square";
import { settlePayment } from "@/lib/payments/square-orders";

type PaymentEvent = {
  event_id?: string;
  type?: string;
  data?: { object?: { payment?: { id?: string; status?: string } } };
};

/**
 * Receives payment events from Square and saves the order when a payment
 * completes. Customers don't always make it back to the site after paying, so
 * this is what makes sure no paid order is missed.
 *
 * - Every request must be signed by Square.
 * - The event only says which payment to look at. What was paid is then read
 *   from Square directly.
 * - Each event is stored once and each payment makes one order, so Square's
 *   retries change nothing.
 * - If saving fails, this answers with an error so Square sends the event again.
 */
export async function POST(request: Request) {
  if (!isSquareConfigured()) return new Response("Webhook is not configured", { status: 503 });

  const signature = request.headers.get("x-square-hmacsha256-signature");
  if (!signature) return new Response("Missing signature", { status: 403 });

  const body = await request.text();
  let genuine: boolean;
  try {
    genuine = await isFromSquare(body, signature);
  } catch (error) {
    console.error("[webhook] Could not check the signature", error);
    return new Response("Webhook is not ready", { status: 503 });
  }
  if (!genuine) return new Response("Invalid signature", { status: 403 });

  let event: PaymentEvent;
  try {
    event = JSON.parse(body) as PaymentEvent;
  } catch {
    return new Response("Unreadable event", { status: 400 });
  }

  const payment = event.data?.object?.payment;
  const isPayment = event.type === "payment.created" || event.type === "payment.updated";
  if (!isPayment || payment?.status !== "COMPLETED" || !isSquareId(payment.id) || !event.event_id) {
    // Nothing to do yet, or an event this store doesn't act on.
    return Response.json({ received: true });
  }

  try {
    const result = await settlePayment(payment.id, {
      provider: "square",
      id: event.event_id,
      type: event.type ?? "payment.updated",
    });
    console.log(`[webhook] ${event.event_id}: ${result.status}`);
  } catch (error) {
    console.error(`[webhook] ${event.event_id}: failed`, error);
    return new Response("Could not process event", { status: 500 });
  }

  return Response.json({ received: true });
}
