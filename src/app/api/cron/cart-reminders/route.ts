import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { sendPendingInvites } from "@/lib/admin/invites";
import { runCartReminders } from "@/lib/email/cart-reminders";
import { syncProcessingFees } from "@/lib/payments/fees";
import { followUpCardPayouts } from "@/lib/payouts/card";

/**
 * Called on a timer (see vercel.json) to do the store's small background jobs:
 * send cart reminders that are due, send admin invitations that are waiting,
 * pick up the real card fee on recent orders, and follow up payouts to
 * partners' cards.
 *
 * It takes no input and each job only finishes work that was already waiting,
 * once, so calling it by hand does nothing a few minutes' wait wouldn't. If
 * CRON_SECRET is set in the hosting settings, callers must present it.
 */
/** Room for a full run plus one slow batch. */
export const maxDuration = 60;

export async function GET(request: Request) {
  await connection();

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    const wanted = Buffer.from(`Bearer ${secret}`);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      return Response.json({ error: "Not allowed" }, { status: 401 });
    }
  }

  // Each job on its own, so one failing doesn't hold up the others.
  const job = async <T>(name: string, run: () => Promise<T>): Promise<T | "failed"> => {
    try {
      return await run();
    } catch (error) {
      console.error(`[cron] ${name} failed`, error);
      return "failed";
    }
  };
  const invites = await job("invites", sendPendingInvites);
  const fees = await job("fees", syncProcessingFees);
  const cardPayouts = await job("card-payouts", followUpCardPayouts);
  const reminders = await job("cart-reminders", runCartReminders);

  // Counts only. Never who was emailed.
  const body = {
    ...(reminders === "failed" ? { sent: 0, failed: 0 } : reminders),
    invites,
    fees,
    cardPayouts,
  };
  const failed = [reminders, invites, fees, cardPayouts].includes("failed");
  return Response.json(failed ? { ...body, error: "Failed" } : body, { status: failed ? 500 : 200 });
}
