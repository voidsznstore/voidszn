import "server-only";
import { z } from "zod";
import type { Database } from "@/db";
import { type DiscountCode, countRedemptions, findDiscountById } from "@/db/queries/discounts";
import { getSetting, setSetting } from "@/db/queries/settings";
import { codeProblem } from "@/lib/checkout/discounts";
import type { EmailDiscount } from "./templates";

/**
 * Settings for the emails the store sends by itself, chosen in the admin under
 * Campaigns, Automatic emails. Kept as one saved value.
 */

const KEY = "emails.automation";

const codeId = z.string().uuid().nullable();
const step = z.object({
  /** Hours after the cart was left before this reminder goes out. */
  hours: z.number().int().min(1).max(168),
  /** A code to offer in this reminder, or none. */
  discountCodeId: codeId,
});

const schema = z.object({
  cart: z.object({
    enabled: z.boolean(),
    steps: z.tuple([step, step, step]),
  }),
  /** A thank-you code in the "delivered" email, or none. */
  delivered: z.object({ discountCodeId: codeId }),
});

export type Automation = z.infer<typeof schema>;

/**
 * Reminders start switched on with no codes: a nudge after an hour, a second the
 * next day and a last one after three days. That is the usual rhythm, and the
 * first reminder works without giving anything away.
 */
export const DEFAULT_AUTOMATION: Automation = {
  cart: {
    enabled: true,
    steps: [
      { hours: 1, discountCodeId: null },
      { hours: 24, discountCodeId: null },
      { hours: 72, discountCodeId: null },
    ],
  },
  delivered: { discountCodeId: null },
};

export async function getAutomation(db: Database): Promise<Automation> {
  try {
    const raw = await getSetting(db, KEY);
    if (!raw) return DEFAULT_AUTOMATION;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_AUTOMATION;
  } catch {
    return DEFAULT_AUTOMATION;
  }
}

export async function saveAutomation(db: Database, value: Automation): Promise<void> {
  await setSetting(db, KEY, JSON.stringify(schema.parse(value)));
}

/** A code as an email shows it. */
export const toEmailDiscount = (row: DiscountCode): EmailDiscount => ({
  code: row.code,
  type: row.type,
  value: row.value,
  minOrderCents: row.minOrderCents,
  expiresAt: row.expiresAt,
  oncePerCustomer: row.perCustomerLimit !== null,
  limited: row.maxUses !== null,
});

/**
 * The code to put in an email, or null. A code that has been switched off, has
 * run out or has expired is left out, so an email never offers one that won't work.
 */
export async function usableEmailDiscount(
  db: Database,
  id: string | null,
  /**
   * Who the email is going to, when it is one person. The code is then also left
   * out if this person couldn't use it: they have had their one use, or what they
   * are being asked to buy is under the code's minimum.
   */
  recipient?: { email: string; subtotalCents?: number },
): Promise<EmailDiscount | null> {
  if (!id) return null;
  try {
    const row = await findDiscountById(db, id);
    if (!row || codeProblem(row)) return null;
    if (recipient) {
      if (recipient.subtotalCents !== undefined && recipient.subtotalCents < row.minOrderCents) return null;
      if (
        row.perCustomerLimit !== null &&
        (await countRedemptions(db, row.id, recipient.email)) >= row.perCustomerLimit
      ) {
        return null;
      }
    }
    return toEmailDiscount(row);
  } catch {
    return null;
  }
}

/** The same as `usableEmailDiscount`, but shown whether or not it still works. For records of what was sent. */
export async function emailDiscountAsSent(db: Database, id: string | null): Promise<EmailDiscount | null> {
  if (!id) return null;
  try {
    const row = await findDiscountById(db, id);
    return row ? toEmailDiscount(row) : null;
  } catch {
    return null;
  }
}
