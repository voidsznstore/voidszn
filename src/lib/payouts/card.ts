import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  type ClaimedPayout,
  type Payout,
  cardPayoutsToFollow,
  claimForCard,
  findCardPayoutByRef,
  markCardSent,
  noteCardProgress,
  noteSentPayout,
  setStripeAccount,
  undoFailedCardPayout,
} from "@/db/queries/payouts";
import { adminUsers } from "@/db/schema";
import { sendEmail } from "@/lib/email/send";
import { payoutFailedEmail } from "@/lib/email/templates";
import { formatMoney } from "@/lib/money";
import {
  type PartnerAccount,
  type PayoutCard,
  StripeError,
  createDashboardLink,
  createInstantPayout,
  createOnboardingLink,
  createRecipientAccount,
  createTransfer,
  ensureManualPayouts,
  findPayoutFor,
  findTransfersFor,
  getPartnerAccount,
  getPayout,
  getStoreBalance,
  isLiveMode,
  isStripeConfigured,
  reverseTransfer,
} from "@/lib/payments/stripe";
import { siteConfig } from "@/lib/site-config";

/**
 * Paying a partner's cash-out to their debit card through Stripe.
 *
 * The cash-out itself (the amount, and taking it off the balance) is decided
 * elsewhere, before any of this runs. This only moves money that has already
 * been cashed out, so nothing here can change how much anyone is owed.
 *
 * The rule everything below keeps: for one cash-out, money either reaches the
 * card once and the cash-out is marked sent, or it is back in the store's
 * Stripe balance and the cash-out is still waiting (or called off). Never both.
 */

/** Something stopped a card payout. The message is written for the people using the admin. */
export class CardPayoutError extends Error {}

/** Stripe's limits for one instant payout to a US debit card. */
const MIN_CARD_CENTS = 50;
const MAX_CARD_CENTS = 9_999_00;

const PAYOUTS_URL = `${siteConfig.url}/admin/payouts`;

export type CardStatus =
  /** No Stripe key yet: card payouts are switched off for everyone. */
  | { state: "off" }
  /** This person hasn't started adding a card. */
  | { state: "none" }
  /** Stripe is still waiting on them for details, or for a card it can pay instantly. */
  | { state: "unfinished"; reason: string }
  | { state: "ready"; card: PayoutCard; practice: boolean }
  /** Stripe couldn't be reached to check. */
  | { state: "unknown" };

const describe = (account: PartnerAccount): { ready: true; card: PayoutCard } | { ready: false; reason: string } => {
  const instant = account.destinations.find((destination) => destination.instant);
  if (!account.canReceive) {
    return { ready: false, reason: "Stripe still needs a few details from you before it can pay you." };
  }
  if (!instant) {
    return {
      ready: false,
      reason:
        account.destinations.length > 0
          ? `${account.destinations[0].label} can't take instant payouts. Add a debit card (Visa, Mastercard or Discover, not prepaid).`
          : "Add a debit card for your payouts to land on.",
    };
  }
  return { ready: true, card: instant };
};

/** Where one person's card set-up stands, asked of Stripe right now. */
export async function cardStatusFor(partner: {
  stripeAccountId: string | null;
  stripeLivemode: boolean | null;
}): Promise<CardStatus> {
  if (!isStripeConfigured()) return { state: "off" };
  if (!partner.stripeAccountId) return { state: "none" };
  try {
    const live = await isLiveMode();
    // An account made with a test key means nothing to a live key, and the other way round.
    if (partner.stripeLivemode !== live) return { state: "none" };
    const status = describe(await getPartnerAccount(partner.stripeAccountId));
    return status.ready
      ? { state: "ready", card: status.card, practice: !live }
      : { state: "unfinished", reason: status.reason };
  } catch (error) {
    console.error("[card payouts] Could not read a partner's Stripe account", error);
    return { state: "unknown" };
  }
}

/**
 * Where to send someone to add or finish adding their card: Stripe's own form.
 * Makes their Stripe account the first time, unless `createAccount` is false.
 * Asking twice never makes two. Returns null when there is no account and one
 * may not be made.
 */
