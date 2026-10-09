import { cartLinesSchema, priceCart } from "@/lib/checkout/pricing";
import { ORDER_COOKIE } from "@/lib/checkout/return";
import { createCheckout, getWebhookKey, isSquareConfigured } from "@/lib/payments/square";
import { siteConfig } from "@/lib/site-config";

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
 * it from the catalog on the server, and returns the address of Square's payment
 * page for that exact order. Nothing is saved as an order here: that happens once
 * Square confirms the payment.
 */
export async function POST(request: Request) {
  if (!isSquareConfigured()) return fail("Checkout is opening soon.", 503);

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

  const priced = await priceCart(parsed.data);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  // Make sure Square will tell us about the payment before anyone can pay. If this
  // fails the order is still saved when the customer returns to the site.
  try {
    await getWebhookKey();
  } catch (error) {
    console.error("[checkout] Webhook is not set up", error);
  }

  try {
    const checkout = await createCheckout({
      lines: cart.lines.map((line) => ({
        name: line.name,
        slug: line.slug,
        color: line.color,
        size: line.size,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
      shippingCents: cart.shippingCents,
      redirectUrl: `${returnOrigin(request)}/order/confirmation`,
    });

    return Response.json(
      { url: checkout.url },
      {
        headers: {
          // Remembers which order this browser went to pay, for the confirmation page.
          "Set-Cookie": `${ORDER_COOKIE}=${checkout.orderId}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
        },
      },
    );
  } catch (error) {
    console.error("[checkout] Could not create a payment page", error);
    return fail("Checkout could not be started. Please try again.", 502);
  }
}
