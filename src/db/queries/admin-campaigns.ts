import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../index";
import { campaignSends, campaigns, customers, emailOptouts, subscribers } from "../schema";
import { FormError } from "./admin-catalog";
import { listMarketingRecipients } from "./admin-customers";

export type CampaignInput = {
  subject: string;
  preheader: string;
  body: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
};

export type SendCounts = { total: number; sent: number; failed: number; skipped: number; pending: number };

const NO_SENDS: SendCounts = { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };

async function countSends(db: Database, ids: string[]): Promise<Map<string, SendCounts>> {
  const counts = new Map<string, SendCounts>();
  if (ids.length === 0) return counts;
  const rows = await db
    .select({
      campaignId: campaignSends.campaignId,
      status: campaignSends.status,
      value: sql<number>`count(*)::int`,
    })
    .from(campaignSends)
    .where(inArray(campaignSends.campaignId, ids))
    .groupBy(campaignSends.campaignId, campaignSends.status);
  for (const row of rows) {
    const entry = counts.get(row.campaignId) ?? { ...NO_SENDS };
    entry.total += row.value;
    if (row.status === "SENT") entry.sent += row.value;
    else if (row.status === "FAILED") entry.failed += row.value;
    else if (row.status === "SKIPPED") entry.skipped += row.value;
    else entry.pending += row.value;
    counts.set(row.campaignId, entry);
  }
  return counts;
}

export async function listCampaigns(db: Database) {
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(200);
  const counts = await countSends(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, sends: counts.get(row.id) ?? NO_SENDS }));
}

export async function getCampaign(db: Database, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return null;
  const [counts, problems] = await Promise.all([
    countSends(db, [id]),
    db
      .select({ email: campaignSends.email, status: campaignSends.status, error: campaignSends.error })
      .from(campaignSends)
      .where(and(eq(campaignSends.campaignId, id), inArray(campaignSends.status, ["FAILED", "SKIPPED"])))
      .orderBy(asc(campaignSends.email))
      .limit(200),
  ]);
  return { campaign, sends: counts.get(id) ?? NO_SENDS, problems };
}

const fields = (input: CampaignInput) => ({
  subject: input.subject.trim(),
  preheader: input.preheader.trim() || null,
  body: input.body.trim(),
  imageUrl: input.imageUrl,
  buttonLabel: input.buttonLabel.trim() || null,
  buttonUrl: input.buttonUrl.trim() || null,
});

/** Creates a draft, or saves changes to one. A campaign that has gone out can't be changed. */
export async function saveCampaign(
  db: Database,
  actor: string,
  id: string | undefined,
  input: CampaignInput,
): Promise<string> {
  if (!id) {
    const [row] = await db
      .insert(campaigns)
      .values({ ...fields(input), createdBy: actor })
      .returning({ id: campaigns.id });
    return row.id;
  }
  const [row] = await db
    .update(campaigns)
    .set({ ...fields(input), updatedAt: new Date() })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "DRAFT")))
    .returning({ id: campaigns.id });
  if (!row) throw new FormError("This campaign has already been sent, so it can't be changed.");
  return row.id;
}

export async function deleteDraft(db: Database, id: string): Promise<void> {
  const [row] = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "DRAFT")))
    .returning({ id: campaigns.id });
  if (!row) throw new FormError("Only a draft can be deleted.");
}

/**
 * Turns a draft into a campaign that is going out, and fixes who it goes to:
 * everyone who gets marketing emails at this moment. Doing it twice changes nothing.
 */
export async function startCampaign(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1)
      .for("update");
    if (!campaign) throw new FormError("That campaign no longer exists.");
    if (campaign.status !== "DRAFT") return;

    const recipients = await listMarketingRecipients(tx as unknown as Database);
    if (recipients.length === 0) {
      throw new FormError("Nobody has agreed to get marketing emails yet, so there is no one to send to.");
    }
    for (let start = 0; start < recipients.length; start += 500) {
      await tx
        .insert(campaignSends)
        .values(
          recipients.slice(start, start + 500).map((recipient) => ({
            campaignId: id,
            email: recipient.email,
            name: recipient.name,
            token: randomBytes(24).toString("base64url"),
          })),
        )
        .onConflictDoNothing();
    }
    await tx.update(campaigns).set({ status: "SENDING", updatedAt: new Date() }).where(eq(campaigns.id, id));
  });
}

export type PendingSend = { id: string; email: string; name: string | null; token: string };

/** The next people still waiting for a campaign, in a fixed order. */
export async function nextPending(db: Database, id: string, limit: number): Promise<PendingSend[]> {
  return db
    .select({
      id: campaignSends.id,
      email: campaignSends.email,
      name: campaignSends.name,
      token: campaignSends.token,
    })
    .from(campaignSends)
    .where(and(eq(campaignSends.campaignId, id), eq(campaignSends.status, "PENDING")))
    .orderBy(asc(campaignSends.email))
    .limit(limit);
}

/** Which of these addresses have unsubscribed. */
export async function optedOutAmong(db: Database, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: emailOptouts.email })
    .from(emailOptouts)
    .where(inArray(emailOptouts.email, emails));
  return new Set(rows.map((row) => row.email));
}

export async function markSends(
  db: Database,
  ids: string[],
  status: "SENT" | "FAILED" | "SKIPPED",
  error?: string,
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(campaignSends)
    .set({ status, error: error ?? null, sentAt: status === "SENT" ? new Date() : null })
    .where(inArray(campaignSends.id, ids));
}

/** Marks the campaign as finished once nobody is left waiting. */
export async function finishIfDone(db: Database, id: string): Promise<boolean> {
  const [waiting] = await nextPending(db, id, 1);
  if (waiting) return false;
  await db
    .update(campaigns)
    .set({ status: "SENT", sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "SENDING")));
  return true;
}

/* ------------------------------------------------------------------ */
/* Unsubscribing                                                       */
/* ------------------------------------------------------------------ */

/** The address an unsubscribe link belongs to, or null if the link isn't one of ours. */
export async function emailForToken(db: Database, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select({ email: campaignSends.email })
    .from(campaignSends)
    .where(eq(campaignSends.token, token))
    .limit(1);
  return row?.email ?? null;
}

/** Stops all marketing email to an address. Safe to do more than once. */
export async function optOut(db: Database, email: string, source: "link" | "one_click"): Promise<void> {
  const address = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    await tx.insert(emailOptouts).values({ email: address, source }).onConflictDoNothing();
    await tx
      .update(customers)
      .set({ acceptsEmail: false, updatedAt: new Date() })
      .where(eq(customers.email, address));
    await tx
      .update(subscribers)
      .set({ isEmailSubscribed: false, updatedAt: new Date() })
      .where(eq(sql`lower(${subscribers.email})`, address));
  });
}
