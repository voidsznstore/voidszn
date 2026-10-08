/**
 * Business details and policy terms used across the footer, policy pages and emails.
 *
 * Anything in [SQUARE BRACKETS] is not filled in yet and shows on the site exactly
 * like that. Fill every one before launch. `unfilledSiteConfig()` lists what is left.
 *
 * The policy terms below mirror what the print supplier publishes, so the store
 * never promises a customer more than the supplier will back. Change them here and
 * every page updates.
 */
export const siteConfig = {
  name: "VOIDSZN",
  /** Public address of the store. No trailing slash. */
  url: "https://www.voidszn.com",
  /** Registered legal name of the business, e.g. "Voidszn LLC". */
  legalName: "[LEGAL BUSINESS NAME]",
  /** Physical mailing address. Required in marketing emails by CAN-SPAM. */
  mailingAddress: "[BUSINESS MAILING ADDRESS]",
  supportEmail: "support@voidszn.com",
  /** Where infringement notices go. Can be the same inbox as support. */
  legalEmail: "legal@voidszn.com",
  /** State whose law governs the terms. */
  governingState: "[GOVERNING STATE]",
  policiesUpdated: "October 8, 2026",

  shipping: {
    regions: "the United States",
    /** ISO country codes checkout will ship to. */
    countries: ["US"],
    /** Business days to print and pack before the order ships. */
    productionDays: "1 to 3",
    /** Business days in transit with standard shipping. */
    transitDays: "2 to 5",
    /** Order placed to delivered, in business days: production plus transit. */
    deliveryEstimate: { min: 3, max: 8 },
    /**
     * What the printer charges to ship, in cents, by product type. The first item
     * in an order pays `first`; every other item pays `additional`. Customers are
     * charged this amount, so shipping is passed through at cost.
     */
    rates: {
      "t-shirts": { first: 449, additional: 75 },
      crewnecks: { first: 599, additional: 125 },
      hoodies: { first: 649, additional: 125 },
      hats: { first: 499, additional: 75 },
    } as Record<string, { first: number; additional: number }>,
    /** Used for a product type that has no rate above. The highest rate, to be safe. */
    fallbackRate: { first: 649, additional: 125 },
  },

  /**
   * Stripe product tax codes by product type, from https://docs.stripe.com/tax/tax-codes.
   * Clothing is taxed differently from general goods in several states, so the
   * code matters. Confirm these with a tax advisor before taking live payments.
   */
  taxCodes: {
    "t-shirts": "txcd_30011000", // Clothing & Footwear
    crewnecks: "txcd_30011000",
    hoodies: "txcd_30011000",
    hats: "txcd_30060006", // Hats
  } as Record<string, string>,

  orders: {
    /** How long after ordering a customer can still cancel. */
    cancelWindow: "1 hour",
    /** Days after delivery to report a damaged, defective or wrong item. */
    issueWindowDays: 30,
    /** Business days to process a refund or send a replacement once approved. */
    refundDays: 10,
  },
} as const;

/** Names of the fields that still hold a [PLACEHOLDER]. Empty when ready to launch. */
export function unfilledSiteConfig(): string[] {
  return Object.entries(siteConfig)
    .filter(([, value]) => typeof value === "string" && value.startsWith("["))
    .map(([key]) => key);
}
