import { getDb, hasDatabase } from "@/db";
import { saveCart } from "@/db/queries/carts";
import { type AppliedDiscount, resolveDiscount, totalsFor } from "@/lib/checkout/discounts";
import { priceCart } from "@/lib/checkout/pricing";
import { readCheckoutRequest } from "@/lib/checkout/request";
import { getAutomation } from "@/lib/email/automation";
import { isEmailConfigured } from "@/lib/email/send";
import { ORDER_COOKIE } from "@/lib/checkout/return";
import { createCheckout, getWebhookKey, isSquareConfigured } from "@/lib/payments/square";
import { siteConfig } from "@/lib/site-config";

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
 * Starts a checkout. Takes the cart (product, color, size, quantity only), an
 * email and maybe a discount code. Prices everything from the catalog on the
 * server and returns the address of Square's payment page for that exact order.
 * Nothing is saved as an order here: that happens once Square confirms the payment.
 */
export async function POST(request: Request) {
  if (!isSquareConfigured()) return fail("Checkout is opening soon.", 503);

  const read = await readCheckoutRequest(request);
  if (!read.ok) return fail(read.error, read.status);
  const { lines, code, email, marketing } = read.data;
  if (!email) return fail("Enter your email address to continue.", 400);

  const priced = await priceCart(lines);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  // A code that can't be used stops checkout, so nobody pays full price by surprise.
  let discount: AppliedDiscount | null = null;
  if (code) {
    const result = await resolveDiscount(code, cart, email);
    if (!result.ok) return fail(result.error, 409);
    discount = result.discount;
  }
  const totals = totalsFor(cart, discount);

  // Make sure Square will tell us about the payment before anyone can pay. If this
  // fails the order is still saved when the customer returns to the site.
  try {
    await getWebhookKey();
  } catch (error) {
    console.error("[checkout] Webhook is not set up", error);
  }

  let checkout: { url: string; orderId: string };
  try {
    checkout = await createCheckout({
      lines: cart.lines.map((line) => ({
        name: line.name,
        slug: line.slug,
        color: line.color,
        size: line.size,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
      shippingCents: totals.shippingCents,
      discount,
      buyerEmail: email,
      wantsMarketing: marketing === true,
      redirectUrl: `${returnOrigin(request)}/order/confirmation`,
    });
  } catch (error) {
    console.error("[checkout] Could not create a payment page", error);
    return fail("Checkout could not be started. Please try again.", 502);
  }

  // Remember the cart, so a reminder can go out if the payment is never finished.
  // Only while reminders are switched on, which is also when checkout says it will.
  // Losing this must never stop someone from paying.
  if (hasDatabase()) {
    try {
      const db = getDb();
      const reminders = isEmailConfigured() && (await getAutomation(db)).cart.enabled;
      if (reminders) {
        await saveCart(db, {
          email,
          items: cart.lines.map((line) => ({
            slug: line.slug,
            name: line.name,
            color: line.color,
            size: line.size,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            imageUrl: line.imageUrl,
          })),
          totalCents: totals.totalCents,
          paymentOrderRef: checkout.orderId,
        });
      }
    } catch (error) {
      console.error("[checkout] Could not save the cart", error);
    }
  }

  return Response.json(
    { url: checkout.url },
    {
      headers: {
        // Remembers which order this browser went to pay, for the confirmation page.
        "Set-Cookie": `${ORDER_COOKIE}=${checkout.orderId}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
      },
    },
  );
}
