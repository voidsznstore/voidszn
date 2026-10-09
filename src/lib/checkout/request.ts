import { z } from "zod";
import { ZIP_PATTERN, isUsState, looksLikePhone } from "./address";
import { cartLinesSchema } from "./pricing";

/** One line of text a person typed: trimmed, no line breaks or other control characters. */
const line = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u);

const state = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isUsState);
const postalCode = z.string().trim().regex(ZIP_PATTERN);

/** Where the order is going. Asked for here, not on the payment page, because sales tax depends on it. */
export const addressSchema = z.object({
  name: line(2, 80),
  line1: line(3, 100),
  line2: line(0, 60).optional(),
  city: line(2, 60),
  state,
  postalCode,
  phone: z
    .string()
    .trim()
    .max(24)
    .refine((value) => value === "" || looksLikePhone(value))
    .optional(),
});

/** What the browser sends to price a cart or start a payment. Never a price. */
export const checkoutRequestSchema = z.object({
  lines: cartLinesSchema,
  /** A discount code as typed. Checked and priced on the server. */
  code: z.string().trim().max(40).optional(),
  email: z.string().trim().toLowerCase().max(254).email().optional(),
  /** Ticked "email me new designs and offers". */
  marketing: z.boolean().optional(),
  /** The full delivery address. Needed to start a payment. */
  address: addressSchema.optional(),
  /** Just the state and ZIP code, for working out sales tax while the rest is still being typed. */
  destination: z
    .object({ state, postalCode })
    .optional()
    // A half-typed ZIP code is not an error. It just can't be taxed yet.
    .catch(undefined),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const MAX_BODY_BYTES = 16_000;

/** What to say when one part of the address doesn't pass. */
const ADDRESS_ERRORS: Record<string, string> = {
  name: "Enter the name the parcel is for.",
  line1: "Enter your street address.",
  line2: "Keep the apartment or suite line under 60 characters.",
  city: "Enter your city.",
  state: "Pick your state.",
  postalCode: "Enter a 5-digit ZIP code.",
  phone: "Check the phone number, or leave it empty.",
};

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
    const about = (field: string) => parsed.error.issues.find((issue) => issue.path[0] === field);
    const address = about("address");
    return {
      ok: false,
      error: about("email")
        ? "Enter a valid email address."
        : address
          ? (ADDRESS_ERRORS[String(address.path[1])] ?? "Check your shipping address.")
          : "The cart could not be read.",
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
  /**
   * Sales tax on this order, once the state and ZIP code are known. Null while
   * they aren't, or when the store isn't charging tax.
   */
  salesTax: { cents: number; label: string } | null;
  /** True when tax will be worked out as soon as the state and ZIP code are typed. */
  salesTaxPending: boolean;
  /** Why the state and ZIP code can't both be right, in words for the customer. */
  addressError: string | null;
  /** Everything, tax included. */
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
