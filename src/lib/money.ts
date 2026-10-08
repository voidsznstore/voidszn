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
