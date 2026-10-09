import { formatMoney } from "@/lib/money";

/**
 * How a discount code is put into words. Safe to import anywhere, including the
 * browser and emails, so a code reads the same wherever it shows up.
 */

export type DiscountKind = "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";

export type DiscountTerms = {
  type: DiscountKind;
  /** PERCENTAGE: 1 to 100. FIXED: cents. FREE_SHIPPING: ignored. */
  value: number;
  minOrderCents: number;
};

/** Whole dollars lose the ".00": "$5 off" reads better than "$5.00 off". */
const tidyMoney = (cents: number) => formatMoney(cents).replace(/\.00$/, "");

/** "20% off", "$5 off" or "Free shipping". */
export function discountLabel(terms: Pick<DiscountTerms, "type" | "value">): string {
  if (terms.type === "PERCENTAGE") return `${terms.value}% off`;
  if (terms.type === "FIXED") return `${tidyMoney(terms.value)} off`;
  return "Free shipping";
}

/** The label plus any minimum: "20% off orders over $40". */
export function discountSummary(terms: DiscountTerms): string {
  const label = discountLabel(terms);
  if (terms.minOrderCents <= 0) return label;
  return terms.type === "FREE_SHIPPING"
    ? `${label} on orders over ${tidyMoney(terms.minOrderCents)}`
    : `${label} orders over ${tidyMoney(terms.minOrderCents)}`;
}

/** Codes are letters, numbers and dashes, always uppercase. */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,29}$/;

/**
 * Adds a code to one of the store's own links, so whoever taps it gets the code
 * applied without typing. Links to anywhere else are returned as they are.
 */
export function linkWithCode(url: string, code: string | null, siteUrl: string): string {
  if (!code) return url;
  try {
    const parsed = new URL(url);
    const site = new URL(siteUrl);
    const sameSite =
      parsed.hostname === site.hostname ||
      parsed.hostname.replace(/^www\./, "") === site.hostname.replace(/^www\./, "");
    if (!sameSite) return url;
    parsed.searchParams.set("code", code);
    return parsed.toString();
  } catch {
    return url;
  }
}
