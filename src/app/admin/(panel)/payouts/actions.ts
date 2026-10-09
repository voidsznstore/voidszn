"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  PayoutError,
  addAdjustment,
  cancelPayout,
  markPayoutSent,
  requestPayout,
  setIncomeTaxRate,
  setPayoutHandle,
  setShare,
} from "@/db/queries/payouts";
import { adminUsers } from "@/db/schema";
import { isBracket } from "@/lib/accounting/tax";
import { requireAdmin, requireMaster } from "@/lib/admin/session";
import { sendEmail } from "@/lib/email/send";
import { payoutRequestedEmail, payoutSentEmail } from "@/lib/email/templates";
import { formatMoney, parseDollars } from "@/lib/money";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { CardPayoutError, cardManageUrl, cardSetupUrl, clearOfCard, sendToCard } from "@/lib/payouts/card";
import { siteConfig } from "@/lib/site-config";
import { ownOrigin } from "@/lib/site-origin";

/** `at` changes with every success, so a form can clear itself each time. */
export type PayoutFormState = { error?: string; done?: string; at?: number };

const text = (form: FormData, name: string) => (typeof form.get(name) === "string" ? String(form.get(name)).trim() : "");
const id = z.string().uuid();
const PAYOUTS_URL = `${siteConfig.url}/admin/payouts`;

const failure = (error: unknown): PayoutFormState => {
  if (error instanceof PayoutError) return { error: error.message };
  throw error;
};

/**
 * Cashes out everything the signed-in person has available. The amount is worked
 * out on the server; nothing the browser sends can change it or whose it is.
 */
export async function cashOutAction(): Promise<PayoutFormState> {
  const admin = await requireAdmin();
  const db = getDb();
  let payout;
  try {
    payout = await requestPayout(db, admin.id);
  } catch (error) {
    return failure(error);
  }
  const amount = formatMoney(payout.amountCents);

  // With a card connected, the money goes straight there. The cash-out stands
  // whatever happens next: if the card can't be paid, it waits to be sent.
  let problem: string | undefined;
  if (isStripeConfigured()) {
    const [me] = await db
      .select({ stripeAccountId: adminUsers.stripeAccountId })
      .from(adminUsers)
      .where(eq(adminUsers.id, admin.id))
      .limit(1);
    if (me?.stripeAccountId) {
      try {
        const sent = await sendToCard(payout.id);
        refresh();
        return {
          done: `${amount} is on its way to ${sent.destination ?? "your card"}. It usually lands within 30 minutes. Your balance is back to $0.00.`,
        };
      } catch (error) {
        if (!(error instanceof CardPayoutError)) throw error;
        problem = error.message;
      }
    }
  }

  // Tell the master account there is money to send.
  try {
    const masters = await db
      .select({ email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.role, "OWNER"));
    await Promise.all(
      masters.map((master) =>
        sendEmail({
          to: master.email,
          ...payoutRequestedEmail({
            partner: admin.name,
            amount,
            sendTo: payout.destination,
            url: PAYOUTS_URL,
            problem,
          }),
          idempotencyKey: `payout-requested/${payout.id}/${master.email}`,
        }),
      ),
    );
  } catch (error) {
    console.error("[payouts] Could not email the master account about a cash-out", error);
  }

  refresh();
  return {
    done: problem
      ? `${amount} cashed out and your balance is back to $0.00. It couldn't go to your card: ${problem} The master account has been told and will send it.`
      : `${amount} cashed out. Your balance is back to $0.00.`,
  };
}

/** Sends the signed-in person to Stripe's form to add a debit card, or to finish adding one. */
export async function addCardAction(): Promise<PayoutFormState> {
  const admin = await requireAdmin();
  let url: string | null;
  try {
    url = await cardSetupUrl(admin, await ownOrigin());
  } catch (error) {
    if (error instanceof CardPayoutError) return { error: error.message };
    throw error;
  }
  if (!url) return { error: "Stripe couldn't start that. Try again." };
  redirect(url);
}

/** Sends the signed-in person to their own Stripe page to change their card. */
export async function manageCardAction(): Promise<PayoutFormState> {
  const admin = await requireAdmin();
  const [me] = await getDb()
    .select({ stripeAccountId: adminUsers.stripeAccountId })
    .from(adminUsers)
    .where(eq(adminUsers.id, admin.id))
    .limit(1);
  if (!me?.stripeAccountId) return { error: "Add a card first." };
  let url: string;
  try {
    url = await cardManageUrl(me.stripeAccountId);
  } catch (error) {
    if (error instanceof CardPayoutError) return { error: error.message };
    throw error;
  }
  redirect(url);
}

