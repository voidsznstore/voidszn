import type Stripe from "stripe";
import { cartLinesSchema, encodeCart, priceCart } from "@/lib/checkout/pricing";
import { getStripe, isStripeConfigured, isTaxActive } from "@/lib/payments/stripe";
import { siteConfig } from "@/lib/site-config";

/** Label that groups these sessions in the Stripe Dashboard. */
const INTEGRATION_IDENTIFIER = "voidszn_embedded_checkout_qhzrmbtw";

const MAX_BODY_BYTES = 16_000;

/** Where to send the customer after paying. Only ever one of our own addresses. */
function returnOrigin(request: Request): string {
  const { origin, hostname } = new URL(request.url);
  const ours =
    hostname === "localhost" ||
    hostname === "voidszn.com" ||
    hostname.endsWith(".voidszn.com") ||
    hostname.endsWith(".vercel.app");
  return ours ? origin : siteConfig.url;
}

const fail = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Starts a checkout. Takes the cart (product, color, size, quantity only), prices
 * it from the catalog on the server, and returns the secret the embedded checkout
 * form needs. Nothing is recorded as an order here: that happens when the payment
 * processor confirms payment by webhook.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured()) return fail("Checkout is not available yet.", 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail("That cart is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("The cart could not be read.", 400);
  }

  const parsed = cartLinesSchema.safeParse((body as { lines?: unknown } | null)?.lines);
  if (!parsed.success) return fail("The cart could not be read.", 400);

  const priced = priceCart(parsed.data);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  const { shipping, orders, taxCodes } = siteConfig;
  const origin = returnOrigin(request);

  const params: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "embedded_page",
    mode: "payment",
    integration_identifier: INTEGRATION_IDENTIFIER,
    return_url: `${origin}/order/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    line_items: cart.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: "usd",
        unit_amount: line.unitPriceCents,
        tax_behavior: "exclusive",
        product_data: {
          name: line.product.name,
          description: `${line.color} / ${line.size}`,
          ...(line.typeSlug && taxCodes[line.typeSlug]
            ? { tax_code: taxCodes[line.typeSlug] }
            : {}),
        },
      },
    })),
    shipping_address_collection: { allowed_countries: [...shipping.countries] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Standard shipping",
          fixed_amount: { amount: cart.shippingCents, currency: "usd" },
          tax_behavior: "exclusive",
          delivery_estimate: {
            minimum: { unit: "business_day", value: shipping.deliveryEstimate.min },
            maximum: { unit: "business_day", value: shipping.deliveryEstimate.max },
          },
        },
      },
    ],
    automatic_tax: { enabled: await isTaxActive() },
    allow_promotion_codes: true,
    custom_text: {
      submit: {
        message: `Every item is printed to order, so sizes can't be exchanged. Damaged or wrong items are replaced or refunded within ${orders.issueWindowDays} days. [Returns policy](${siteConfig.url}/returns)`,
      },
    },
    metadata: encodeCart(cart.lines),
  };

  try {
    const session = await getStripe().checkout.sessions.create(params);
    if (!session.client_secret) throw new Error("Session has no client secret");
    return Response.json({ clientSecret: session.client_secret });
  } catch (error) {
    console.error("[checkout] Could not create a checkout session", error);
    return fail("Checkout could not be started. Please try again.", 502);
  }
}
