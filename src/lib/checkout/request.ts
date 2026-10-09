import { z } from "zod";
import { cartLinesSchema } from "./pricing";

/** What the browser sends to price a cart or start a payment. Never a price. */
export const checkoutRequestSchema = z.object({
  lines: cartLinesSchema,
  /** A discount code as typed. Checked and priced on the server. */
  code: z.string().trim().max(40).optional(),
  email: z.string().trim().toLowerCase().max(254).email().optional(),
  /** Ticked "email me new designs and offers". */
  marketing: z.boolean().optional(),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const MAX_BODY_BYTES = 16_000;

/** Reads and checks the body of a checkout request. */
export async function readCheckoutRequest(
  request: Request,
): Promise<{ ok: true; data: CheckoutRequest } | { ok: false; error: string; status: number }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, error: "That cart is too large.", status: 413 };

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The cart could not be read.", status: 400 };
  }
  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return {
      ok: false,
      error: emailIssue ? "Enter a valid email address." : "The cart could not be read.",
      status: 400,
    };
  }
  return { ok: true, data: parsed.data };
}

/** The answer to "what will this cart cost?", shown on the checkout page. */
export type CheckoutQuote = {
  lines: {
    key: string;
    name: string;
    color: string;
    size: string;
    quantity: number;
    lineCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  /** What shipping costs without a free shipping code. */
  shippingBeforeCents: number;
  totalCents: number;
  /** The code that was applied, or null. */
  discount: { code: string; label: string; freeShipping: boolean } | null;
  /** Why the code that was sent couldn't be used, in words for the customer. */
  codeError: string | null;
  /** True when that code is fine and only the cart falls short (under its minimum). */
  codeCanApplyLater: boolean;
  /** Whether a cart left at checkout gets reminder emails, so the page can say so. */
  cartReminders: boolean;
};
