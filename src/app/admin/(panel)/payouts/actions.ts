"use server";

import { refresh } from "next/cache";
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
import { siteConfig } from "@/lib/site-config";

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

  // Tell the master account there is money to send. The cash-out stands either way.
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
            amount: formatMoney(payout.amountCents),
            sendTo: payout.destination,
            url: PAYOUTS_URL,
          }),
          idempotencyKey: `payout-requested/${payout.id}/${master.email}`,
        }),
      ),
    );
  } catch (error) {
    console.error("[payouts] Could not email the master account about a cash-out", error);
  }

  refresh();
  return { done: `${formatMoney(payout.amountCents)} cashed out. Your balance is back to $0.00.` };
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
    payout = await markPayoutSent(db, parsed.data, admin.name, note);
  } catch (error) {
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

export async function cancelPayoutAction(_previous: PayoutFormState, form: FormData): Promise<PayoutFormState> {
  const admin = await requireMaster();
  const parsed = id.safeParse(form.get("id"));
  if (!parsed.success) return { error: "That didn't work. Refresh and try again." };
  try {
    await cancelPayout(getDb(), parsed.data, admin.name, text(form, "note").slice(0, 200));
  } catch (error) {
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
