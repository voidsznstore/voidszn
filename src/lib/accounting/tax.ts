import { FL_ZIPS_BY_COUNTY } from "./fl-zip-counties";
import type { Day } from "./days";

/**
 * The tax rules the books use. Every figure here was checked against its source
 * in October 2026, for tax year 2026; the sources are listed in docs/tax-notes.md.
 * Rates change. Florida publishes new county surtax rates each November and the
 * IRS new brackets each autumn, so this file needs a look once a year.
 *
 * None of this is tax advice. It is the arithmetic an accountant would start from.
 */
export const TAX_FIGURES_YEAR = 2026;

/* ------------------------------------------------------------------ */
/* Florida sales tax                                                   */
/* ------------------------------------------------------------------ */

/** The state rate on clothing and most other goods: 6%. */
export const FL_STATE_BPS = 600;

/**
 * Each county's discretionary sales surtax for 2026, in basis points (50 = 0.5%).
 * It follows the county the order is delivered to, not the county the store is in.
 * Source: Florida Department of Revenue, Form DR-15DSS for 2026.
 */
export const FL_SURTAX_BPS: Record<string, number> = {
  Alachua: 150, Baker: 100, Bay: 100, Bradford: 100, Brevard: 100, Broward: 100,
  Calhoun: 150, Charlotte: 100, Citrus: 0, Clay: 150, Collier: 0, Columbia: 150,
  DeSoto: 150, Dixie: 100, Duval: 150, Escambia: 150, Flagler: 100, Franklin: 150,
  Gadsden: 150, Gilchrist: 100, Glades: 100, Gulf: 100, Hamilton: 200, Hardee: 100,
  Hendry: 150, Hernando: 50, Highlands: 150, Hillsborough: 150, Holmes: 150,
  "Indian River": 100, Jackson: 150, Jefferson: 100, Lafayette: 100, Lake: 100, Lee: 50,
  Leon: 150, Levy: 100, Liberty: 150, Madison: 150, Manatee: 100, Marion: 150, Martin: 50,
  "Miami-Dade": 100, Monroe: 150, Nassau: 100, Okaloosa: 100, Okeechobee: 100, Orange: 50,
  Osceola: 150, "Palm Beach": 50, Pasco: 100, Pinellas: 100, Polk: 100, Putnam: 100,
  "St. Johns": 50, "St. Lucie": 100, "Santa Rosa": 100, Sarasota: 100, Seminole: 100,
  Sumter: 100, Suwannee: 100, Taylor: 100, Union: 100, Volusia: 50, Wakulla: 150,
  Walton: 100, Washington: 150,
};

/** The county the store is in. Orders collected in person are taxed here. */
export const HOME_COUNTY = "Orange";

/** Used when a Florida ZIP code isn't in the table. 1% is the rate most counties charge. */
export const UNKNOWN_COUNTY_SURTAX_BPS = 100;

/**
 * The back-to-school sales tax holiday. From 2026 it runs July 20 to August 20
 * every year, and clothing priced at $100 or less an item is not taxed. An online
 * order counts if it was placed during the holiday, whenever it arrives.
 */
export const FL_HOLIDAY = { from: "07-20", to: "08-20", firstYear: 2026, itemCapCents: 100_00 };

let countyByZip: Map<string, string> | null = null;

/** The Florida county a ZIP code is in, or null if the table doesn't have it. */
export function floridaCounty(postalCode: string): string | null {
  if (!countyByZip) {
    countyByZip = new Map();
    for (const [county, zips] of Object.entries(FL_ZIPS_BY_COUNTY)) {
      for (const zip of zips.split(" ")) countyByZip.set(zip, county);
    }
  }
  return countyByZip.get(postalCode.trim().slice(0, 5)) ?? null;
}

export const isFlorida = (state: string) => /^(fl|fla|florida)\.?$/i.test(state.trim());

export const inSalesTaxHoliday = (day: Day) =>
  Number(day.slice(0, 4)) >= FL_HOLIDAY.firstYear &&
  day.slice(5) >= FL_HOLIDAY.from &&
  day.slice(5) <= FL_HOLIDAY.to;

export type SalesTaxInput = {
  /** The day the order was paid for, on the store's calendar. */
  day: Day;
  state: string;
  postalCode: string;
  /** Collected in person, so nothing was delivered anywhere. */
  pickup: boolean;
  /** What the customer paid for the items, after any discount. */
  itemsCents: number;
  /** What the customer paid for shipping. */
  shippingCents: number;
  /** Of the items' price before discount, how much was for items at or under the holiday cap. */
  holidayEligibleCents: number;
  /** The items' price before discount. */
  subtotalCents: number;
};

export type SalesTax = {
  /** Tax due to Florida on this sale. Zero for anything delivered out of state. */
  taxCents: number;
  rateBps: number;
  taxableCents: number;
  county: string | null;
  /** False when the county had to be guessed, so the surtax is an estimate. */
  countyKnown: boolean;
  /** Why nothing is due, when nothing is. */
  exempt?: "out_of_state" | "holiday";
};

