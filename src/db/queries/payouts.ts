import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../index";
import { adminUsers, partnerPayouts, payoutAdjustments, profitShares } from "../schema";
import { type Day, dayOf } from "@/lib/accounting/days";
import { type Books, buildBooks } from "@/lib/accounting/ledger";
import {
  type AdjustmentRow,
  MIN_PAYOUT_CENTS,
  type PayoutRow,
  type ShareRow,
  type Statement,
  shareOn,
  statementFor,
} from "@/lib/accounting/payouts";
import { loadFacts } from "./accounting";

/** A problem the person using the admin can fix. Shown to them as written. */
export class PayoutError extends Error {}

export type Payout = typeof partnerPayouts.$inferSelect;

/** What is kept with a payout: the sums behind it as they stood at that moment. */
export type Receipt = { takenAt: string; name: string; statement: Statement };

export type Partner = {
  id: string;
  name: string;
  email: string;
  isMaster: boolean;
  /** False until they have followed their invitation and set a password. */
  joined: boolean;
  disabled: boolean;
  payoutHandle: string | null;
  incomeTaxBps: number;
  shares: ShareRow[];
  /** Newest first. */
  payouts: Payout[];
  statement: Statement;
};

export type PayoutState = { books: Books; today: Day; partners: Partner[] };

