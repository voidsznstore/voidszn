import { getDb, hasDatabase } from "@/db";
import { resolveDiscount, totalsFor } from "@/lib/checkout/discounts";
import { priceCart } from "@/lib/checkout/pricing";
import { type CheckoutQuote, readCheckoutRequest } from "@/lib/checkout/request";
import { getAutomation } from "@/lib/email/automation";
import { isEmailConfigured } from "@/lib/email/send";

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
 * Prices a cart for the checkout page: items, discount, shipping and total.
 * Nothing is saved and no payment is started. Starting the payment prices it
 * all again.
 */
export async function POST(request: Request) {
  const read = await readCheckoutRequest(request);
  if (!read.ok) return fail(read.error, read.status);
  const { lines, code, email } = read.data;

  const priced = await priceCart(lines);
  if (!priced.ok) return fail(priced.error, 409);
  const { cart } = priced;

  const result = code ? await resolveDiscount(code, cart, email) : null;
  const discount = result?.ok ? result.discount : null;
  const totals = totalsFor(cart, discount);

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
    discount: discount
      ? { code: discount.code, label: discount.label, freeShipping: discount.freeShipping }
      : null,
    codeError: result && !result.ok ? result.error : null,
    codeCanApplyLater: Boolean(result && !result.ok && result.canApplyLater),
    cartReminders: await cartRemindersOn(),
  };
  return Response.json(quote);
}
