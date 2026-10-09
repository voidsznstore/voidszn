/** All money in this codebase is integer cents. These are the only helpers that format it. */

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = "usd"): string {
  const key = currency.toUpperCase();
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: key });
    formatters.set(key, formatter);
  }
  return formatter.format(cents / 100);
}

/** Percentage discount on a cents amount, rounded to the nearest cent. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

/** Basis points of a cents amount. 2000 bps = 20%. */
export function bpsOf(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/** "32", "32.5", "1,250" and "$32.50" all mean an amount in cents. Returns null for anything else. */
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
