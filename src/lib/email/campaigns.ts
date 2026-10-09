import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import {
  type ClaimedSend,
  type SendCounts,
  claimPending,
  finishIfDone,
  getCampaign,
  markSends,
  optedOutAmong,
  reclaimStale,
  rekey,
  releaseSends,
} from "@/db/queries/admin-campaigns";
import { siteConfig } from "@/lib/site-config";
import { emailDiscountAsSent, usableEmailDiscount } from "./automation";
import { type Email, sendBatch, sendEmail } from "./send";
import { type CampaignContent, campaignEmail } from "./templates";

/** Where the unsubscribe link in a marketing email points. */
export const unsubscribeUrl = (token: string) => `${siteConfig.url}/unsubscribe/${token}`;

/** The token used in test emails, which have nobody to unsubscribe. */
export const TEST_TOKEN = "test";

function emailFor(content: CampaignContent, to: string, token: string, key: string): Email {
  const page = unsubscribeUrl(token);
  return {
    to,
    ...campaignEmail(content, page),
    idempotencyKey: key,
    kind: "marketing",
    headers: {
      // Lets mail apps show their own unsubscribe button, which works in one click.
      "List-Unsubscribe": `<${siteConfig.url}/api/unsubscribe/${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

type SavedCampaign = {
  subject: string;
  preheader: string | null;
  heading: string | null;
  body: string;
  imageUrl: string | null;
  buttonLabel: string | null;
  buttonUrl: string | null;
  discountCodeId: string | null;
};

/**
 * A saved campaign as the email template wants it, with its discount code
 * looked up. A code that can no longer be used is left out of the email.
 */
export async function contentOf(
  campaign: SavedCampaign,
  /** "sent" shows the code whether or not it still works, for looking back at what went out. */
  when: "now" | "sent" = "now",
): Promise<CampaignContent> {
  return {
    subject: campaign.subject,
    preheader: campaign.preheader ?? "",
    heading: campaign.heading,
    body: campaign.body,
    imageUrl: campaign.imageUrl,
    buttonLabel: campaign.buttonLabel ?? "",
    buttonUrl: campaign.buttonUrl ?? "",
    discount:
      when === "sent"
        ? await emailDiscountAsSent(getDb(), campaign.discountCodeId)
        : await usableEmailDiscount(getDb(), campaign.discountCodeId),
  };
}

/** Sends one copy to the owner, to see how it looks in a real inbox. */
export async function sendTest(content: CampaignContent, to: string) {
  const email = emailFor(content, to, TEST_TOKEN, `campaign-test/${Date.now()}`);
  return sendEmail({ ...email, subject: `[Test] ${email.subject}` });
}

const BATCH = 100;
/** Stop starting new requests after this long, so the page gets an answer in good time. */
const TIME_BUDGET_MS = 40_000;

export type SendProgress = SendCounts & {
  /** Set when sending stopped early and can be picked up again later. */
  stopped?: string;
};

/**
 * Sends a campaign to everyone still waiting for it, and can be called again to
 * carry on. Nobody is sent the same campaign twice, even if this runs twice at
 * once or an answer from the email service goes missing:
 *
 * - People are taken from the queue under a name for the request they go in,
 *   and a person can only be taken by one sender.
 * - They go back in the queue only when it is certain nothing was sent.
 * - When no clear answer came back, the same people are sent again later under
 *   the same name, which the email service recognises as a repeat.
 */
export async function sendCampaign(id: string): Promise<SendProgress> {
  const db = getDb();
  const detail = await getCampaign(db, id);
  if (!detail) throw new Error("Campaign not found.");
  const { campaign } = detail;
  if (campaign.status === "DRAFT") return { ...detail.sends };

  const content = await contentOf(campaign);
  const build = (row: ClaimedSend) => emailFor(content, row.email, row.token, `campaign/${id}/${row.id}`);

  const started = Date.now();
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
  let stopped: string | undefined;

  /** Sends one named request and records what happened. Returns a reason to stop, if any. */
  async function deliver(batchKey: string, rows: ClaimedSend[]): Promise<string | undefined> {
    const ids = rows.map((row) => row.id);
    const result = await sendBatch(rows.map(build), `campaign/${id}/${batchKey}`);
    switch (result.outcome) {
      case "sent":
        await markSends(db, ids, "SENT");
        return undefined;
      case "limit":
      case "blocked":
        // Certain that nothing went, so they wait in the queue again.
        await releaseSends(db, ids);
        return result.reason;
      case "unknown":
        // Left as they are. A later run repeats this same request by name.
        return `${result.reason} The last batch will be checked again in a couple of minutes.`;
      case "rejected":
        if (rows.length === 1) {
          await markSends(db, ids, "FAILED", result.reason);
          return undefined;
        }
        // Something in the batch was refused and none of it went. Try each
        // person separately, each under a name of their own, to find which.
        for (const [index, row] of rows.entries()) {
          if (outOfTime()) {
            await releaseSends(db, rows.slice(index).map((rest) => rest.id));
            return "There are more to send than fit in one go.";
          }
          const ownKey = `one-${row.id}`;
          await rekey(db, row.id, ownKey);
          const stop = await deliver(ownKey, [row]);
          if (stop) {
            await releaseSends(db, rows.slice(index + 1).map((rest) => rest.id));
            return stop;
          }
        }
        return undefined;
    }
  }

  while (!stopped) {
    if (outOfTime()) {
      stopped = "There are more to send than fit in one go.";
      break;
    }

    // First, anything handed over earlier whose answer never came back.
    const stale = await reclaimStale(db, id);
    if (stale) {
      stopped = await deliver(stale.batchKey, stale.rows);
      continue;
    }

    const batchKey = randomUUID();
    const taken = await claimPending(db, id, batchKey, BATCH);
    if (taken.length === 0) break;

    // Anyone who unsubscribed since the campaign was started is left out.
    const gone = await optedOutAmong(db, taken.map((row) => row.email));
    await markSends(
      db,
      taken.filter((row) => gone.has(row.email)).map((row) => row.id),
      "SKIPPED",
      "Unsubscribed before it was sent",
    );
    const batch = taken.filter((row) => !gone.has(row.email));
    if (batch.length > 0) stopped = await deliver(batchKey, batch);
  }

  const finished = await finishIfDone(db, id);
  const after = await getCampaign(db, id);
  const sends = after?.sends ?? detail.sends;
  if (!finished && !stopped && sends.pending > 0) {
    // Nothing left to take, but some are still part-way: another run has them,
    // or their answer is being waited for.
    stopped = "The last batch is still being confirmed. Check again in a couple of minutes.";
  }
  return { ...sends, stopped };
}
