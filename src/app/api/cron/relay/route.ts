import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { getDb } from "@/db";
import { claimRelayRun } from "@/db/queries/relay";
import { followRelayedOrders, sendWaitingOrders } from "@/lib/relay/orders";
import { syncCatalogToRelay } from "@/lib/relay/products";
import { isRelayConfigured } from "@/lib/relay/woo";

/**
 * Called on a timer (see vercel.json) to keep the relay store in step
 * (docs/relay.md): send orders to the printer, bring tracking back, and copy new
 * and changed products.
 *
 * It takes no input and only does work that was already waiting, once. If
 * CRON_SECRET is set in the hosting settings, callers must present it. With or
 * without it, the job runs at most once every few minutes, so calling it over
 * and over does nothing.
 */
export const maxDuration = 60;

/** Fewer runs than this apart are skipped. Well under the half hour between timed runs. */
const MIN_MINUTES_APART = 4;

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
  if (!isRelayConfigured()) return Response.json({ relay: "off" });
  if (!(await claimRelayRun(getDb(), MIN_MINUTES_APART))) return Response.json({ relay: "ran a moment ago" });

  // Each part on its own, so one failing doesn't hold up the others. Orders first:
  // they are what the printer is waiting on. Each has a share of the minute.
  const part = async <T>(name: string, run: () => Promise<T>): Promise<T | "failed"> => {
    try {
      return await run();
    } catch (error) {
      console.error(`[cron] relay ${name} failed`, error);
      return "failed";
    }
  };
  const sent = await part("sending", () => sendWaitingOrders(20_000));
  const followed = await part("follow-up", () => followRelayedOrders(15_000));
  const products = await part("products", () => syncCatalogToRelay(12_000));

  // Counts only. Never which orders or whose.
  const failed = [sent, followed, products].includes("failed");
  return Response.json(
    {
      ...(sent === "failed" ? {} : { sent: sent.sent, notSent: sent.failed }),
      ...(followed === "failed" ? {} : { shipped: followed.shipped, problems: followed.problems }),
      ...(products === "failed" ? {} : { products: products.copied }),
      ...(failed ? { error: "Failed" } : {}),
    },
    { status: failed ? 500 : 200 },
  );
}
