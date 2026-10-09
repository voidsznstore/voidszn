import "server-only";
import { getDb, hasDatabase } from "@/db";
import { claimDueCarts, closeFinishedCarts } from "@/db/queries/carts";
import { siteConfig, unfilledSiteConfig } from "@/lib/site-config";
import { getAutomation, usableEmailDiscount } from "./automation";
import { unsubscribeUrl } from "./campaigns";
import { isEmailConfigured, sendEmail } from "./send";
import { cartReminderEmail } from "./templates";

/** Stop starting new sends after this long, so the run always finishes in good time. */
const TIME_BUDGET_MS = 35_000;
/** How many reminders go out side by side. */
const BATCH = 8;

export type ReminderRun = { sent: number; failed: number; skipped?: string };

/**
 * Sends the cart reminders that are due. Runs on a timer.
 *
 * A cart is marked as reminded before its email is sent. If the send then fails,
 * that one reminder is missed rather than risking the same email twice.
 */
export async function runCartReminders(): Promise<ReminderRun> {
  const none = (skipped: string): ReminderRun => ({ sent: 0, failed: 0, skipped });
  if (!hasDatabase()) return none("no database");
  if (!isEmailConfigured()) return none("email is not set up");
  // Reminders are marketing email, which must show the business's mailing address.
  if (unfilledSiteConfig().includes("mailingAddress")) return none("no mailing address");

  const db = getDb();
  const { cart } = await getAutomation(db);
  if (!cart.enabled) return none("switched off");

  await closeFinishedCarts(db);

  const started = Date.now();
  const run: ReminderRun = { sent: 0, failed: 0 };

  // Latest reminder first, so a cart that moves on a step in this run isn't picked up again.
  for (const index of [2, 1, 0] as const) {
    const step = cart.steps[index];

    while (Date.now() - started < TIME_BUDGET_MS) {
      // A few at a time, sent together, so a slow email service can't hold up a
      // whole batch that has already been marked as reminded.
      const due = await claimDueCarts(db, index, step.hours, BATCH);
      if (due.length === 0) break;

      const results = await Promise.all(
        due.map(async (saved) => {
          try {
            const subtotalCents = saved.items.reduce(
              (sum, item) => sum + item.unitPriceCents * item.quantity,
              0,
            );
            // Only offered to someone who can use it on this cart.
            const discount = await usableEmailDiscount(db, step.discountCodeId, {
              email: saved.email,
              subtotalCents,
            });
            const email = cartReminderEmail({
              step: (index + 1) as 1 | 2 | 3,
              items: saved.items,
              restoreUrl: `${siteConfig.url}/cart/${saved.recoveryToken}`,
              discount,
              unsubscribeUrl: unsubscribeUrl(saved.recoveryToken),
            });
            const result = await sendEmail({
              to: saved.email,
              ...email,
              idempotencyKey: `cart/${saved.id}/${index}/${saved.leftAt.getTime()}`,
              kind: "marketing",
              headers: {
                "List-Unsubscribe": `<${siteConfig.url}/api/unsubscribe/${saved.recoveryToken}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            });
            if (!result.ok) {
              console.error(`[cart-reminders] Reminder ${index + 1} for cart ${saved.id} was not sent: ${result.reason}`);
            }
            return result.ok;
          } catch (error) {
            console.error(`[cart-reminders] Reminder ${index + 1} for cart ${saved.id} failed`, error);
            return false;
          }
        }),
      );
      run.sent += results.filter(Boolean).length;
      run.failed += results.filter((sent) => !sent).length;
    }
  }
  return run;
}