export async function cardSetupUrl(
  admin: { id: string; name: string; email: string },
  /** One of the site's own addresses, to come back to afterwards. */
  origin: string,
  options: { createAccount: boolean } = { createAccount: true },
): Promise<string | null> {
  if (!isStripeConfigured()) throw new CardPayoutError("Card payouts aren't switched on yet.");
  const db = getDb();
  const [row] = await db
    .select({ stripeAccountId: adminUsers.stripeAccountId, stripeLivemode: adminUsers.stripeLivemode })
    .from(adminUsers)
    .where(eq(adminUsers.id, admin.id))
    .limit(1);

  try {
    const live = await isLiveMode();
    // A real account is never swapped for a practice one: money could be sitting in it.
    if (row?.stripeAccountId && row.stripeLivemode === true && !live) {
      throw new CardPayoutError(
        "The store's Stripe key is a test key right now, and you already have a real card set up. Nothing to do until the live key is back.",
      );
    }
    let accountId = row?.stripeAccountId && row.stripeLivemode === live ? row.stripeAccountId : null;
    if (!accountId) {
      if (!options.createAccount) return null;
      accountId = await createRecipientAccount({ email: admin.email, name: admin.name, adminId: admin.id, live });
      await setStripeAccount(db, admin.id, accountId, live);
      // Best done now; it is checked again before any money moves.
      await ensureManualPayouts(accountId).catch(() => undefined);
    }
    return await createOnboardingLink(accountId, {
      returnUrl: `${origin}/admin/payouts?card=done`,
      refreshUrl: `${origin}/admin/payouts/card`,
    });
  } catch (error) {
    if (error instanceof StripeError) {
      console.error(`[card payouts] Stripe refused to start card set-up: ${error.code}: ${error.detail}`);
      throw new CardPayoutError(`Stripe couldn't start that: ${error.detail}`);
    }
    throw error;
  }
}

/** A link into the person's own Stripe page, to change the card payouts go to. */
export async function cardManageUrl(stripeAccountId: string): Promise<string> {
  try {
    return await createDashboardLink(stripeAccountId);
  } catch (error) {
    if (error instanceof StripeError) throw new CardPayoutError(`Stripe couldn't open that: ${error.detail}`);
    throw error;
  }
}

/** A refusal Stripe gave a clear answer to. Anything else (a timeout, a 500) might have gone through. */
const isDefinite = (error: unknown): error is StripeError =>
  error instanceof StripeError && error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429;

/** Takes a transfer back. One that has already been taken back counts as done. */
async function takeBack(transferRef: string, key: string): Promise<void> {
  try {
    await reverseTransfer(transferRef, key);
  } catch (error) {
    if (isDefinite(error) && /already.*revers/i.test(`${error.code} ${error.detail}`)) return;
    throw error;
  }
}

const WAIT = "It is still waiting. Give it a few minutes, then press Send to card again.";

/** Runs one job on a cash-out that has been taken for the card, and tidies up however it ends. */
async function withClaim<T>(
  payoutId: string,
  job: (row: ClaimedPayout, tools: { stop: (message: string, change?: { transferRef?: null }) => Promise<never> }) => Promise<T>,
): Promise<T> {
  const db = getDb();
  const row = await claimForCard(db, payoutId);
  if (!row) {
    throw new CardPayoutError("That payout has already been dealt with, or is being sent to their card right now. Give it a few minutes.");
  }
  // A certain outcome: write the reason, let go of the cash-out, and say why.
  const stop = async (message: string, change: { transferRef?: null } = {}): Promise<never> => {
    await noteCardProgress(db, row, { providerError: message, ...change }, { release: true });
    throw new CardPayoutError(message);
  };
  try {
    return await job(row, { stop });
  } catch (error) {
    if (error instanceof CardPayoutError) throw error;
    // No clear answer from Stripe. Keep hold of the cash-out for a few minutes, so
    // nothing else touches it until Stripe has finished whatever it was doing. The
    // next try starts by asking Stripe what was done.
    console.error("[card payouts] A card payout did not finish", error);
    const detail = error instanceof StripeError ? error.detail : "Stripe couldn't be reached.";
    await noteCardProgress(db, row, { providerError: `It didn't finish: ${detail} ${WAIT}` }, { release: false });
    throw new CardPayoutError(`The card payout didn't finish: ${detail} ${WAIT}`);
  }
}

/**
 * Sends one waiting cash-out to the partner's card.
 *
 * The money moves in two steps, and either can be cut off half-way (a timeout,
 * the server stopping). So before each step this asks Stripe whether that step
 * was already done for this cash-out, and carries on from there. A try that got
 * no clear answer keeps its hold on the cash-out for a few minutes, so the next
 * one can't start until Stripe has finished. Sending again is always safe.
 *
 * On any failure the cash-out is left waiting, with the reason on it, for the
 * master account to send again or send by hand.
 */
