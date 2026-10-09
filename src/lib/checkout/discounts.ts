import { getDb, hasDatabase } from "@/db";
import { type DiscountCode, countRedemptions, findDiscountByCode, hasOrdered } from "@/db/queries/discounts";
import { CODE_PATTERN, discountLabel, normalizeCode } from "@/lib/discounts/describe";
import { formatMoney, percentOf } from "@/lib/money";
import type { PricedCart } from "./pricing";

/**
 * Works out what a discount code takes off a cart. Like prices, this only ever
 * happens on the server: the browser sends the code as typed and nothing else.
 */

export type AppliedDiscount = {
  id: string;
  code: string;
  /** "20% off", "$5 off" or "Free shipping". */
  label: string;
  /** Taken off the items. Zero for a free shipping code. */
  discountCents: number;
  freeShipping: boolean;
};

export type DiscountResult =
  | { ok: true; discount: AppliedDiscount }
  | {
      ok: false;
      error: string;
      /** True when the code is fine and only the cart falls short, so it is worth keeping. */
      canApplyLater?: boolean;
    };

/** Why a code can't be used right now, or null if it can. Doesn't look at the cart. */
export function codeProblem(row: DiscountCode, now = new Date()): string | null {
  if (!row.isActive) return "That code isn't active.";
  if (row.startsAt && row.startsAt > now) return "That code isn't active yet.";
  if (row.expiresAt && row.expiresAt <= now) return "That code has expired.";
  if (row.maxUses !== null && row.usedCount >= row.maxUses) return "That code has been used up.";
  return null;
}

/** What a usable code takes off this cart. */
export function applyCode(row: DiscountCode, cart: PricedCart): DiscountResult {
  if (cart.subtotalCents < row.minOrderCents) {
    const short = row.minOrderCents - cart.subtotalCents;
    return {
      ok: false,
      error: `${row.code} needs an order of ${formatMoney(row.minOrderCents)} or more. Add ${formatMoney(short)} to use it.`,
      canApplyLater: true,
    };
  }

  const base = { id: row.id, code: row.code, label: discountLabel(row) };
  if (row.type === "FREE_SHIPPING") {
    return { ok: true, discount: { ...base, discountCents: 0, freeShipping: true } };
  }
  const raw = row.type === "PERCENTAGE" ? percentOf(cart.subtotalCents, row.value) : row.value;
  // A code never takes off more than the items cost.
  const discountCents = Math.max(0, Math.min(raw, cart.subtotalCents));
  return { ok: true, discount: { ...base, discountCents, freeShipping: false } };
}

/**
 * Checks a code as typed against the cart. `email` is who is buying, when known:
 * it is what a "once per customer" code is checked against.
 */
export async function resolveDiscount(
  rawCode: string,
  cart: PricedCart,
  email?: string | null,
): Promise<DiscountResult> {
  const code = normalizeCode(rawCode);
  const unknown = { ok: false as const, error: "That code isn't valid." };
  if (!CODE_PATTERN.test(code) || !hasDatabase()) return unknown;

  const db = getDb();
  const row = await findDiscountByCode(db, code);
  if (!row) return unknown;

  const problem = codeProblem(row);
  if (problem) return { ok: false, error: problem };

  if (row.perCustomerLimit !== null && email) {
    const used = await countRedemptions(db, row.id, email);
    if (used >= row.perCustomerLimit) {
      return {
        ok: false,
        error:
          row.perCustomerLimit === 1
            ? "That code can only be used once, and it has already been used with this email."
            : "That code has already been used as many times as it allows with this email.",
      };
    }
  }

  if (row.firstOrderOnly && email && (await hasOrdered(db, email))) {
    return { ok: false, error: "That code is for a first order, and this email has ordered before." };
  }

  return applyCode(row, cart);
}

/** What the customer pays once a discount is taken into account. */
export function totalsFor(cart: PricedCart, discount: AppliedDiscount | null) {
  const discountCents = discount?.discountCents ?? 0;
  const shippingCents = discount?.freeShipping ? 0 : cart.shippingCents;
  return {
    subtotalCents: cart.subtotalCents,
    discountCents,
    shippingCents,
    /** What shipping would have cost, for showing what a free shipping code saved. */
    shippingBeforeCents: cart.shippingCents,
    totalCents: cart.subtotalCents - discountCents + shippingCents,
  };
}
