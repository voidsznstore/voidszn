import { getDb, hasDatabase } from "@/db";
import { saveCart } from "@/db/queries/carts";
import { saveCheckout } from "@/db/queries/checkouts";
import { setSetting } from "@/db/queries/settings";
import { placeProblem } from "@/lib/checkout/address";
import { type AppliedDiscount, resolveDiscountFor, totalsFor } from "@/lib/checkout/discounts";
import { priceCart } from "@/lib/checkout/pricing";
import { readCheckoutRequest } from "@/lib/checkout/request";
import { type CheckoutTax, isCollectingTax, salesTaxFor } from "@/lib/checkout/tax";
import { getAutomation } from "@/lib/email/automation";
import { isEmailConfigured } from "@/lib/email/send";
import { ORDER_COOKIE } from "@/lib/checkout/return";
import {
  CHECKOUT_NOTE_KEY,
  type CheckoutNote,
  SquareError,
  createCheckout,
  getWebhookKey,
  isSquareConfigured,
} from "@/lib/payments/square";
import { LIMITS, callerOf, take, tooMany } from "@/lib/rate-limit";
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
 * Writes down how the last attempt to open a payment page went, for the health
 * check. Shapes, error codes and field names only: never anything about the
 * customer. Not being able to write it down changes nothing.
 */
async function noteStart(note: Omit<CheckoutNote, "at">): Promise<void> {
  if (!hasDatabase()) return;
  try {
    await setSetting(getDb(), CHECKOUT_NOTE_KEY, JSON.stringify({ ...note, at: new Date().toISOString() }));
  } catch (error) {
    console.error("[checkout] Could not note how the payment page went", error);
  }
}

/**
 * Starts a checkout. Takes the cart (product, color, size, quantity only), an
 * email, the delivery address and maybe a discount code. Prices everything from
 * the catalog on the server, adds sales tax for that address, and returns the
 * address of Square's payment page for that exact order. Nothing is saved as an
 * order here: that happens once Square confirms the payment.
 */
export async function POST(request: Request) {
  if (!isSquareConfigured()) return fail("Checkout is opening soon.", 503);

  // Every payment page is a call to Square, so one caller only gets so many.
  const caller = callerOf(request);
  if (!(await take(LIMITS.checkout, caller))) return tooMany(LIMITS.checkout);

  const read = await readCheckoutRequest(request);
  if (!read.ok) return fail(read.error, read.status);
  const { lines, code, email, marketing, address } = read.data;
  if (!email) return fail("Enter your email address to continue.", 400);

  // The address is kept by the store until the payment comes back, which needs
  // the database. Without one (a bare local copy) Square asks for it instead.
  const carriesAddress = hasDatabase();
  if (carriesAddress) {
    if (!address) return fail("Enter your shipping address to continue.", 400);
    const problem = placeProblem(address.state, address.postalCode);
    if (problem) return fail(problem, 400);
  }

  const priced = await priceCart(lines);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  // A code that can't be used stops checkout, so nobody pays full price by surprise.
  let discount: AppliedDiscount | null = null;
  if (code) {
    const result = await resolveDiscountFor(caller, code, cart, email);
    if (!result.ok) return fail(result.error, 409);
    discount = result.discount;
  }
  const totals = totalsFor(cart, discount);

  // Sales tax for where the order is going. Worked out here and nowhere else.
  let tax: CheckoutTax | null = null;
  if (carriesAddress && address) {
    try {
      if (await isCollectingTax()) tax = salesTaxFor(cart, totals, address);
    } catch (error) {
      // Not knowing whether to charge tax is a reason to stop, not to guess.
      console.error("[checkout] Could not read the sales tax setting", error);
      return fail("Checkout could not be started. Please try again.", 503);
    }
  }
  const taxCents = tax?.taxCents ?? 0;
  const totalCents = totals.totalCents + taxCents;

  // One email address only gets so many payment pages too: starting checkout can
  // lead to reminder emails, and it must not be a way to pester someone else.
  if (!(await take(LIMITS.checkoutEmail, email))) return tooMany(LIMITS.checkoutEmail);

  // Make sure Square will tell us about the payment before anyone can pay. If this
  // fails the order is still saved when the customer returns to the site.
  try {
    await getWebhookKey();
  } catch (error) {
    console.error("[checkout] Webhook is not set up", error);
  }

  const shipTo =
    carriesAddress && address
      ? {
          line1: address.line1,
          ...(address.line2 ? { line2: address.line2 } : {}),
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: "US",
        }
      : null;

  let checkout: Awaited<ReturnType<typeof createCheckout>>;
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
      tax: tax && taxCents > 0 ? { cents: taxCents, name: tax.receiptName } : null,
      shipTo,
      buyerEmail: email,
      wantsMarketing: marketing === true,
      redirectUrl: `${returnOrigin(request)}/order/confirmation`,
    });
  } catch (error) {
    console.error("[checkout] Could not create a payment page", error);
    await noteStart({
      outcome: "refused by Square",
      refusals: error instanceof SquareError ? [{ shape: "square-asks", codes: error.codes, fields: error.fields }] : [],
    });
    return fail("Checkout could not be started. Please try again.", 502);
  }

  // Keep the address for when the payment comes back. Without it the order
  // would have nowhere to go, so failing here stops the checkout.
  if (shipTo && address) {
    try {
      await saveCheckout(getDb(), {
        paymentOrderRef: checkout.orderId,
        shippingName: address.name,
        phone: address.phone || null,
        shippingAddress: shipTo,
        taxCents,
        taxRateBps: tax?.rateBps ?? 0,
      });
    } catch (error) {
      console.error("[checkout] Could not keep the delivery address", error);
      await noteStart({ outcome: "the address could not be kept", refusals: checkout.refusals });
      return fail("Checkout could not be started. Please try again.", 502);
    }
  }
  await noteStart({ outcome: `ok (${checkout.shape})`, refusals: checkout.refusals });

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
          totalCents,
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