/** One at a time: every change to payouts waits for the one before it to finish. */
const lock = (tx: Database) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('partner-payouts'))`);

/** The books and where every partner stands, as of now. */
export async function loadPayoutState(db: Database, now: Date = new Date()): Promise<PayoutState> {
  // One after another: inside a transaction there is a single connection to share.
  const facts = await loadFacts(db);
  const admins = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
  const shares = await db.select().from(profitShares);
  const payouts = await db.select().from(partnerPayouts).orderBy(desc(partnerPayouts.requestedAt));
  const adjustments = await db.select().from(payoutAdjustments).orderBy(asc(payoutAdjustments.createdAt));

  const books = buildBooks(facts, now);
  const today = dayOf(now);
  const partners = admins.map((admin): Partner => {
    const own = {
      shares: shares
        .filter((row) => row.adminId === admin.id)
        .map((row) => ({ shareBps: row.shareBps, effectiveOn: row.effectiveOn, createdAt: row.createdAt.getTime() })),
      payouts: payouts.filter((row) => row.adminId === admin.id),
      adjustments: adjustments
        .filter((row) => row.adminId === admin.id)
        .map((row): AdjustmentRow => ({
          amountCents: row.amountCents,
          reason: row.reason,
          day: dayOf(row.createdAt),
          addedBy: row.addedBy,
        })),
    };
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      isMaster: admin.role === "OWNER",
      joined: !admin.passwordHash.startsWith("!"),
      disabled: admin.disabledAt !== null,
      payoutHandle: admin.payoutHandle,
      incomeTaxBps: admin.incomeTaxBps,
      shares: own.shares,
      payouts: own.payouts,
      statement: statementFor(books, today, {
        shares: own.shares,
        payouts: own.payouts.map((row): PayoutRow => ({
          amountCents: row.amountCents,
          status: row.status as PayoutRow["status"],
        })),
        adjustments: own.adjustments,
      }),
    };
  });
  return { books, today, partners };
}

/**
 * Cashes out everything a partner has available. The amount is worked out here,
 * inside the lock, never taken from the browser, so two taps or two tabs can't
 * take the same money twice. The balance is $0 the moment this returns.
 */
export async function requestPayout(db: Database, adminId: string): Promise<Payout> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const state = await loadPayoutState(tx);
    const partner = state.partners.find((row) => row.id === adminId);
    if (!partner || partner.disabled) throw new PayoutError("This account can't cash out.");
    // An order with no cost counts as pure profit. Paying out on that would be
    // paying out money the printer is owed, so the costs come first.
    const unknown = partner.statement.summary.ordersWithoutCost;
    if (unknown > 0) {
      throw new PayoutError(
        `${unknown} ${unknown === 1 ? "order has" : "orders have"} no cost recorded, so the profit isn't known yet. Set what the products cost, or type the printer's bill on ${unknown === 1 ? "that order" : "those orders"}, then cash out.`,
      );
    }
    const amountCents = partner.statement.availableCents;
    if (amountCents < MIN_PAYOUT_CENTS) {
      throw new PayoutError(
        amountCents > 0
          ? `There has to be at least $${(MIN_PAYOUT_CENTS / 100).toFixed(2)} to cash out.`
          : "There is nothing to cash out right now.",
      );
    }
    const receipt: Receipt = {
      takenAt: new Date().toISOString(),
      name: partner.name,
      statement: partner.statement,
    };
    const [payout] = await tx
      .insert(partnerPayouts)
      .values({
        adminId,
        amountCents,
        status: "REQUESTED",
        method: "manual",
        destination: partner.payoutHandle,
        receipt: receipt as unknown as Record<string, unknown>,
      })
      .returning();
    return payout;
  });
}

/** Marks a cash-out as sent. Only one waiting to be sent can be. */
export async function markPayoutSent(db: Database, id: string, actor: string, note: string): Promise<Payout> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [payout] = await tx
      .update(partnerPayouts)
      .set({ status: "SENT", sentAt: new Date(), closedBy: actor, note: note || null })
      .where(and(eq(partnerPayouts.id, id), eq(partnerPayouts.status, "REQUESTED")))
      .returning();
    if (!payout) throw new PayoutError("That payout has already been dealt with. Refresh the page.");
    return payout;
  });
}

/** Calls off a cash-out that hasn't been sent. The money goes back on the partner's balance. */
export async function cancelPayout(db: Database, id: string, actor: string, note: string): Promise<Payout> {
  return db.transaction(async (tx) => {
    await lock(tx);
    const [payout] = await tx
      .update(partnerPayouts)
      .set({ status: "CANCELLED", cancelledAt: new Date(), closedBy: actor, note: note || null })
      .where(and(eq(partnerPayouts.id, id), eq(partnerPayouts.status, "REQUESTED")))
      .returning();
    if (!payout) throw new PayoutError("That payout has already been dealt with. Refresh the page.");
    return payout;
  });
}

/**
 * Changes a partner's share of the profit from today on. Profit made before
 * today keeps the split it was made under. Everyone's shares together can't
 * come to more than the whole.
 */
export async function setShare(db: Database, adminId: string, shareBps: number, actor: string): Promise<void> {
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) {
    throw new PayoutError("A share is between 0% and 100%.");
  }
  await db.transaction(async (tx) => {
    await lock(tx);
    const today = dayOf(new Date());
    const [admin] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
    if (!admin) throw new PayoutError("That account no longer exists.");

    const rows = await tx.select().from(profitShares);
    const others = new Map<string, ShareRow[]>();
    for (const row of rows) {
      if (row.adminId === adminId) continue;
      const list = others.get(row.adminId) ?? [];
      list.push({ shareBps: row.shareBps, effectiveOn: row.effectiveOn, createdAt: row.createdAt.getTime() });
      others.set(row.adminId, list);
    }
    const taken = [...others.values()].reduce((total, list) => total + shareOn(list, today), 0);
    if (taken + shareBps > 10_000) {
      throw new PayoutError(
        `The others already have ${Number((taken / 100).toFixed(2))}% between them, so the most this share can be is ${Number(((10_000 - taken) / 100).toFixed(2))}%.`,
      );
    }
    await tx.insert(profitShares).values({ adminId, shareBps, effectiveOn: today, setBy: actor });
  });
}

/** Adds to or takes from one partner's balance, with the reason on record. */
export async function addAdjustment(
  db: Database,
  adminId: string,
  amountCents: number,
  reason: string,
  actor: string,
): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new PayoutError("Enter an amount other than zero.");
  if (!reason.trim()) throw new PayoutError("Say what the change is for.");
  await db.transaction(async (tx) => {
    await lock(tx);
    await tx.insert(payoutAdjustments).values({ adminId, amountCents, reason: reason.trim(), addedBy: actor });
  });
}

export const setPayoutHandle = (db: Database, adminId: string, handle: string | null) =>
  db.update(adminUsers).set({ payoutHandle: handle }).where(eq(adminUsers.id, adminId));

export const setIncomeTaxRate = (db: Database, adminId: string, bps: number) =>
  db.update(adminUsers).set({ incomeTaxBps: bps }).where(eq(adminUsers.id, adminId));