/** Where this person's payouts are sent when they are sent by hand. */
export async function saveHandleAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireAdmin();
  const handle = text(form, "handle");
  if (handle.length > 80) return { error: "Keep it under 80 characters." };
  // A card or bank account number must never be typed in here.
  if (handle.replace(/\D/g, "").length >= 12) {
    return { error: "Don't put a card or account number here. A Zelle phone or email, or a Cash App or Venmo name, is enough." };
  }
  await setPayoutHandle(getDb(), admin.id, handle || null);
  refresh();
  return { done: "Saved." };
}

/** The income tax rate this person plans with. Changes only their own suggested set-aside. */
export async function saveTaxRateAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireAdmin();
  const bps = Number(text(form, "rate"));
  if (!isBracket(bps)) return { error: "Pick one of the rates." };
  await setIncomeTaxRate(getDb(), admin.id, bps);
  refresh();
  return { done: "Saved." };
}

/* ------------------------------------------------------------------ */
/* Master account only                                                 */
/* ------------------------------------------------------------------ */

export async function markSentAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  const note = text(form, "note").slice(0, 200);
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };

  const db = getDb();
  let payout;
  try {
    // If a card payout was ever tried for this one, make sure no money for it is
    // still in Stripe before paying it another way.
    const reached = await clearOfCard(parsed.data);
    if (reached) {
      refresh();
      return { done: `This one had already reached ${reached.destination ?? "their card"}, so it is marked as sent to the card. Don't send it again.` };
    }
    payout = await markPayoutSent(db, parsed.data, admin.name, note);
  } catch (error) {
    refresh();
    if (error instanceof CardPayoutError) return { error: error.message };
    return failure(error);
  }

  try {
    const [partner] = await db
      .select({ name: adminUsers.name, email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.id, payout.adminId))
      .limit(1);
    if (partner && partner.email !== admin.email) {
      await sendEmail({
        to: partner.email,
        ...payoutSentEmail({
          name: partner.name,
          amount: formatMoney(payout.amountCents),
          note: note || null,
          url: PAYOUTS_URL,
        }),
        idempotencyKey: `payout-sent/${payout.id}`,
      });
    }
  } catch (error) {
    console.error("[payouts] Could not email a partner that their payout was sent", error);
  }

  refresh();
  return { done: "Marked as sent." };
}

/** Sends a waiting cash-out to the partner's card now. For after topping up Stripe, or once their card is ready. */
export async function sendToCardAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };

  let payout;
  try {
    payout = await sendToCard(parsed.data);
  } catch (error) {
    refresh();
    if (error instanceof CardPayoutError) return { error: error.message };
    throw error;
  }

  try {
    const [partner] = await getDb()
      .select({ name: adminUsers.name, email: adminUsers.email })
      .from(adminUsers)
      .where(eq(adminUsers.id, payout.adminId))
      .limit(1);
    if (partner && partner.email !== admin.email) {
      await sendEmail({
        to: partner.email,
        ...payoutSentEmail({
          name: partner.name,
          amount: formatMoney(payout.amountCents),
          note: `Sent to ${payout.destination ?? "your card"}. It usually lands within 30 minutes.`,
          url: PAYOUTS_URL,
        }),
        idempotencyKey: `payout-sent/${payout.id}`,
      });
    }
  } catch (error) {
    console.error("[payouts] Could not email a partner that their payout was sent", error);
  }

  refresh();
  return { done: `Sent to ${payout.destination ?? "their card"}.` };
}

export async function cancelPayoutAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };
  try {
    // The money can only go back on their balance once none of it is with Stripe or on their card.
    const reached = await clearOfCard(parsed.data);
    if (reached) {
      refresh();
      return { error: `This one had already reached ${reached.destination ?? "their card"}, so it can't be cancelled. It is marked as sent.` };
    }
    await cancelPayout(getDb(), parsed.data, admin.name, text(form, "note").slice(0, 200));
  } catch (error) {
    refresh();
    if (error instanceof CardPayoutError) return { error: error.message };
    return failure(error);
  }
  refresh();
  return { done: "Cancelled. The money is back on their balance." };
}

export async function setShareAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("adminId"));
  const raw = text(form, "percent").replace(/%$/, "");
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return { error: "Enter the share as a percentage, like 33.33." };
  try {
    await setShare(getDb(), parsed.data, Math.round(Number(raw) * 100), admin.name);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { done: "Saved. It applies to profit from today on." };
}

export async function adjustAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("adminId"));
  const cents = parseDollars(text(form, "amount"));
  const direction = text(form, "direction");
  const reason = text(form, "reason");
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };
  if (cents === null || cents <= 0) return { error: "Enter the amount as a number, like 50 or 50.00." };
  if (direction !== "add" && direction !== "take") return { error: "Pick add or take off." };
  if (!reason) return { error: "Say what the change is for. They will see it on their receipt." };
  if (reason.length > 200) return { error: "Keep the reason under 200 characters." };
  try {
    await addAdjustment(getDb(), parsed.data, direction === "add" ? cents : -cents, reason, admin.name);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { done: "Saved.", at: Date.now() };
}
