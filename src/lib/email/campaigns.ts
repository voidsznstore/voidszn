import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import {
  type SendCounts,
  finishIfDone,
  getCampaign,
  markSends,
  nextPending,
  optedOutAmong,
} from "@/db/queries/admin-campaigns";
import { siteConfig } from "@/lib/site-config";
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

/** Sends one copy to the owner, to see how it looks in a real inbox. */
export async function sendTest(content: CampaignContent, to: string) {
  const email = emailFor(content, to, TEST_TOKEN, `campaign-test/${Date.now()}`);
  return sendEmail({ ...email, subject: `[Test] ${email.subject}` });
}

const BATCH = 100;
/** Stop starting new batches after this long, so the page gets an answer in good time. */
const TIME_BUDGET_MS = 40_000;

export type SendProgress = SendCounts & {
  /** Set when sending stopped early and can be picked up again later. */
  stopped?: string;
};

/**
 * Sends a campaign to everyone still waiting for it. Can be called again to carry
 * on: people already sent to are never sent to twice.
 */
export async function sendCampaign(id: string): Promise<SendProgress> {
  const db = getDb();
  const detail = await getCampaign(db, id);
  if (!detail) throw new Error("Campaign not found.");
  const { campaign } = detail;
  const content: CampaignContent = {
    subject: campaign.subject,
    preheader: campaign.preheader ?? "",
    body: campaign.body,
    imageUrl: campaign.imageUrl,
    buttonLabel: campaign.buttonLabel ?? "",
    buttonUrl: campaign.buttonUrl ?? "",
  };

  const started = Date.now();
  let stopped: string | undefined;

  while (campaign.status !== "DRAFT") {
    if (Date.now() - started > TIME_BUDGET_MS) {
      stopped = "There are more to send than fit in one go.";
      break;
    }
    const waiting = await nextPending(db, id, BATCH);
    if (waiting.length === 0) break;

    // Anyone who unsubscribed since the campaign was started is left out.
    const gone = await optedOutAmong(db, waiting.map((row) => row.email));
    await markSends(
      db,
      waiting.filter((row) => gone.has(row.email)).map((row) => row.id),
      "SKIPPED",
      "Unsubscribed before it was sent",
    );
    const batch = waiting.filter((row) => !gone.has(row.email));
    if (batch.length === 0) continue;

    const emails = batch.map((row) => emailFor(content, row.email, row.token, `campaign/${id}/${row.id}`));
    // The key names this exact set of people, so a batch repeated after a lost
    // answer is not sent twice.
    const key = `campaign/${id}/${createHash("sha256").update(batch.map((row) => row.id).join(",")).digest("hex").slice(0, 32)}`;
    const result = await sendBatch(emails, key);

    if (result.ok) {
      await markSends(db, batch.map((row) => row.id), "SENT");
      continue;
    }
    if (result.retryLater) {
      stopped = result.reason;
      break;
    }
    // Something in the batch was refused. Send one at a time to find which.
    for (const [index, row] of batch.entries()) {
      const single = await sendEmail(emails[index]);
      await markSends(db, [row.id], single.ok ? "SENT" : "FAILED", single.ok ? undefined : single.reason);
    }
  }

  if (!stopped) await finishIfDone(db, id);
  const after = await getCampaign(db, id);
  return { ...(after?.sends ?? detail.sends), stopped };
}
