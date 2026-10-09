import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { runCartReminders } from "@/lib/email/cart-reminders";

/**
 * Called on a timer (see vercel.json) to send cart reminders that are due.
 *
 * It takes no input and only ever sends reminders that were already due, each
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

  try {
    const run = await runCartReminders();
    // Counts only. Never who was emailed.
    return Response.json(run);
  } catch (error) {
    console.error("[cart-reminders] Run failed", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
