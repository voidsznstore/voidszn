import "server-only";
import type Stripe from "stripe";
import type { PaidOrderInput } from "@/db/queries/orders";
import { getProductBySlug } from "@/lib/catalog";
import { decodeCart } from "@/lib/checkout/pricing";

/** The id we store for a payment. Also used to find the order from a checkout session. */
export function paymentRefFor(session: Stripe.Checkout.Session): string {
  const intent = session.payment_intent;
  // A fully discounted order has no payment, so the session itself is the reference.
  return (typeof intent === "string" ? intent : intent?.id) ?? session.id;
}

/**
 * Turns a paid checkout session into the order to save. Returns null when the
 * session is missing something an order can't exist without, which means it did
 * not come from this store's checkout.
 */
export function orderFromSession(
  event: Pick<Stripe.Event, "id" | "type">,
  session: Stripe.Checkout.Session,
): PaidOrderInput | null {
  const cart = decodeCart(session.metadata);
  const email = session.customer_details?.email;
  const shipping = session.collected_information?.shipping_details;
  const address = shipping?.address ?? session.customer_details?.address;

  if (!cart || !email || !address?.line1 || session.amount_total === null) return null;

  return {
    event: { provider: "stripe", id: event.id, type: event.type },
    paymentRef: paymentRefFor(session),
    paymentProvider: "stripe",
    email,
    customerName: session.customer_details?.name ?? null,
    phone: session.customer_details?.phone ?? null,
    currency: session.currency ?? "usd",
    subtotalCents: session.amount_subtotal ?? 0,
    discountCents: session.total_details?.amount_discount ?? 0,
    shippingCents: session.total_details?.amount_shipping ?? 0,
    taxCents: session.total_details?.amount_tax ?? 0,
    totalCents: session.amount_total,
    shippingName: shipping?.name ?? session.customer_details?.name ?? email,
    shippingAddress: {
      line1: address.line1,
      ...(address.line2 ? { line2: address.line2 } : {}),
      city: address.city ?? "",
      state: address.state ?? "",
      postalCode: address.postal_code ?? "",
      country: address.country ?? "",
    },
    shippingMethod: "Standard shipping",
    items: cart.map((line) => ({
      slug: line.slug,
      productName: getProductBySlug(line.slug)?.name ?? line.slug,
      colorName: line.color,
      size: line.size,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
    })),
  };
}