/**
 * What Florida is owed on one sale.
 *
 * - 6% state tax plus the surtax of the county it was delivered to.
 * - Charged on the price after a discount the store gave.
 * - Shipping is taxed too: the customer can't avoid it, so Florida counts it as
 *   part of the price even though it is listed on its own line.
 * - Orders delivered outside Florida owe Florida nothing.
 * - Rounded to the cent, halves up, as Florida's own tables do.
 */
export function floridaSalesTax(input: SalesTaxInput): SalesTax {
  const none = { taxCents: 0, rateBps: 0, taxableCents: 0, county: null, countyKnown: true };
  if (!input.pickup && !isFlorida(input.state)) return { ...none, exempt: "out_of_state" };

  const county = input.pickup ? HOME_COUNTY : floridaCounty(input.postalCode);
  const surtax = county ? (FL_SURTAX_BPS[county] ?? UNKNOWN_COUNTY_SURTAX_BPS) : UNKNOWN_COUNTY_SURTAX_BPS;
  const rateBps = FL_STATE_BPS + surtax;
  const countyKnown = county !== null && county in FL_SURTAX_BPS;

  let taxableCents = Math.max(0, input.itemsCents) + Math.max(0, input.shippingCents);
  if (inSalesTaxHoliday(input.day) && input.subtotalCents > 0 && input.holidayEligibleCents > 0) {
    // During the holiday the share of the order made up of items at or under the
    // cap is not taxed, and nor is the same share of the shipping.
    const exemptShare = Math.min(1, input.holidayEligibleCents / input.subtotalCents);
    taxableCents = Math.round(taxableCents * (1 - exemptShare));
    if (taxableCents === 0) return { ...none, rateBps, county, countyKnown, exempt: "holiday" };
  }
  return { taxCents: Math.round((taxableCents * rateBps) / 10_000), rateBps, taxableCents, county, countyKnown };
}

/* ------------------------------------------------------------------ */
/* Federal tax on a partner's share                                    */
/* ------------------------------------------------------------------ */

/**
 * Florida has no personal income tax, and a partnership pays no income tax of its
 * own. Each partner owes federal tax on their share of the profit, whether or not
 * they have cashed it out: self-employment tax, and income tax at their own rate.
 */
export const FEDERAL = {
  /** Self-employment tax is worked out on 92.35% of the profit. */
  seFactor: 0.9235,
  /** Social Security, charged up to the wage base. */
  socialSecurityRate: 0.124,
  socialSecurityBaseCents: 184_500_00,
  medicareRate: 0.029,
  /** Below this much profit in a year there is no self-employment tax. */
  seFloorCents: 400_00,
  /** The qualified business income deduction takes 20% off the profit before income tax. */
  qbiRate: 0.2,
  /** The 2026 income tax rates, in basis points, with where each starts for a single filer. */
  brackets: [
    { bps: 1000, singleFrom: 0 },
    { bps: 1200, singleFrom: 12_400 },
    { bps: 2200, singleFrom: 50_400 },
    { bps: 2400, singleFrom: 105_700 },
    { bps: 3200, singleFrom: 201_775 },
    { bps: 3500, singleFrom: 256_225 },
    { bps: 3700, singleFrom: 640_600 },
  ],
  /** When each quarter's estimated payment is due, as month-day. The last falls in the next year. */
  estimatedDue: ["04-15", "06-15", "09-15", "01-15"],
} as const;

export const isBracket = (bps: number) => FEDERAL.brackets.some((bracket) => bracket.bps === bps);

export type SetAside = {
  selfEmploymentCents: number;
  incomeTaxCents: number;
  totalCents: number;
};

/**
 * Roughly what one partner should keep back for federal tax on this year's share.
 *
 * - Self-employment tax: 15.3% of 92.35% of the share (12.4% Social Security up
 *   to the wage base, 2.9% Medicare).
 * - Income tax: the share, less half the self-employment tax, less the 20%
 *   business income deduction, at the rate the partner picked. That rate should
 *   be the bracket their other income puts them in.
 *
 * It ignores anything this screen can't know: a day job that has already used up
 * the Social Security wage base, other deductions, credits, a spouse's income.
 */
export function federalSetAside(shareCents: number, incomeTaxBps: number): SetAside {
  if (shareCents <= 0) return { selfEmploymentCents: 0, incomeTaxCents: 0, totalCents: 0 };

  const earnings = shareCents * FEDERAL.seFactor;
  const selfEmployment =
    earnings < FEDERAL.seFloorCents
      ? 0
      : Math.min(earnings, FEDERAL.socialSecurityBaseCents) * FEDERAL.socialSecurityRate +
        earnings * FEDERAL.medicareRate;
  const taxable = Math.max(0, shareCents - selfEmployment / 2) * (1 - FEDERAL.qbiRate);
  const income = (taxable * incomeTaxBps) / 10_000;

  const selfEmploymentCents = Math.round(selfEmployment);
  const incomeTaxCents = Math.round(income);
  return { selfEmploymentCents, incomeTaxCents, totalCents: selfEmploymentCents + incomeTaxCents };
}
