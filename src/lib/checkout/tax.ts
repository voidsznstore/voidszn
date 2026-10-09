import "server-only";
import { z } from "zod";
import { type Database, getDb, hasDatabase } from "@/db";
import { getSetting, setSetting } from "@/db/queries/settings";
import { dayOf } from "@/lib/accounting/days";
import { FL_HOLIDAY, floridaSalesTax } from "@/lib/accounting/tax";
import type { PricedCart } from "./pricing";

/**
 * Sales tax at checkout. The rules themselves (rates, what is taxed, the tax
 * holiday) live in `src/lib/accounting/tax.ts` and are the same ones the books
 * use, so what is charged here is exactly what the books say is owed.
 *
 * The store is in Florida and registered nowhere else, so only orders delivered
 * in Florida are taxed: 6% plus the surtax of the county they are delivered to.
 */

const KEY = "tax.settings";

const schema = z.object({
  /** Add Florida sales tax to orders delivered in Florida. */
  collect: z.boolean(),
});

export type TaxSettings = z.infer<typeof schema>;

/**
 * On to begin with. A Florida store owes this tax on every Florida order whether
 * or not it charges it, so leaving it off only means paying it out of the price.
 */
export const DEFAULT_TAX_SETTINGS: TaxSettings = { collect: true };

export async function getTaxSettings(db: Database): Promise<TaxSettings> {
  const raw = await getSetting(db, KEY);
  if (!raw) return DEFAULT_TAX_SETTINGS;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Falls through to the default below.
  }
  console.error("[tax] The saved sales tax setting can't be read. Charging tax, as by default.");
  return DEFAULT_TAX_SETTINGS;
}

export async function setCollectTax(db: Database, on: boolean): Promise<void> {
  await setSetting(db, KEY, JSON.stringify(schema.parse({ collect: on })));
}

/** Whether checkout is charging sales tax right now. Without a database it can't, so it doesn't. */
export async function isCollectingTax(): Promise<boolean> {
  if (!hasDatabase()) return false;
  return (await getTaxSettings(getDb())).collect;
}

/** "6.5%" from 650. */
export const formatRate = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export type CheckoutTax = {
  taxCents: number;
  /** 650 for 6.5%. Zero when nothing is due. */
  rateBps: number;
  /** For the checkout page: "Sales tax (6.5%)". */
  label: string;
  /** For the payment page and receipt: "Florida sales tax (6.5%)". */
  receiptName: string;
};

/**
 * The sales tax on a cart going to this state and ZIP code, worked out for today.
 * `itemsCents` is what the items cost after any discount.
 */
export function salesTaxFor(
  cart: PricedCart,
  totals: { subtotalCents: number; discountCents: number; shippingCents: number },
  destination: { state: string; postalCode: string },
  now = new Date(),
): CheckoutTax {
  const tax = floridaSalesTax({
    day: dayOf(now),
    state: destination.state,
    postalCode: destination.postalCode,
    pickup: false,
    itemsCents: totals.subtotalCents - totals.discountCents,
    shippingCents: totals.shippingCents,
    subtotalCents: totals.subtotalCents,
    holidayEligibleCents: cart.lines.reduce(
      (sum, line) => (line.unitPriceCents <= FL_HOLIDAY.itemCapCents ? sum + line.unitPriceCents * line.quantity : sum),
      0,
    ),
  });
  const rate = tax.taxCents > 0 ? ` (${formatRate(tax.rateBps)})` : "";
  return {
    taxCents: tax.taxCents,
    rateBps: tax.taxCents > 0 ? tax.rateBps : 0,
    label: `Sales tax${rate}`,
    receiptName: `Florida sales tax${rate}`,
  };
}