export async function sendToCard(payoutId: string): Promise<Payout> {
  if (!isStripeConfigured()) throw new CardPayoutError("Card payouts aren't switched on yet.");
  const db = getDb();

  return withClaim(payoutId, async (row, { stop }) => {
    const key = (step: string) => `voidszn-payout-${row.id}-${row.cardAttempts}-${step}`;

    if (row.disabled) await stop("This person's access has been removed.");
    if (!row.stripeAccountId) await stop("They haven't added a card yet.");
    const accountId = row.stripeAccountId as string;
    if (row.amountCents < MIN_CARD_CENTS) await stop("A card payout has to be at least $0.50.");
    if (row.amountCents > MAX_CARD_CENTS) {
      await stop("That is more than one card payout can carry ($9,999). Send it by hand.");
    }

    const store = await getStoreBalance();
    if (row.stripeLivemode !== store.live) {
      await stop(
        `Their card was added while Stripe was in ${row.stripeLivemode ? "live" : "test"} mode. They need to add it again from the Payouts screen.`,
      );
    }
    const status = describe(await getPartnerAccount(accountId));
    if (!status.ready) await stop(`Their card isn't ready: ${status.reason}`);
    const card = (status as { card: PayoutCard }).card;
    // From here on, money in their Stripe account only leaves when this site says so.
    await ensureManualPayouts(accountId);

    const settled = async (payout: { id: string; status: string }): Promise<Payout> => {
      if (!store.live) {
        // A test key moves no real money, so the cash-out must not be marked as paid.
        return stop(
          `Practice run only: Stripe's test mode accepted ${formatMoney(row.amountCents)} to ${card.label}, but no real money moved. The cash-out is still waiting. Put the live Stripe key in to pay for real.`,
          { transferRef: null },
        );
      }
      const sent = await markCardSent(db, row, {
        payoutRef: payout.id,
        providerStatus: payout.status,
        destination: card.label,
      });
      if (!sent) throw new CardPayoutError("This payout was taken over by another send. Refresh the page to see where it stands.");
      return sent;
    };

    // The payout may already have been made by an earlier try that never heard back.
    const already = await findPayoutFor(accountId, row.id);
    if (already) return settled(already);

    // Step one: the store's Stripe balance to the partner's Stripe account.
    const [found, ...extra] = await findTransfersFor(row.id);
    // There should only ever be one. Any other is taken straight back.
    for (const transfer of extra) await takeBack(transfer.id, `voidszn-payout-${row.id}-extra-${transfer.id}`);
    let transferRef = found?.id ?? null;
    if (!transferRef) {
      try {
        const transfer = await createTransfer({
          amountCents: row.amountCents,
          accountId,
          payoutId: row.id,
          key: key("transfer"),
        });
        transferRef = transfer.id;
      } catch (error) {
        if (!isDefinite(error)) throw error;
        // A clear no: nothing moved.
        let why = `Stripe wouldn't move the money: ${error.detail}`;
        if (error.code === "balance_insufficient") {
          why = `The store's Stripe balance has ${formatMoney(store.availableCents)} and this payout needs ${formatMoney(row.amountCents)}. Add funds in Stripe, then send it again.`;
        }
        await stop(why);
      }
    }
    if (!(await noteCardProgress(db, row, { transferRef }, { release: false }))) {
      throw new CardPayoutError("This payout was taken over by another send. Refresh the page to see where it stands.");
    }

    // Step two: the partner's Stripe account to their card.
    let refusal: StripeError;
    try {
      const payout = await createInstantPayout({
        amountCents: row.amountCents,
        accountId,
        destination: card.id,
        payoutId: row.id,
        key: key("payout"),
      });
      if (payout.status !== "failed" && payout.status !== "canceled") return await settled(payout);
      refusal = new StripeError(402, payout.failure_code ?? "payout_failed", payout.failure_message ?? "The card refused it.");
    } catch (error) {
      if (!isDefinite(error)) throw error;
      refusal = error;
    }

    // The card payout was refused. Take the transfer back and leave the cash-out waiting.
    // If taking it back gets no clear answer, the hold stays and the next try sorts it out.
    await takeBack(transferRef as string, key("reversal"));
    return stop(`Stripe couldn't pay the card: ${refusal.detail}`, { transferRef: null });
  });
}

/**
 * Before a waiting cash-out is settled by hand (marked as sent, or cancelled):
 * makes sure no money for it is in Stripe. If an earlier card try did reach the
 * card, the cash-out is marked as sent to the card and that is returned.
 * Otherwise any transfer is taken back and null is returned: it is safe to
 * settle by hand.
 */
