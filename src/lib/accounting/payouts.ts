import type { Day, Range } from "./days";
import { type Books, type Summary, profitIn, summarize } from "./ledger";

/**
 * What each partner is owed.
 *
 * A partner has earned their share of all the profit the store has ever made.
 * Their balance is that, plus or minus any corrections, less everything they
 * have already cashed out. Cashing out takes the whole balance, so it goes back
 * to $0 and builds up again from the next sale.
 *
 * Because the profit is worked out fresh each time, a late refund or a cost
 * added afterwards lowers what has been earned. If that happens after a cash-out
 * the balance goes below zero and stays at $0 available until new profit covers it.
 */

export type ShareRow = { shareBps: number; effectiveOn: Day; createdAt: number };
export type PayoutRow = { amountCents: number; status: "REQUESTED" | "SENT" | "CANCELLED" };
export type AdjustmentRow = { amountCents: number; reason: string; day: Day; addedBy: string };

/** A run of days over which the partner's share stayed the same. */
export type Stretch = {
  from: Day;
  /** The last day of the stretch, or null if it is still running. */
  to: Day | null;
  shareBps: number;
  /** The store's profit over the stretch. */
  profitCents: number;
  /** The partner's part of it. */
  shareCents: number;
};

export type Statement = {
  /** The store's books for all time, which the profit comes from. */
  summary: Summary;
  stretches: Stretch[];
  earnedCents: number;
  adjustments: AdjustmentRow[];
  adjustmentsCents: number;
  /** Cashed out and sent. */
  paidCents: number;
  /** Cashed out and waiting to be sent. */
  pendingCents: number;
  /** Earned, corrected, less everything cashed out. Below zero when a cash-out has been overtaken by later costs. */
  balanceCents: number;
  /** What can be cashed out now. Never below zero. */
  availableCents: number;
  /** The share that applies today, in basis points. */
  currentShareBps: number;
};

const dayBefore = (day: Day): Day => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

/** One row per start day: if the share was set twice for the same day, the later setting stands. */
function settled(shares: ShareRow[]): ShareRow[] {
  const byDay = new Map<Day, ShareRow>();
  for (const share of [...shares].sort((a, b) => a.createdAt - b.createdAt)) byDay.set(share.effectiveOn, share);
  return [...byDay.values()].sort((a, b) => (a.effectiveOn < b.effectiveOn ? -1 : 1));
}

/** The share in force on a given day. Zero before the first one starts. */
export function shareOn(shares: ShareRow[], day: Day): number {
  let bps = 0;
  for (const share of settled(shares)) {
    if (share.effectiveOn <= day) bps = share.shareBps;
  }
  return bps;
}

/** A share of an amount, rounded down to the cent so the shares can never add up to more than the whole. */
export const shareOf = (cents: number, bps: number) => Math.floor((cents * bps) / 10_000);

export function stretchesFor(books: Books, shares: ShareRow[]): Stretch[] {
  const rows = settled(shares);
  return rows.map((share, index) => {
    const next = rows[index + 1];
    const range: Range = { from: share.effectiveOn, ...(next ? { to: dayBefore(next.effectiveOn) } : {}) };
    const profitCents = profitIn(books, range);
    return {
      from: share.effectiveOn,
      to: range.to ?? null,
      shareBps: share.shareBps,
      profitCents,
      shareCents: shareOf(profitCents, share.shareBps),
    };
  });
}

/** What a partner earned over a stretch of days, honouring any change of share inside it. */
export function earnedIn(books: Books, shares: ShareRow[], range: Range): number {
  const rows = settled(shares);
  let total = 0;
  rows.forEach((share, index) => {
    const next = rows[index + 1];
    const from = range.from && range.from > share.effectiveOn ? range.from : share.effectiveOn;
    const end = next ? dayBefore(next.effectiveOn) : undefined;
    const to = range.to && (!end || range.to < end) ? range.to : end;
    if (to && to < from) return;
    total += shareOf(profitIn(books, { from, ...(to ? { to } : {}) }), share.shareBps);
  });
  return total;
}

export function statementFor(
  books: Books,
  today: Day,
  partner: { shares: ShareRow[]; payouts: PayoutRow[]; adjustments: AdjustmentRow[] },
): Statement {
  const stretches = stretchesFor(books, partner.shares);
  const earnedCents = stretches.reduce((total, stretch) => total + stretch.shareCents, 0);
  const adjustmentsCents = partner.adjustments.reduce((total, row) => total + row.amountCents, 0);
  const total = (status: PayoutRow["status"]) =>
    partner.payouts.reduce((sum, row) => (row.status === status ? sum + row.amountCents : sum), 0);
  const paidCents = total("SENT");
  const pendingCents = total("REQUESTED");
  const balanceCents = earnedCents + adjustmentsCents - paidCents - pendingCents;

  return {
    summary: summarize(books),
    stretches,
    earnedCents,
    adjustments: partner.adjustments,
    adjustmentsCents,
    paidCents,
    pendingCents,
    balanceCents,
    availableCents: Math.max(0, balanceCents),
    currentShareBps: shareOn(partner.shares, today),
  };
}

/** The smallest amount worth sending. */
export const MIN_PAYOUT_CENTS = 100;

/** "33.33%" */
export const formatShare = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
