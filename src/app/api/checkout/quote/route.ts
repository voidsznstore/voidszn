import { getDb, hasDatabase } from "@/db";
import { placeProblem } from "@/lib/checkout/address";
import { resolveDiscountFor, totalsFor } from "@/lib/checkout/discounts";
import { priceCart } from "@/lib/checkout/pricing";
import { type CheckoutQuote, readCheckoutRequest } from "@/lib/checkout/request";
import { getAutomation } from "@/lib/email/automation";
import { isEmailConfigured } from "@/lib/email/send";
import { isCollectingTax, salesTaxFor } from "@/lib/checkout/tax";
import { LIMITS, callerOf, take, tooMany } from "@/lib/rate-limit";

/** Whether someone who leaves checkout now would be sent a reminder. */
async function cartRemindersOn(): Promise<boolean> {
  if (!hasDatabase() || !isEmailConfigured()) return false;
  try {
    return (await getAutomation(getDb())).cart.enabled;
  } catch {
    return false;
  }
}

const fail = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Prices a cart for the checkout page: items, discount, shipping, sales tax and total.
 * Nothing is saved and no payment is started. Starting the payment prices it
 * all again.
 */
export async function POST(request: Request) {
  const caller = callerOf(request);
  if (!(await take(LIMITS.quote, caller))) return tooMany(LIMITS.quote);

  const read = await readCheckoutRequest(request);
  if (!read.ok) return fail(read.error, read.status);
  const { lines, code, email, destination } = read.data;

  const priced = await priceCart(lines);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  const result = code ? await resolveDiscountFor(caller, code, cart, email) : null;
  const discount = result?.ok ? result.discount : null;
  const totals = totalsFor(cart, discount);

  // Tax needs to know where the order is going. Until then the total is shown without it.
  const collecting = await isCollectingTax();
  const addressError = destination ? placeProblem(destination.state, destination.postalCode) : null;
  const tax = collecting && destination && !addressError ? salesTaxFor(cart, totals, destination) : null;

  const quote: CheckoutQuote = {
    lines: cart.lines.map((line) => ({
      key: `${line.slug}:${line.color}:${line.size}`,
      name: line.name,
      color: line.color,
      size: line.size,
      quantity: line.quantity,
      lineCents: line.unitPriceCents * line.quantity,
    })),
    ...totals,
    salesTax: tax ? { cents: tax.taxCents, label: tax.label } : null,
    salesTaxPending: collecting && !tax,
    addressError,
    totalCents: totals.totalCents + (tax?.taxCents ?? 0),
    discount: discount
      ? { code: discount.code, label: discount.label, freeShipping: discount.freeShipping }
      : null,
    codeError: result && !result.ok ? result.error : null,
    codeCanApplyLater: Boolean(result && !result.ok && result.canApplyLater),
    cartReminders: await cartRemindersOn(),
  };
  return Response.json(quote);
}