export async function clearOfCard(payoutId: string): Promise<Payout | null> {
  const db = getDb();
  return withClaim(payoutId, async (row, { stop }) => {
    const live = isStripeConfigured() ? await isLiveMode() : null;
    const checkable = live !== null && row.stripeAccountId !== null && row.stripeLivemode === live;
    if (!checkable) {
      if (row.transferRef) {
        await stop("Money for this payout is in their Stripe account, and Stripe can't be asked about it with the key in place. Sort it out in Stripe first.");
      }
      await noteCardProgress(db, row, {}, { release: true });
      return null;
    }
    const accountId = row.stripeAccountId as string;

    // With a test key, anything Stripe holds for this payout is practice money.
    // There is nothing real to find or bring back, so it is free to settle by hand.
    if (!live) {
      if (!(await noteCardProgress(db, row, { transferRef: null }, { release: true }))) {
        throw new CardPayoutError("This payout was taken over by another send. Refresh the page to see where it stands.");
      }
      return null;
    }

    const paid = await findPayoutFor(accountId, row.id);
    if (paid) {
      const account = await getPartnerAccount(accountId).catch(() => null);
      const label = account?.destinations.find((destination) => destination.instant)?.label ?? "their card";
      const sent = await markCardSent(db, row, {
        payoutRef: paid.id,
        providerStatus: paid.status,
        destination: label,
        note: "An earlier try had already reached the card. Found when it was about to be settled by hand.",
      });
      if (sent) return sent;
      throw new CardPayoutError("This payout was taken over by another send. Refresh the page to see where it stands.");
    }

    for (const transfer of await findTransfersFor(row.id)) {
      await takeBack(transfer.id, `voidszn-payout-${row.id}-clear-${transfer.id}`);
    }
    if (!(await noteCardProgress(db, row, { transferRef: null }, { release: true }))) {
      throw new CardPayoutError("This payout was taken over by another send. Refresh the page to see where it stands.");
    }
    return null;
  });
}

type Followed = Awaited<ReturnType<typeof cardPayoutsToFollow>>[number];

/** Checks one sent card payout with Stripe and deals with it if it bounced. Returns whether anything changed. */
async function settle(row: Followed): Promise<boolean> {
  if (!row.payoutRef || !row.stripeAccountId || row.status !== "SENT") return false;
  const db = getDb();
  const payout = await getPayout(row.stripeAccountId, row.payoutRef);
  if (payout.status !== "failed" && payout.status !== "canceled") {
    if (payout.status === row.providerStatus) return false;
    await noteSentPayout(db, row.id, { providerStatus: payout.status });
    return true;
  }

  const reason = payout.failure_message ?? "The card or its bank refused it.";
  // The money went back to their Stripe account. Bring it home before giving the balance back.
  try {
    for (const transfer of await findTransfersFor(row.id)) {
      await takeBack(transfer.id, `voidszn-payout-${row.id}-bounced-${transfer.id}`);
    }
  } catch (error) {
    if (!isDefinite(error)) throw error;
    // It can't be brought back automatically. Stop following it and say so on the payout.
    console.error(`[card payouts] A bounced payout's transfer could not be reversed: ${error.code}`);
    await noteSentPayout(db, row.id, {
      providerStatus: "failed",
      providerError: `The card payout failed (${reason}) and the money couldn't be taken back automatically: ${error.detail} It is in their Stripe account. Sort it out in Stripe.`,
    });
    return true;
  }

  const undone = await undoFailedCardPayout(db, row.id, reason);
  if (undone) {
    const amount = formatMoney(row.amountCents);
    const masters = await db.select({ email: adminUsers.email }).from(adminUsers).where(eq(adminUsers.role, "OWNER"));
    const recipients = new Set([row.email, ...masters.map((master) => master.email)]);
    await Promise.all(
      [...recipients].map((to) =>
        sendEmail({
          to,
          ...payoutFailedEmail({ partner: row.name, amount, reason, url: PAYOUTS_URL }),
          idempotencyKey: `payout-failed/${row.id}/${to}`,
        }).catch((error) => console.error("[card payouts] Could not email about a failed payout", error)),
      ),
    );
  }
  return true;
}

/** Run on a timer: follows up recent card payouts with Stripe. Returns how many changed. */
export async function followUpCardPayouts(limit = 30): Promise<number> {
  if (!isStripeConfigured()) return 0;
  let changed = 0;
  for (const row of await cardPayoutsToFollow(getDb(), limit)) {
    try {
      if (await settle(row)) changed += 1;
    } catch (error) {
      console.error("[card payouts] Could not follow up a card payout", error);
    }
  }
  return changed;
}

/** Called when Stripe tells us a payout changed. What Stripe says is checked with Stripe before acting. */
export async function followUpByRef(payoutRef: string): Promise<void> {
  const row = await findCardPayoutByRef(getDb(), payoutRef);
  if (row) await settle(row);
}
